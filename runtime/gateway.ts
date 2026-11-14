import { object, requireFormat, string } from '../shared/records.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { IMAGE_PREFIX_BYTES, imageType } from './image-type.js';
import { createUploadTransport } from './upload-transport.js';
import { invokedDirectly } from './entry.js';

export function createGateway({ mediaRoot = '/tmp/demo-media', manifestPath = '/opt/render-demo/runtime-manifest.json' }:{mediaRoot?:string;manifestPath?:string} = {}):http.Server {
  const raw:unknown=JSON.parse(fs.readFileSync(manifestPath,'utf8'));requireFormat(raw);
  if(!Array.isArray(raw.media))throw new Error('Invalid media manifest');
  const manifest={...raw,media:raw.media.map((value:unknown)=>{const item=object(value);return {url:string(item.url),directory:string(item.directory),inventory:object(item.inventory)};})};
  const backend=new URL(process.env.BACKEND_TARGET??'http://127.0.0.1:8081');
  if(backend.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(backend.hostname)||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('Configure a local backend origin.');
  const backendPort=Number(backend.port||80),uploadTransport=createUploadTransport({backendPort});
  const server=http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url??'/', 'http://localhost').pathname).replace(/\/{2,}/g, '/'); }
    catch { response.writeHead(400).end(); return; }
    if(pathname.startsWith('/__demo/upload-transport/')){void uploadTransport(request,response);return;}
    if (request.method === 'GET' && pathname === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      response.end(fs.readFileSync(new URL('./reset-worker-bundle.js',import.meta.url))); return;
    }
    if (request.method === 'GET' && pathname === '/__demo/runtime') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(manifest)); return;
    }
    if (request.method === 'GET' && pathname === '/__demo/activity.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      response.end(fs.readFileSync(new URL('./activity-bundle.js',import.meta.url))); return;
    }
    const mapping = manifest?.media?.find(item => pathname.startsWith(item.url));
    if (mapping && ['GET', 'HEAD'].includes(request.method??'GET')) {
      const relative = pathname.slice(mapping.url.length);
      const file = path.resolve(mediaRoot, mapping.directory, relative);
      const base = path.resolve(mediaRoot, mapping.directory) + path.sep;
      if (!file.startsWith(base) || !Object.hasOwn(mapping.inventory, relative)) { response.writeHead(404).end(); return; }
      let fd:number|undefined;
      try {
        let parent = path.dirname(file);
        while (parent.startsWith(base) || parent === base.slice(0, -1)) {
          if (fs.lstatSync(parent).isSymbolicLink()) { response.writeHead(404).end(); return; }
          parent = path.dirname(parent);
        }
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const info = fs.fstatSync(fd);
        if (!info.isFile()) { response.writeHead(404).end(); return; }
        const prefix = Buffer.alloc(IMAGE_PREFIX_BYTES);
        const count = fs.readSync(fd, prefix, 0, prefix.length, 0);
        const type = imageType(prefix.subarray(0, count)) ?? 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        if (request.method === 'HEAD') response.end();
        else {
          const stream = fs.createReadStream(file, { fd, autoClose: true, start: 0 });
          fd = undefined;
          pipeline(stream, response, () => {});
        }
      } catch {
        if (response.headersSent) response.destroy(); else response.writeHead(404).end();
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
      return;
    }
    // Application routes reach the backend unchanged; only tool paths and ';' path parameters are refused.
    if (pathname.includes(';') || pathname.startsWith('/__demo/')) {
      response.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Operação desabilitada na demonstração.' })); return;
    }
    const headers:http.OutgoingHttpHeaders = { ...request.headers, 'accept-encoding':'identity' };
    delete headers['x-github-token']; delete headers.authorization;
    const upstream = http.request({ hostname: '127.0.0.1', port: pathname === '/api' || pathname.startsWith('/api/') ? backendPort : 3001,
      method: request.method, path: request.url, headers }, incoming => {
      if (/text\/html/i.test(incoming.headers['content-type'] ?? '') && !incoming.headers['content-encoding']) {
        const outgoing = { ...incoming.headers }; delete outgoing['content-length']; delete outgoing.etag;
        response.writeHead(incoming.statusCode??502, outgoing);
        incoming.pipe(response, { end: false });
        incoming.on('end', () => response.end('<script type="module" src="/__demo/activity.js"></script>'));
      } else { response.writeHead(incoming.statusCode??502, incoming.headers); incoming.pipe(response); }
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('close',uploadTransport.close);return server;
}
if (await invokedDirectly(import.meta.url)) {
  createGateway().listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('Demo gateway ready'));
}

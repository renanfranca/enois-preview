import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { IMAGE_PREFIX_BYTES, imageType } from './image-type.mjs';
import { createUploadTransport } from './upload-transport.mjs';

// Defense in depth: all public traffic enters this gateway, including direct forwarded ports.
export function demoBlocked(method, pathname, writable = false) {
  if (pathname.includes(';')) return true;
  if (/^\/api\/(?:oauth2|login\/oauth2|auth\/(?:signup|register|oauth|password|forgot|reset|verify|email|2fa|account|admin)|(?:me\/)?integrations|webhooks|support)(?:\/|$)/i.test(pathname)) return true;
  if (/^\/api\/(?:admin\/support|identity\/verification|me\/github|admin\/github|admin\/contributors\/(?:sync|repositories))(?:\/|$)/i.test(pathname)) return true;
  if (!writable && !['GET', 'HEAD', 'OPTIONS'].includes(method) && /^\/api\/(?:media|uploads|imagekit|storage|dev\/uploads)(?:\/|$)/i.test(pathname)) return true;
  return false;
}

export function createGateway({ writable = process.env.DEMO_MEDIA_WRITABLE === 'true', mediaRoot = '/tmp/demo-media', manifestPath = '/opt/render-demo/runtime-manifest.json' } = {}) {
  const manifest = writable ? JSON.parse(fs.readFileSync(manifestPath)) : null;
  const uploadTransport = writable ? createUploadTransport() : null;
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/\/{2,}/g, '/'); }
    catch { response.writeHead(400).end(); return; }
    if (uploadTransport && pathname.startsWith('/__demo/upload-transport/')) {
      uploadTransport(request,response);return;
    }
    if (writable && request.method === 'GET' && pathname === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      response.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', event => event.waitUntil((async () => { for (const key of await caches.keys()) await caches.delete(key); await self.registration.unregister(); await self.clients.claim(); })()));"); return;
    }
    if (writable && request.method === 'GET' && pathname === '/__demo/runtime') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(manifest)); return;
    }
    if (writable && request.method === 'GET' && pathname === '/__demo/activity.mjs') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      response.end(fs.readFileSync(new URL('./demo-activity.mjs', import.meta.url), 'utf8') + `\ntrackDemoActivity(document, async () => { const response = await fetch('/__demo/activity', { method: 'POST', headers: { 'X-Demo-Activity': '1' } }); if (!response.ok) throw new Error('Activity rejected'); });`); return;
    }
    const mapping = manifest?.media?.find(item => pathname.startsWith(item.url));
    if (mapping && ['GET', 'HEAD'].includes(request.method)) {
      const relative = pathname.slice(mapping.url.length);
      const file = path.resolve(mediaRoot, mapping.directory, relative);
      const base = path.resolve(mediaRoot, mapping.directory) + path.sep;
      if (!file.startsWith(base) || !Object.hasOwn(mapping.inventory, relative)) { response.writeHead(404).end(); return; }
      let fd;
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
    if (demoBlocked(request.method, pathname, writable) || pathname.startsWith('/__demo/')) {
      response.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Operação desabilitada na demonstração.' })); return;
    }
    const headers = { ...request.headers, ...(writable ? { 'accept-encoding': 'identity' } : {}) };
    delete headers['x-github-token']; delete headers.authorization;
    const upstream = http.request({ hostname: '127.0.0.1', port: pathname === '/api' || pathname.startsWith('/api/') ? 8081 : 3001,
      method: request.method, path: request.url, headers }, incoming => {
      if (writable && /text\/html/i.test(incoming.headers['content-type'] ?? '') && !incoming.headers['content-encoding']) {
        const outgoing = { ...incoming.headers }; delete outgoing['content-length']; delete outgoing.etag;
        response.writeHead(incoming.statusCode, outgoing);
        incoming.pipe(response, { end: false });
        incoming.on('end', () => response.end('<script type="module" src="/__demo/activity.mjs"></script>'));
      } else { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); }
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  createGateway().listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('Demo gateway ready'));
}

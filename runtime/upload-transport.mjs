import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// The private forwarding service limits each request to 16 MB. Transport parts
// stay below that limit; the existing backend sees one stream and owns the
// original authorization, raw-byte reservation, validation and physical write.
export function createUploadTransport({ secret = process.env.DEMO_CALLBACK_SECRET, backendPort = 8081, timeoutMs = 30_000 } = {}) {
  const active = new Map();
  const authorized = value => typeof secret === 'string' && secret.length >= 20 && typeof value === 'string' &&
    Buffer.byteLength(secret) === Buffer.byteLength(value) && timingSafeEqual(Buffer.from(secret), Buffer.from(value));
  const reply = (response, status, text='') => { response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});response.end(text); };
  const discard = id => {
    const item=active.get(id);
    if (!item) return;
    active.delete(id);clearTimeout(item.timer);item.upstream.destroy();
  };
  const handler = async (request,response) => {
    if (!authorized(request.headers['x-demo-upload-secret'])) { request.resume();reply(response,403);return; }
    const id=/^\/__demo\/upload-transport\/([a-f0-9-]{36})$/.exec(request.url)?.[1];
    if(request.method==='DELETE' && id) {request.resume();discard(id);reply(response,204);return;}
    const target=request.headers['x-demo-upload-path'];
    const offset=Number(request.headers['x-demo-upload-offset']), total=Number(request.headers['x-demo-upload-total']), length=Number(request.headers['content-length']);
    if (request.method!=='POST' || !id || typeof target!=='string' ||
        !/^\/api\/storage\/uploads\/[a-f0-9-]+\/media_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(target) || target.includes('..') ||
        !Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(total) || total<=0 || total>20_971_520 ||
        !Number.isSafeInteger(length) || length<=0 || length>8_388_608 || offset+length>total) {
      request.resume();reply(response,400);return;
    }
    let item=active.get(id);
    if ((!item && offset!==0) || (item && (item.offset!==offset || item.total!==total || item.target!==target || item.busy))) {
      request.resume();if(item)discard(id);reply(response,409);return;
    }
    if (!item) {
      if (active.size>=2) { request.resume();reply(response,503);return; }
      const headers={...request.headers,'content-length':String(total)};
      for(const key of Object.keys(headers)) if(/^(?:x-demo-|x-github-|x-tunnel-)/.test(key) || ['authorization','host','transfer-encoding','connection'].includes(key))delete headers[key];
      let resolveResult;
      item={offset:0,total,target,busy:false,result:new Promise(resolve=>{resolveResult=resolve;}),timer:null,upstream:null};
      item.upstream=http.request({hostname:'127.0.0.1',port:backendPort,method:'PUT',path:target,headers},incoming=>{
        const parts=[];let count=0;
        incoming.on('data',data=>{count+=data.length;if(count>65_536)incoming.destroy();else parts.push(data);});
        incoming.on('end',()=>resolveResult({status:incoming.statusCode,headers:incoming.headers,body:Buffer.concat(parts)}));
        incoming.on('error',()=>resolveResult({status:502,headers:{},body:Buffer.alloc(0)}));
      });
      item.upstream.on('error',()=>resolveResult({status:502,headers:{},body:Buffer.alloc(0)}));
      active.set(id,item);
    }
    item.busy=true;clearTimeout(item.timer);
    item.timer=setTimeout(()=>discard(id),timeoutMs);item.timer.unref();
    let count=0;
    try {
      for await (const chunk of request) {
        count+=chunk.length;if(count>length)throw new Error('Part length mismatch');
        // Backpressure keeps gateway memory bounded and streams into the
        // backend reservation instead of assembling a second temporary file.
        if (!item.upstream.destroyed && !item.upstream.write(chunk)) {
          await Promise.race([new Promise(resolve=>item.upstream.once('drain',resolve)),item.result]);
        }
      }
      if(count!==length)throw new Error('Part length mismatch');
      item.offset+=count;item.busy=false;
      if(item.offset<total) {reply(response,202);return;}
      if(!item.upstream.destroyed)item.upstream.end();
      const result=await item.result;
      clearTimeout(item.timer);active.delete(id);
      const outgoing={...result.headers};delete outgoing['transfer-encoding'];delete outgoing.connection;
      response.writeHead(result.status,outgoing);response.end(result.body);
    } catch {
      discard(id);
      if(!response.headersSent)reply(response,400);
      else response.destroy();
    }
  };
  handler.close=()=>{for(const id of active.keys())discard(id);};
  return handler;
}

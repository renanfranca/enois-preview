import http from 'node:http';
import type {IncomingMessage, ServerResponse, ClientRequest, IncomingHttpHeaders} from 'node:http';
interface Result {status:number;headers:IncomingHttpHeaders;body:Buffer}
interface Upload {offset:number;total:number;target:string;busy:boolean;result:Promise<Result>;timer:NodeJS.Timeout|undefined;upstream:ClientRequest}

import { timingSafeEqual } from 'node:crypto';

/** Same per file limit as the Worker's forwardUpload and DemoLocalStore: the Cloudflare Free plan request body ceiling. */
export const UPLOAD_LIMIT_BYTES = 100_000_000;

// The private forwarding service limits each request to 16 MB. Transport parts
// stay below that limit; the existing backend sees one stream and owns the
// original authorization, validation and physical write.
export function createUploadTransport({ secret = process.env.DEMO_CALLBACK_SECRET, backendPort = 8081, timeoutMs = 30_000 }:{secret?:string|undefined;backendPort?:number;timeoutMs?:number} = {}) {
  const active = new Map<string,Upload>();
  const authorized = (value:unknown) => typeof secret === 'string' && secret.length >= 20 && typeof value === 'string' &&
    Buffer.byteLength(secret) === Buffer.byteLength(value) && timingSafeEqual(Buffer.from(secret), Buffer.from(value));
  const reply = (response:ServerResponse, status:number, text='') => { response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});response.end(text); };
  const discard = (id:string) => {
    const item=active.get(id);
    if (!item) return;
    active.delete(id);clearTimeout(item.timer);item.upstream.destroy();
  };
  const handler = async (request:IncomingMessage,response:ServerResponse) => {
    if (!authorized(request.headers['x-demo-upload-secret'])) { request.resume();reply(response,403);return; }
    const id=/^\/__demo\/upload-transport\/([a-f0-9-]{36})$/.exec(request.url??'')?.[1];
    if(request.method==='DELETE' && id) {request.resume();discard(id);reply(response,204);return;}
    const target=request.headers['x-demo-upload-path'];
    const offset=Number(request.headers['x-demo-upload-offset']), total=Number(request.headers['x-demo-upload-total']), length=Number(request.headers['content-length']);
    if (request.method!=='POST' || !id || typeof target!=='string' ||
        !/^\/api\/storage\/uploads\/[a-f0-9-]+\/media_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(target) || target.includes('..') ||
        !Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(total) || total<=0 || total>UPLOAD_LIMIT_BYTES ||
        !Number.isSafeInteger(length) || length<=0 || length>8_388_608 || offset+length>total) {
      request.resume();reply(response,400);return;
    }
    let item=active.get(id);
    if ((!item && offset!==0) || (item && (item.offset!==offset || item.total!==total || item.target!==target || item.busy))) {
      request.resume();if(item)discard(id);reply(response,409);return;
    }
    if (!item) {
      if (active.size>=2) { request.resume();reply(response,503);return; }
      const headers:http.OutgoingHttpHeaders={...request.headers,'content-length':String(total)};
      for(const key of Object.keys(headers)) if(/^(?:x-demo-|x-github-|x-tunnel-)/.test(key) || ['authorization','host','transfer-encoding','connection'].includes(key))delete headers[key];
      let resolveResult!:(result:Result)=>void;
      const result=new Promise<Result>(resolve=>{resolveResult=resolve;});
      const upstream=http.request({hostname:'127.0.0.1',port:backendPort,method:'PUT',path:target,headers},incoming=>{
        const parts:Buffer[]=[];let count=0;
        incoming.on('data',data=>{count+=data.length;if(count>65_536)incoming.destroy();else parts.push(data);});
        incoming.on('end',()=>resolveResult({status:incoming.statusCode??502,headers:incoming.headers,body:Buffer.concat(parts)}));
        incoming.on('error',()=>resolveResult({status:502,headers:{},body:Buffer.alloc(0)}));
      });
      upstream.on('error',()=>resolveResult({status:502,headers:{},body:Buffer.alloc(0)}));
      item={offset:0,total,target,busy:false,result,timer:undefined,upstream};
      active.set(id,item);
    }
    item.busy=true;clearTimeout(item.timer);
    item.timer=setTimeout(()=>discard(id),timeoutMs);item.timer.unref();
    let count=0;
    try {
      for await (const chunk of request) {
        count+=chunk.length;if(count>length)throw new Error('Part length mismatch');
        // Backpressure keeps gateway memory bounded and streams into the
        // backend upload instead of assembling a second temporary file.
        if (!item.upstream.destroyed && !item.upstream.write(chunk)) {
          await Promise.race([new Promise<void>(resolve=>item!.upstream.once('drain',()=>resolve())),item.result]);
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

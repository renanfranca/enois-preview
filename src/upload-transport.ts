import type { Transport } from './contracts.js';
import { message } from './responses.js';

/** The Cloudflare Free plan request body ceiling (100 MB); the runtime transport and DemoLocalStore use the same per file limit. */
export const UPLOAD_LIMIT_BYTES=100_000_000;
/** Split only the trusted private transport; the public upload API is unchanged. */
export async function forwardUpload(request:Request, origin:string, headers:Headers, transport:Transport, secret:string):Promise<Response> {
  const total=Number(request.headers.get('Content-Length'));
  if(!Number.isSafeInteger(total) || total<=0 || total>UPLOAD_LIMIT_BYTES || !request.body)return message('Limite de 100 MB por arquivo.',413);
  const id=crypto.randomUUID();
  const endpoint=new URL('/__demo/upload-transport/'+id,origin);
  const original=new URL(request.url);
  const partHeaders=new Headers(headers);
  partHeaders.set('X-Demo-Upload-Secret',secret);
  partHeaders.set('X-Demo-Upload-Path',original.pathname);
  partHeaders.set('X-Demo-Upload-Total',String(total));
  const reader=request.body.getReader();
  let pending:Uint8Array=new Uint8Array(),offset=0;
  try {
    while(offset<total) {
      const part=new Uint8Array(Math.min(8_388_608,total-offset));let filled=0;
      while(filled<part.length) {
        if(!pending.length) {
          const next=await reader.read();
          if(next.done)throw new Error('Incomplete upload body');
          pending=next.value;
        }
        const count=Math.min(pending.length,part.length-filled);
        part.set(pending.subarray(0,count),filled);filled+=count;pending=pending.subarray(count);
      }
      if(offset+part.length===total && (pending.length || !(await reader.read()).done))throw new Error('Extra upload body');
      partHeaders.set('Content-Length',String(part.length));
      partHeaders.set('X-Demo-Upload-Offset',String(offset));
      const response=await transport(endpoint,{method:'POST',headers:partHeaders,body:part,redirect:'manual',signal:AbortSignal.timeout(30_000)});
      offset+=part.length;
      if(offset===total)return response;
      if(response.status!==202)return response;
      await response.body?.cancel();
    }
    throw new Error('Invalid upload state');
  } catch {
    return message('Envio interrompido; tente novamente com um novo upload.',502);
  } finally {
    if(offset<total) {
      await reader.cancel().catch(()=>{});
      // Cancellation closes the one backend stream, so no partial file is committed.
      try {const result=await transport(endpoint,{method:'DELETE',headers:partHeaders,redirect:'manual',signal:AbortSignal.timeout(10_000)});await result.body?.cancel();}catch{/* gateway timeout is a second cleanup boundary */}
    }
  }
}

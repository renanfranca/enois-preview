import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createUploadTransport } from '../runtime/upload-transport.js';
import { forwardUpload } from '../src/upload-transport.js';
import { createGateway } from '../runtime/gateway.js';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret='fixture-private-callback-secret';
const uploadPath='/api/storage/uploads/00000000-0000-0000-0000-000000000001/media_fixture/file.wav';
async function listen(server:http.Server) { await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');return `http://127.0.0.1:${address.port}`; }
async function close(server:http.Server) { server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve())); }

test('internal parts stream one authorized 20 MiB upload to the backend without duplicating its request', async()=>{
  let requests=0,bytes=0;
  const backend=http.createServer((request,response)=>{
    requests++;
    assert.equal(request.method,'PUT');assert.equal(request.url,uploadPath);
    assert.equal(request.headers.cookie,'enois_session=fixture');
    assert.equal(request.headers.origin,'https://preview.example');
    assert.equal(request.headers['x-csrf-protection'],'1');
    assert.equal(request.headers['x-github-token'],undefined);
    assert.equal(request.headers['x-demo-upload-secret'],undefined);
    assert.equal(Number(request.headers['content-length']),20_971_520);
    request.on('data',data=>bytes+=data.length);
    request.on('end',()=>response.writeHead(204).end());
  });
  const backendOrigin=await listen(backend);
  const transport=createUploadTransport({secret,backendPort:Number(new URL(backendOrigin).port),timeoutMs:2000});
  const gateway=http.createServer((request,response)=>transport(request,response));
  const origin=await listen(gateway);
  try {
    let offset=0;
    for(const size of [8_388_608,8_388_608,4_194_304]) {
      const response=await fetch(origin+'/__demo/upload-transport/00000000-0000-0000-0000-000000000002',{method:'POST',headers:{
        'X-Demo-Upload-Secret':secret,'X-Demo-Upload-Path':uploadPath,'X-Demo-Upload-Offset':String(offset),'X-Demo-Upload-Total':'20971520',
        'X-Github-Token':'fixture-port-token',Cookie:'enois_session=fixture',Origin:'https://preview.example','X-CSRF-Protection':'1','Content-Type':'audio/wav'},body:Buffer.alloc(size)});
      offset+=size;assert.equal(response.status,offset===20_971_520?204:202);await response.arrayBuffer();
    }
    assert.equal(requests,1);assert.equal(bytes,20_971_520);
  } finally {transport.close();await close(gateway);await close(backend);}
});


test('transport refuses visitor access, wrong offsets and oversized totals, and aborts abandoned backend streams',async()=>{
  let requests=0,aborted=0;
  const backend=http.createServer((request,response)=>{requests++;request.on('aborted',()=>aborted++);request.resume();});
  const backendOrigin=await listen(backend);
  const transport=createUploadTransport({secret,backendPort:Number(new URL(backendOrigin).port),timeoutMs:80});
  const gateway=http.createServer((request,response)=>transport(request,response));const origin=await listen(gateway);
  const path='/__demo/upload-transport/00000000-0000-0000-0000-000000000003';
  const headers={'X-Demo-Upload-Secret':secret,'X-Demo-Upload-Path':uploadPath,'X-Demo-Upload-Offset':'0','X-Demo-Upload-Total':'100'};
  try {
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Secret':'visitor'},body:'x'})).status,403);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Total':'100000001'},body:'x'})).status,400);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Offset':'1'},body:'x'})).status,409);
    assert.equal(requests,0);
    assert.equal((await fetch(origin+path,{method:'POST',headers,body:'x'})).status,202);
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(requests,1);assert.equal(aborted,1);
  } finally {transport.close();await close(gateway);await close(backend);}
});


test('a public 50 MB request is fragmented below the tunnel limit and reaches one backend upload, while one above 100 MB is refused',async()=>{
  let uploads=0,bytes=0;const partLengths:number[]=[];
  const backend=http.createServer((request,response)=>{uploads++;request.on('data',data=>bytes+=data.length);request.on('end',()=>response.writeHead(204).end());});
  const backendOrigin=await listen(backend);
  const handler=createUploadTransport({secret,backendPort:Number(new URL(backendOrigin).port)});
  const gateway=http.createServer((request,response)=>{partLengths.push(Number(request.headers['content-length']));handler(request,response);});
  const origin=await listen(gateway);
  try {
    const headers=new Headers({'Content-Length':'50000000',Origin:'https://preview.example','Content-Type':'audio/wav','X-CSRF-Protection':'1'});
    const request=new Request('https://preview.example'+uploadPath,{method:'PUT',headers,body:new Uint8Array(50_000_000)});
    const oversized=new Headers({'Content-Length':'100000001'});

    const result=await forwardUpload(request,origin,headers,fetch,secret);
    const refused=await forwardUpload(new Request('https://preview.example'+uploadPath,{method:'PUT',headers:oversized,body:new Uint8Array(1)}),origin,oversized,fetch,secret);

    assert.equal(result.status,204);assert.equal(uploads,1);assert.equal(bytes,50_000_000);
    assert.deepEqual(partLengths,[8_388_608,8_388_608,8_388_608,8_388_608,8_388_608,8_056_960]);
    assert.equal(refused.status,413);assert.match(await refused.text(),/100 MB/);assert.equal(uploads,1);
  } finally {handler.close();await close(gateway);await close(backend);}
});


test('an incomplete body cancels its pending transport rather than committing a partial upload',async()=>{
  const calls:(string|undefined)[]=[];
  const headers=new Headers({'Content-Length':'9437184'});
  const request=new Request('https://preview.example'+uploadPath,{method:'PUT',headers,body:new Uint8Array(8_388_609)});
  const response=await forwardUpload(request,'https://private.example',headers,async(target,options)=>{
    assert.equal(new Headers(options?.headers).get('X-Demo-Upload-Secret'),secret);
    calls.push(options?.method);return new Response(null,{status:options?.method==='DELETE'?204:202});
  },secret);
  assert.equal(response.status,502);assert.deepEqual(calls,['POST','DELETE']);
});

test('the production gateway connects the authenticated Worker fragment transport to one original backend upload',async()=>{
  const root=await mkdtemp(join(tmpdir(),'enois-upload-gateway-'));const originalSecret=process.env.DEMO_CALLBACK_SECRET,originalTarget=process.env.BACKEND_TARGET;
  let uploads=0,received=0;
  const backend=http.createServer((request,response)=>{
    uploads++;assert.equal(request.url,uploadPath);assert.equal(request.method,'PUT');assert.equal(request.headers.cookie,'enois_session=fixture');assert.equal(request.headers.origin,'https://preview.example');assert.equal(request.headers['x-csrf-protection'],'1');assert.equal(request.headers['x-demo-upload-secret'],undefined);
    request.on('data',chunk=>received+=chunk.length);request.on('end',()=>response.writeHead(204).end());
  });
  let gateway:http.Server|undefined;
  try{
    const backendOrigin=await listen(backend);process.env.DEMO_CALLBACK_SECRET=secret;process.env.BACKEND_TARGET=backendOrigin;
    const manifest=join(root,'manifest.json');await writeFile(manifest,JSON.stringify({format:'enois-preview-ts-v1',media:[]}));gateway=createGateway({mediaRoot:root,manifestPath:manifest});const origin=await listen(gateway);
    const refused=await fetch(origin+'/__demo/upload-transport/00000000-0000-0000-0000-000000000002',{method:'POST',body:'x'});assert.equal(refused.status,403);await refused.body?.cancel();assert.equal(uploads,0);
    const headers=new Headers({'Content-Length':'20971520',Origin:'https://preview.example','Content-Type':'audio/wav','X-CSRF-Protection':'1',Cookie:'enois_session=fixture'});

    const response=await forwardUpload(new Request('https://preview.example'+uploadPath,{method:'PUT',headers,body:new Uint8Array(20971520)}),origin,headers,fetch,secret);

    assert.equal(response.status,204);await response.body?.cancel();assert.equal(uploads,1);assert.equal(received,20971520);
  }finally{if(gateway)await close(gateway);await close(backend);await rm(root,{recursive:true,force:true});if(originalSecret===undefined)delete process.env.DEMO_CALLBACK_SECRET;else process.env.DEMO_CALLBACK_SECRET=originalSecret;if(originalTarget===undefined)delete process.env.BACKEND_TARGET;else process.env.BACKEND_TARGET=originalTarget;}
});

test('the production gateway forwards application routes such as support to the backend and keeps /__demo/ reserved',async()=>{
  const root=await mkdtemp(join(tmpdir(),'enois-gateway-routes-'));const originalTarget=process.env.BACKEND_TARGET;
  const received:string[]=[];
  const backend=http.createServer((request,response)=>{received.push(`${request.method} ${request.url}`);response.writeHead(418,{'Content-Type':'application/json'}).end('{"from":"backend"}');});
  let gateway:http.Server|undefined;
  try{
    const backendOrigin=await listen(backend);process.env.BACKEND_TARGET=backendOrigin;
    const manifest=join(root,'manifest.json');await writeFile(manifest,JSON.stringify({format:'enois-preview-ts-v1',media:[]}));gateway=createGateway({mediaRoot:root,manifestPath:manifest});const origin=await listen(gateway);

    const support=await fetch(origin+'/api/support/x');
    const reserved=await fetch(origin+'/__demo/x');
    const semicolon=await fetch(origin+'/api/me;x');

    assert.equal(support.status,418);assert.deepEqual(await support.json(),{from:'backend'});
    assert.equal(reserved.status,403);await reserved.body?.cancel();
    assert.equal(semicolon.status,403);await semicolon.body?.cancel();
    assert.deepEqual(received,['GET /api/support/x']);
  }finally{if(gateway)await close(gateway);await close(backend);await rm(root,{recursive:true,force:true});if(originalTarget===undefined)delete process.env.BACKEND_TARGET;else process.env.BACKEND_TARGET=originalTarget;}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createUploadTransport } from '../runtime/upload-transport.mjs';
import { forwardUpload } from '../src/upload-transport.mjs';

const secret='fixture-private-callback-secret';
const uploadPath='/api/storage/uploads/00000000-0000-0000-0000-000000000001/media_fixture/file.wav';
async function listen(server) { await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve)); }

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
  const transport=createUploadTransport({secret,backendPort:new URL(backendOrigin).port,timeoutMs:2000});
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
  const transport=createUploadTransport({secret,backendPort:new URL(backendOrigin).port,timeoutMs:80});
  const gateway=http.createServer((request,response)=>transport(request,response));const origin=await listen(gateway);
  const path='/__demo/upload-transport/00000000-0000-0000-0000-000000000003';
  const headers={'X-Demo-Upload-Secret':secret,'X-Demo-Upload-Path':uploadPath,'X-Demo-Upload-Offset':'0','X-Demo-Upload-Total':'100'};
  try {
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Secret':'visitor'},body:'x'})).status,403);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Total':'20971521'},body:'x'})).status,400);
    assert.equal((await fetch(origin+path,{method:'POST',headers:{...headers,'X-Demo-Upload-Offset':'1'},body:'x'})).status,409);
    assert.equal(requests,0);
    assert.equal((await fetch(origin+path,{method:'POST',headers,body:'x'})).status,202);
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(requests,1);assert.equal(aborted,1);
  } finally {transport.close();await close(gateway);await close(backend);}
});

test('public 20 MiB request is fragmented below the tunnel limit and reaches one backend upload',async()=>{
  let uploads=0,bytes=0;const partLengths=[];
  const backend=http.createServer((request,response)=>{uploads++;request.on('data',data=>bytes+=data.length);request.on('end',()=>response.writeHead(204).end());});
  const backendOrigin=await listen(backend);
  const handler=createUploadTransport({secret,backendPort:new URL(backendOrigin).port});
  const gateway=http.createServer((request,response)=>{partLengths.push(Number(request.headers['content-length']));handler(request,response);});
  const origin=await listen(gateway);
  try {
    const headers=new Headers({'Content-Length':'20971520',Origin:'https://preview.example','Content-Type':'audio/wav','X-CSRF-Protection':'1'});
    const request=new Request('https://preview.example'+uploadPath,{method:'PUT',headers,body:new Uint8Array(20_971_520)});
    const result=await forwardUpload(request,origin,headers,fetch,secret);
    assert.equal(result.status,204);assert.equal(uploads,1);assert.equal(bytes,20_971_520);
    assert.deepEqual(partLengths,[8_388_608,8_388_608,4_194_304]);
  } finally {handler.close();await close(gateway);await close(backend);}
});

test('an incomplete body cancels its pending transport rather than committing a partial upload',async()=>{
  const calls=[];
  const headers=new Headers({'Content-Length':'9437184'});
  const request=new Request('https://preview.example'+uploadPath,{method:'PUT',headers,body:new Uint8Array(8_388_609)});
  const response=await forwardUpload(request,'https://private.example',headers,async(target,options)=>{
    assert.equal(options.headers.get('X-Demo-Upload-Secret'),secret);
    calls.push(options.method);return new Response(null,{status:options.method==='DELETE'?204:202});
  },secret);
  assert.equal(response.status,502);assert.deepEqual(calls,['POST','DELETE']);
});

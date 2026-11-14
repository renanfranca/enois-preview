import type { Journal } from '../preview/publication.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { Session, validate } from '../preview/validation.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function validationFixture(failure='',raw=Buffer.from('DATA'),mime='application/octet-stream'){
  const accounts=[{id:'author',email:'author@enois.invalid',label:'Author'},{id:'reader',email:'reader@enois.invalid',label:'Reader'}];
  const journal:Journal={format:'enois-preview-ts-v1',revision:'a'.repeat(64),slug:'fixture-abc',operation:'a'.repeat(32),target:{},frozenFiles:{},checkpoints:{},stage:'publicValidation',intents:{},tool:{commit:null,verified:false},inputs:{format:'enois-preview-ts-v1',scenario:'fixture',commits:{'enois-backend':'c'.repeat(40)},data:'b'.repeat(64),recipe:{},sourceFiles:{},dataManifest:{format:'enois-preview-ts-v1',id:'b'.repeat(64),accounts,permissions:{author:{admin:true,moderator:false},reader:{admin:false,moderator:false}},externalReads:[],logicalSeedSha256:'d'.repeat(64),sanitizerSha256:'e'.repeat(64),files:{},media:[{directory:'0',url:'/fixture/',inventory:{'image.bin':{bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}}}]}}};
  let healthRequests=0;
  const credentials={format:'enois-preview-ts-v1',accounts:accounts.map((account,index)=>({...account,password:(index?'r':'a').repeat(32)}))};
  const server=createServer(async(request,response)=>{
    response.setHeader('Content-Type','application/json');
    if(request.url==='/api/actuator/health/readiness'){
      healthRequests++;if(failure==='html'){response.setHeader('Content-Type','text/html');response.end('<html>Sign in</html>');}else response.end(JSON.stringify({status:failure==='health'&&healthRequests>1?'DOWN':'UP'}));
    }else if(request.url==='/__demo/runtime')response.end(JSON.stringify({format:'enois-preview-ts-v1',revision:failure==='runtime'?'0'.repeat(64):journal.revision,dataVersion:journal.inputs.data,commits:journal.inputs.commits}));
    else if(request.url==='/api/auth/login'){
      let body='';for await(const chunk of request)body+=String(chunk);const input=JSON.parse(body),id=input.email.split('@')[0];
      if(failure==='reader'&&id==='reader'){response.statusCode=401;response.end('{}');return;}
      response.setHeader('Set-Cookie',[`enois_session=${id}; Path=/${failure==='cookies'?'':'; Secure; HttpOnly'}`,`enois_refresh=${id}; Path=/; Secure; HttpOnly`]);response.end(JSON.stringify({user:{id:failure==='identity'?'other':id}}));
    }else if(request.url==='/api/me')response.end(JSON.stringify({id:request.headers.cookie?.includes('enois_session=reader')?'reader':'author'}));
    else if(request.url==='/api/moderation/me')response.end(JSON.stringify({admin:failure!=='permissions'&&!request.headers.cookie?.includes('enois_session=reader'),moderator:false}));
    else if(request.url==='/fixture/image.bin'){response.setHeader('Content-Type',mime);response.end(failure==='media'?Buffer.from('FAIL'):raw);}
    else{response.statusCode=404;response.end('{}');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  return {journal,credentials,origin:`http://127.0.0.1:${address.port}`,close:async()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

test('independent HTTP sessions retain their own cookies and send origin and CSRF headers', async () => {
  const server = createServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      let body = ''; for await (const chunk of request) body += String(chunk);
      const value: unknown = JSON.parse(body);
      assert.ok(value && typeof value === 'object' && 'email' in value);
      response.setHeader('Set-Cookie', `enois_session=${value.email}; HttpOnly; Path=/`);
      response.setHeader('Content-Type', 'application/json'); response.end('{"authenticated":true}');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ cookie: request.headers.cookie, origin: request.headers.origin, clientOrigin: request.headers['x-client-origin'], csrf: request.headers['x-csrf-protection'] }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const author = new Session(origin, { local: true, slug: 'fixture-abc' });
    const reader = new Session(origin, { local: true, slug: 'fixture-abc' });
    await author.json('/api/auth/login', { body: { email: 'author' } });
    await reader.json('/api/auth/login', { body: { email: 'reader' } });

    const authorMe = await author.json('/api/me'); const readerMe = await reader.json('/api/me');

    assert.deepEqual(authorMe, { cookie: '__Host-demo-scenario=fixture-abc; enois_session=author', origin, clientOrigin: origin, csrf: '1' });
    assert.deepEqual(readerMe, { cookie: '__Host-demo-scenario=fixture-abc; enois_session=reader', origin, clientOrigin: origin, csrf: '1' });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('HTTP failures expose safe status and response kind without query, cookie, challenge or body secrets', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'text/html; private=private-header-marker', 'WWW-Authenticate': 'Tunnel realm="private-realm-marker"', 'Set-Cookie': 'fixture=private-cookie-marker; HttpOnly' });
    response.end('private-body-marker');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try {
    const session = new Session(`http://127.0.0.1:${address.port}`, { local: true });

    await assert.rejects(session.request('/failure?token=private-query-marker'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 401 \[html; tunnel challenge\]/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('runtime validation authenticates the selected identity and reports nonimages without exposing credentials', async () => {
  const password='p'.repeat(32);
  const selected={id:'author',email:'author@enois.invalid',label:'Author'};
  const journal: Journal={format:'enois-preview-ts-v1',revision:'a'.repeat(64),slug:'fixture-abc',operation:'a'.repeat(32),target:{},frozenFiles:{},checkpoints:{},stage:'publicValidation',intents:{},tool:{commit:null,verified:false},inputs:{format:'enois-preview-ts-v1',scenario:'fixture',commits:{'enois-backend':'c'.repeat(40)},data:'b'.repeat(64),recipe:{},sourceFiles:{},dataManifest:{format:'enois-preview-ts-v1',id:'b'.repeat(64),accounts:[selected],permissions:{author:{admin:true,moderator:false}},externalReads:[],logicalSeedSha256:'d'.repeat(64),sanitizerSha256:'e'.repeat(64),files:{},media:[{directory:'0',url:'/fixture/',inventory:{'binary.bin':{bytes:4,sha256:'c97c29c7a71b392b437ee03fd17f09bb10b75e879466fc0eb757b2c4a78ac938'}}}]}}};
  const server=createServer(async(request,response)=>{
    response.setHeader('Content-Type','application/json');
    if(request.url==='/api/actuator/health/readiness')response.end('{"status":"UP"}');
    else if(request.url==='/__demo/runtime')response.end(JSON.stringify({format:'enois-preview-ts-v1',revision:journal.revision,dataVersion:journal.inputs.data,commits:journal.inputs.commits}));
    else if(request.url==='/api/auth/login'){
      let raw='';for await(const chunk of request)raw+=String(chunk);
      assert.deepEqual(JSON.parse(raw),{email:selected.email,password});
      response.setHeader('Set-Cookie',['enois_session=fixture; Secure; HttpOnly; Path=/','enois_refresh=fixture; Secure; HttpOnly; Path=/']);response.end('{"user":{"id":"author"}}');
    }else if(request.url==='/api/me'){assert.match(request.headers.cookie??'',/enois_session=fixture/);response.end('{"id":"author"}');}
    else if(request.url==='/api/moderation/me')response.end('{"admin":true,"moderator":false}');
    else if(request.url==='/fixture/binary.bin'){response.setHeader('Content-Type','application/octet-stream');response.end('DATA');}
    else{response.statusCode=404;response.end('{}');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
  try{
    const result=await validate(`http://127.0.0.1:${address.port}`,journal,{local:true,credentials:{format:'enois-preview-ts-v1',accounts:[{...selected,password}]},timeout:10});

    assert.equal(result.readiness,'UP');
    assert.deepEqual(result.accounts,[{id:'author',authenticated:true,permissions:{admin:true,moderator:false},permissionsMatch:true,secureCookies:true}]);
    assert.deepEqual(result.warnings,[]);
    assert.deepEqual(result.imageDecoding,[{width:1280,mobileEmulation:false,images:[]},{width:390,mobileEmulation:true,images:[]}]);
    assert.equal(result.media[0]?.imageClassification,'unclassified');
    assert.doesNotMatch(JSON.stringify(result),new RegExp(password));
    assert.doesNotMatch(JSON.stringify(result),/enois_session|enois_refresh/);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('readiness, revision identity and each selected account login independently prevent validation success',async()=>{
  for(const [failure,message]of [['html',/readiness timed out/],['health',/Readiness is not UP/],['runtime',/input identity mismatch/],['reader',/HTTP 401/],['identity',/account identity mismatch/]] as const){
    const fixture=await validationFixture(failure);
    try{await assert.rejects(validate(fixture.origin,fixture.journal,{local:true,credentials:fixture.credentials,timeout:0}),message,failure);}
    finally{await fixture.close();}
  }
});

test('different permissions, missing secure cookies and different media bytes validate with warnings',async()=>{
  for(const [failure,code]of [['permissions','permissions-differ'],['cookies','session-cookies-missing'],['media','media-bytes-differ']] as const){
    const fixture=await validationFixture(failure);
    try{
      const result=await validate(fixture.origin,fixture.journal,{local:true,credentials:fixture.credentials,timeout:10});

      assert.equal(result.readiness,'UP',failure);assert.equal(result.identityVerified,true,failure);
      assert.ok(result.warnings.some(warning=>warning.code===code),`${failure}: ${JSON.stringify(result.warnings)}`);
    }finally{await fixture.close();}
  }
});

test('a recognized image that real Chromium cannot decode validates with a decoding warning',async()=>{
  const fixture=await validationFixture('',Buffer.from('\x89PNG\r\n\x1a\ninvalid image body','latin1'),'image/png');
  try{
    const result=await validate(fixture.origin,fixture.journal,{local:true,credentials:fixture.credentials,timeout:10});

    assert.ok(result.warnings.some(warning=>/^image-decoding-/.test(warning.code)),JSON.stringify(result.warnings));
  }finally{await fixture.close();}
});

test('AVIF validation warns about a different MIME and decodes the recorded bytes at both actual browser viewports',async()=>{
  const raw=await readFile('test/fixtures/images/valid.avif');
  for(const mime of ['application/octet-stream','image/png','IMAGE/AVIF; fixture=1']){
    const fixture=await validationFixture('',raw,mime);
    try{
      const result=validate(fixture.origin,fixture.journal,{local:true,credentials:fixture.credentials,timeout:10});
      if(mime!=='IMAGE/AVIF; fixture=1')assert.ok((await result).warnings.some(warning=>warning.code==='media-mime-differs'&&/image\/avif/.test(warning.message)),mime);
      else{
        const proof=await result;assert.equal(proof.media[0]?.expectedContentType,'image/avif');assert.deepEqual(proof.imageDecoding,[{width:1280,mobileEmulation:false,images:[{path:'/fixture/image.bin',width:64,height:64}]},{width:390,mobileEmulation:true,images:[{path:'/fixture/image.bin',width:64,height:64}]}]);assert.deepEqual(proof.accounts.map(account=>account.id),['author','reader']);
      }
    }finally{await fixture.close();}
  }
});

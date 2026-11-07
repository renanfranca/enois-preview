import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { chmod,mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { CookieJar } from 'tough-cookie';
import { credentials as credentialRecord } from '../../src/contracts.js';
import { object,readRecord,run,string,writeRecord } from '../../preview/state.js';

test('a native Cloudflare Worker sends one authenticated 20 MiB upload through the actual Node gateway and Java storage',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input),receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));
  const journal=await readRecord(join(string(receipt.directory),'journal.json')),inputs=object(journal.inputs),manifest=object(inputs.dataManifest);
  const evidence=await mkdtemp(join(workspace,'.preview/worker-upload-node-'));const secret='controlled-worker-callback-secret',token='controlled-private-port-token',origin='https://preview.example';
  const container=(await run(['docker','run','-d','--cpus=2','--memory=2g','-p','127.0.0.1::3000','-e',`DEMO_PUBLIC_ORIGIN=${origin}`,'-e',`DEMO_CALLBACK_SECRET=${secret}`,'-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,string(receipt.image)])).toString().trim();
  let mf:Miniflare|undefined;
  try{
    const port=(await run(['docker','port',container,'3000/tcp'])).toString().trim().split(':').at(-1),gateway=`http://127.0.0.1:${port}`;
    let healthy=false;const deadline=Date.now()+120000;
    while(Date.now()<deadline){try{const response=await fetch(gateway+'/api/actuator/health/readiness',{signal:AbortSignal.timeout(1000)});if(response.ok&&object(await response.json()).status==='UP'){healthy=true;break;}}catch{}await delay(250);}assert.equal(healthy,true);
    const file=join(evidence,'credentials.json');await run(['docker','cp',`${container}:/tmp/demo-credentials.json`,file]);await chmod(file,0o600);const credentials=credentialRecord(await readRecord(file));
    const config={format:'enois-preview-ts-v1',repository:'fixture/launcher',launcherCommit:'a'.repeat(40),image:`ghcr.io/fixture/image@sha256:${'b'.repeat(64)}`,devcontainerPath:'.devcontainer/music/devcontainer.json',provenanceSha256:'c'.repeat(64),revision:receipt.revision,accounts:manifest.accounts};
    const bundled=await build({stdin:{contents:`import {createWorker} from './src/worker.ts';export {Scenario} from './src/scenario.ts';export default createWorker(${JSON.stringify({format:'enois-preview-ts-v1',scenarios:{music:config}})});`,resolveDir:process.cwd(),sourcefile:'controlled-integration.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});assert.ok(bundled.outputFiles[0]);
    const partLengths:number[]=[];let creates=0;
    mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-01',durableObjects:{SCENARIOS:{className:'Scenario',useSQLite:true}},bindings:{GITHUB_REPOSITORY:config.repository,GITHUB_OWNER:'fixture',GITHUB_TOKEN:'controlled-management',CALLBACK_SECRET:secret,LAUNCH_ENABLED:'true'},outboundService:async request=>{
      const url=new URL(request.url);
      if(url.hostname==='api.github.com'){
        if(url.pathname.includes('/contents/'))return Response.json({content:btoa(JSON.stringify({image:config.image,overrideCommand:true,forwardPorts:[3000]}))});
        if(url.pathname.endsWith('/machines'))return Response.json({machines:[{name:'small',cpus:2,memory_in_bytes:8000000000}]});
        if(request.method==='POST'&&url.pathname.endsWith('/codespaces')){creates++;return Response.json({name:'controlled-space'},{status:201});}
        if(url.pathname==='/user/codespaces/controlled-space')return Response.json({name:'controlled-space',owner:{login:'fixture'},repository:{full_name:config.repository},machine:{cpus:2},git_status:{ref:config.launcherCommit}});
      }
      assert.equal(url.hostname,'controlled-space-3000.app.github.dev');assert.equal(request.headers.get('X-Github-Token'),token);
      const headers=new Headers(request.headers);for(const header of ['Host','Connection','Keep-Alive','Transfer-Encoding','Upgrade','TE','Trailer','Proxy-Connection'])headers.delete(header);const body=['GET','HEAD'].includes(request.method)?undefined:Buffer.from(await request.arrayBuffer());
      if(url.pathname.startsWith('/__demo/upload-transport/')&&request.method==='POST')partLengths.push(Number(headers.get('Content-Length')));
      headers.delete('Content-Length');
      try{return await fetch(gateway+url.pathname+url.search,{method:request.method,headers,redirect:'manual',...(body===undefined?{}:{body})});}
      catch(error:unknown){const cause=error instanceof Error?error.cause:undefined;await writeRecord(join(evidence,'controlled-hop-failure.json'),{method:request.method,path:url.pathname,bodyBytes:body?.length??0,contentLength:headers.get('Content-Length'),transferEncoding:headers.get('Transfer-Encoding'),causeCode:cause&&typeof cause==='object'&&'code'in cause?String(cause.code):'unknown',causeMessage:cause instanceof Error?cause.message:'unknown'});throw error;}
    }}));
    assert.equal((await mf.dispatchFetch(origin+'/preview/music')).status,202);
    assert.equal((await mf.dispatchFetch(origin+'/__demo/register',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({slug:'music',name:'controlled-space',domain:'app.github.dev',portToken:token,credentials})})).status,200);
    const cookies=new CookieJar();
    const api=async(path:string,method='GET',body?:unknown,raw?:Buffer,range?:string)=>{
      const headers=new Headers({Origin:origin,'X-Client-Origin':origin,'X-CSRF-Protection':'1',Cookie:`__Host-demo-scenario=music; ${await cookies.getCookieString(origin)}`});
      if(!['GET','HEAD'].includes(method))headers.set('Idempotency-Key',randomUUID());
      if(body!==undefined)headers.set('Content-Type','application/json');if(raw){headers.set('Content-Type','audio/wav');headers.set('Content-Length',String(raw.length));}if(range)headers.set('Range',range);
      const response=await mf!.dispatchFetch(origin+path,{method,headers:Object.fromEntries(headers),...(raw?{body:raw}:body===undefined?{}:{body:JSON.stringify(body)})});for(const cookie of response.headers.getSetCookie())await cookies.setCookie(cookie,origin);return response;
    };
    const author=credentials.accounts[0];assert.ok(author);const login=await api('/api/auth/login','POST',{email:author.email,password:author.password});
    if(login.status!==200)await writeRecord(join(evidence,'private-login-failure.json'),{status:login.status,body:await login.clone().text()});
    assert.equal(login.status,200);await login.arrayBuffer();
    const allocated=await api('/api/media/uploads','POST',{fileName:'through-worker.wav',mimeType:'audio/wav',size:20971520,purpose:'POST_AUDIO'});assert.equal(allocated.status,201);const asset=object(await allocated.json());
    const bytes=Buffer.alloc(20971520);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('LIST',36);bytes.writeUInt32LE(26,40);bytes.write('INFOISFT',44);bytes.writeUInt32LE(14,52);bytes.write('fictionaltest\0',56);bytes.write('data',70);bytes.writeUInt32LE(bytes.length-78,74);

    const uploaded=await api(string(asset.uploadUrl),'PUT',undefined,bytes);

    assert.equal(uploaded.status,200);await uploaded.arrayBuffer();assert.deepEqual(partLengths,[8388608,8388608,4194304]);assert.equal(creates,1);
    const stored=await api(string(asset.cdnUrl),'GET',undefined,undefined,'bytes=0-77');assert.equal(stored.status,206);assert.equal(stored.headers.get('Content-Range'),'bytes 0-77/20971520');const prefix=Buffer.from(await stored.arrayBuffer());assert.equal(prefix.readUInt32LE(4)+8,20971520);
    await writeRecord(join(evidence,'validation.json'),{nativeCloudflareRuntime:true,actualNodeGateway:true,actualJavaStorage:true,inputBytes:20971520,partLengths,physicalContentRange:'bytes 0-77/20971520',accountsAuthenticated:true,creates:1,remoteWrites:false,transport:'controlled GitHub and private tunnel destination mapped to a disposable local image; no actual cloud or TLS delivery claim'});
  }finally{try{await mf?.dispose();await run(['docker','logs',container],{logPath:join(evidence,'runtime.log')});}finally{await run(['docker','rm','-f',container]);}}
});

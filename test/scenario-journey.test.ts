import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorker } from '../src/worker.js';
import { validateScenario } from '../src/catalog.js';
import { access, scenario, setup } from './fixtures/scenario.js';
import { object } from '../shared/records.js';
import { GitHub,GitHubFailure,failureReason } from '../src/github.js';
import { ready } from './fixtures/scenario.js';

test('provider refusal diagnostics classify limits without retaining private response text',async()=>{
  for(const [message,expected]of [['Codespaces usage limit reached','QUOTA_OR_BILLING'],['Too many active codespaces','CONCURRENCY_LIMIT'],['Resource not accessible by personal access token','ACCESS'],['API rate limit exceeded','RATE_LIMIT'],['private arbitrary provider details','UNCLASSIFIED']])assert.equal(failureReason({message}),expected);
  const client=new GitHub({GITHUB_TOKEN:'private-control'},async()=>Response.json({message:'Too many active codespaces for private-person'},{status:422}));

  await assert.rejects(client.request('/user/codespaces'),(error:unknown)=>{
    assert.ok(error instanceof GitHubFailure);assert.equal(error.status,422);assert.equal(error.reason,'CONCURRENCY_LIMIT');assert.doesNotMatch(String(error),/private-person|private-control/);return true;
  });
});

test('the public URL expires at 600000 ms while status and credentials at 599999 ms do not renew its deadline',async()=>{
  const s=setup();s.instance.transport=async()=>Response.json({status:'UP'});
  const worker=createWorker({format:'enois-preview-ts-v1',scenarios:{music:scenario}});
  const env={...s.env,SCENARIOS:{idFromName:(slug:string)=>slug,get:()=>({fetch:(request:Request)=>s.instance.fetch(request)})}};
  const initial=await worker.fetch(new Request('https://demo.example/preview/music'),env);assert.equal(initial.status,202);assert.equal(s.calls.creates,1);
  const registered=await worker.fetch(new Request('https://demo.example/__demo/register',{method:'POST',headers:{Authorization:'Bearer callback','Content-Type':'application/json'},body:JSON.stringify({slug:'music',name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:access})}),env);assert.equal(registered.status,200);

  s.tick(599_999);

  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/status/music'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/credentials',{headers:{Cookie:'__Host-demo-scenario=music'}}),env)).status,200);
  assert.equal(object(await s.storage.get('state')).lastActivity,1_000_000);await s.instance.alarm();assert.equal(s.calls.deletes,0);

  s.tick(1);await s.instance.alarm();

  assert.equal(s.calls.deletes,1);assert.equal(await s.storage.get('state'),undefined);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/status/music'),env)).status,410);assert.equal(s.calls.creates,1);
});

test('historical Durable Object state and callbacks are refused without changing the stored environment',async()=>{
  const historical={...ready,format:'python-format'};const s=setup(historical);const before=structuredClone(await s.storage.get('state'));

  assert.equal((await s.request('status')).status,503);
  assert.equal((await s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)})).status,503);
  await assert.rejects(s.instance.alarm(),/Unsupported record format/);

  assert.deepEqual(await s.storage.get('state'),before);assert.deepEqual(s.calls,{creates:0,deletes:0});assert.equal(s.alarm,undefined);
  const modern=setup({...ready,phase:'starting'});modern.instance.transport=async()=>Response.json({status:'UP'});
  const registration=await modern.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:{email:'demo@enois.invalid',password:'d'.repeat(32)}})});
  assert.equal(registration.status,403);assert.equal(object(await modern.storage.get('state')).phase,'starting');
});

test('an ambiguous creation is reconciled by its recorded display name without repeating POST',async()=>{
  const s=setup();s.instance.github.create=async()=>{s.calls.creates++;throw new Error('Acknowledgement lost');};
  const launch=()=>s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)});

  assert.equal((await launch()).status,503);const recorded=object(await s.storage.get('state'));
  assert.equal(object(await (await launch()).json()).phase,'creating');assert.equal(s.calls.creates,1);
  s.instance.github.find=async(_config,displayName)=>{assert.equal(displayName,recorded.displayName);return [{name:'demo-recovered'}];};

  assert.equal(object(await (await launch()).json()).phase,'starting');

  assert.equal(object(await s.storage.get('state')).name,'demo-recovered');assert.equal(s.calls.creates,1);
});

test('proxy preserves application origin, CSRF and query while isolating private forwarding credentials and cookies',async()=>{
  const s=setup(ready);let hops=0;
  s.instance.transport=async(target,options)=>{
    hops++;assert.equal(String(target),'https://demo-one-3000.app.github.dev/api/feed?limit=20');const headers=new Headers(options?.headers);
    assert.equal(headers.get('Origin'),'https://demo.example');assert.equal(headers.get('X-CSRF-Protection'),'1');assert.equal(headers.get('X-Github-Token'),'private-port-token');assert.equal(headers.get('X-Forwarded-Proto'),'https');assert.equal(headers.get('X-Tunnel-Skip-AntiPhishing-Page'),'1');
    assert.equal(headers.get('Cookie'),'session=app');assert.equal(headers.get('Sec-Fetch-Site'),null);assert.equal(headers.get('Sec-Fetch-Mode'),null);assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('X-Tunnel-Authorization'),null);
    const result=new Headers();result.append('Set-Cookie','session=updated; Domain=github.dev; Path=/; HttpOnly; SameSite=Lax');result.append('Set-Cookie','.Tunnels.Relay.WebForwarding.Cookies=private-tunnel-session; Path=/; Secure; HttpOnly');return new Response('ok',{headers:result});
  };

  const response=await s.request('proxy','/api/feed?limit=20',{headers:{Origin:'https://demo.example','X-CSRF-Protection':'1','X-Github-Token':'visitor-supplied','X-Tunnel-Authorization':'visitor-supplied',Authorization:'visitor-supplied','Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors',Cookie:'__Host-demo-scenario=music; .Tunnels.Relay.WebForwarding.Cookies=visitor-session; session=app'}});

  assert.equal(response.status,200);assert.equal(hops,1);const cookie=response.headers.get('Set-Cookie')??'';assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.doesNotMatch(cookie,/Domain=|Tunnels|private-tunnel-session/);assert.equal(response.headers.get('X-Github-Token'),null);
  const refused=await s.request('proxy','/api/feed/posts',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal(refused.status,403);assert.equal(hops,1);
});

test('callback rejects mismatched owner, repository, commit and private domain before saving readiness',async()=>{
  const changes=[{owner:{login:'other'}},{repository:{full_name:'owner/other'}},{git_status:{ref:'main'}},{git_status:{ref:'e'.repeat(40)}},{git_status:{}}];
  for(const change of changes){
    const s=setup({...ready,phase:'starting'}),get=s.instance.github.get;s.instance.github.get=async name=>({...await get(name),...change});s.instance.transport=async()=>{throw new Error('Invalid metadata must not probe the private service');};

    const response=await s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:access})});

    assert.equal(response.status,403);assert.equal(object(await s.storage.get('state')).phase,'starting');
  }
  const s=setup({...ready,phase:'starting'});s.instance.transport=async()=>Response.json({status:'UP'});
  assert.equal((await s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'evil.app.github.dev',portToken:'x'.repeat(32),credentials:access})})).status,403);
  const get=s.instance.github.get;s.instance.github.get=async name=>({...await get(name),git_status:{ref:'HEAD'}});
  assert.equal((await s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:access})})).status,200);
  assert.equal(object(await s.storage.get('state')).phase,'ready');
});

test('callback registers a Codespace whose machine does not report 2 CPUs and logs the difference',async context=>{
  const s=setup({...ready,phase:'starting'}),get=s.instance.github.get;s.instance.github.get=async name=>({...await get(name),machine:{cpus:4}});s.instance.transport=async()=>Response.json({status:'UP'});
  const logged=context.mock.method(console,'log',()=>{});

  const response=await s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:access})});

  assert.equal(response.status,200);assert.equal(object(await s.storage.get('state')).phase,'ready');
  assert.ok(logged.mock.calls.some(call=>/4 CPUs/.test(String(call.arguments[0]))));
});

test('callback requires ready application JSON and the exact ordered account selection with distinct boot credentials',async()=>{
  for(const [type,body,status]of [['application/vnd.spring-boot.actuator.v3+json; charset=UTF-8','{"status":"UP"}',200],['text/html','<html>sign in</html>',503],['application/jsonp','{"status":"UP"}',503],['application/json','{"status":"DOWN"}',503]] as const){
    const s=setup({...ready,phase:'starting'});s.instance.transport=async()=>new Response(body,{headers:{'Content-Type':type}});
    const response=await s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials:access})});
    assert.equal(response.status,status);assert.equal(object(await s.storage.get('state')).phase,status===200?'ready':'starting');
  }
  const reader={id:'reader',email:'reader@enois.invalid',label:'Reader'};const selected={...scenario,accounts:[...scenario.accounts,reader]};const s=setup({...ready,config:selected,phase:'starting'});s.instance.transport=async()=>Response.json({status:'UP'});
  const credentials={format:'enois-preview-ts-v1',accounts:[...access.accounts,{...reader,password:'r'.repeat(32)}]};
  const callback=(credentials:unknown)=>s.request('register','/',{method:'POST',body:JSON.stringify({name:'demo-one',domain:'app.github.dev',portToken:'x'.repeat(32),credentials})});
  assert.equal((await callback({format:'enois-preview-ts-v1',accounts:[...credentials.accounts].reverse()})).status,403);
  assert.equal((await callback({...credentials,accounts:credentials.accounts.map(account=>({...account,password:'x'.repeat(32)}))})).status,403);
  assert.equal((await callback(credentials)).status,200);assert.deepEqual(await (await s.request('credentials')).json(),credentials);
});

test('provider quota refusal keeps a cooldown and never retries creation or selects a paid fallback on refresh',async()=>{
  const s=setup();let machines=0;s.instance.github.smallestMachine=async()=>{machines++;return 'two-core';};
  s.instance.github.create=async()=>{s.calls.creates++;throw new GitHubFailure(403,'QUOTA_OR_BILLING');};
  const launch=()=>s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)});

  assert.equal((await launch()).status,503);
  for(let attempt=0;attempt<5;attempt++)assert.equal(object(await (await launch()).json()).phase,'refused');

  assert.equal(s.calls.creates,1);assert.equal(machines,1);assert.equal(s.alarm,1600000);s.tick(600000);await s.instance.alarm();assert.equal(await s.storage.get('state'),undefined);
});

test('a private tunnel authentication failure probes health with GET and never repeats the visitor write',async()=>{
  const s=setup(ready),methods:string[]=[];
  s.instance.transport=async(_target,options)=>{methods.push(options?.method??'GET');return methods.length===1?new Response(null,{status:401,headers:{'WWW-Authenticate':'Tunnel'}}):Response.json({status:'UP'});};

  const response=await s.request('proxy','/api/auth/login',{method:'POST',headers:{Origin:'https://demo.example','X-CSRF-Protection':'1'},body:'{}'});

  assert.equal(response.status,502);assert.deepEqual(methods,['POST','GET']);assert.doesNotMatch(await response.text(),/private-port-token/);
  s.instance.transport=async(_target,options)=>{assert.equal(options?.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://github.com/login'}});};
  assert.equal((await s.request('proxy','/api/feed')).status,502);
});

test('only trusted explicit interaction renews the lease and an earlier alarm respects the renewed deadline',async()=>{
  const s=setup(ready);s.tick(500000);
  for(const headers of [{},{Origin:'https://evil.example','X-Demo-Activity':'1'},{Origin:'https://demo.example','X-Demo-Activity':'1','Sec-Fetch-Site':'cross-site'}])assert.equal((await s.request('activity','/__demo/activity',{method:'POST',headers})).status,403);
  assert.equal(object(await s.storage.get('state')).lastActivity,1000000);

  const response=await s.request('activity','/__demo/activity',{method:'POST',headers:{Origin:'https://demo.example','X-Demo-Activity':'1','Sec-Fetch-Site':'same-origin'}});

  assert.equal(response.status,204);assert.equal(s.alarm,2100000);s.tick(100000);await s.instance.alarm();assert.equal(s.calls.deletes,0);
  s.tick(500000);await s.instance.alarm();assert.equal(s.calls.deletes,1);assert.equal(await s.storage.get('state'),undefined);
});

test('disabled launch and mismatched configuration stop before creation while a failed environment stays failed until expiry',async()=>{
  const s=setup();s.env.LAUNCH_ENABLED='false';const launch=()=>s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)});
  assert.equal((await launch()).status,503);assert.equal(s.calls.creates,0);assert.equal(await s.storage.get('state'),undefined);
  s.env.LAUNCH_ENABLED='true';s.instance.github.verifyConfig=async()=>{throw new Error('Controlled immutable image mismatch');};
  assert.equal((await launch()).status,503);assert.equal(s.calls.creates,0);assert.equal(await s.storage.get('state'),undefined);
  const pending=setup({...ready,phase:'starting'});const get=pending.instance.github.get;pending.instance.github.get=async name=>({...await get(name),state:'Failed'});

  assert.equal(object(await (await pending.request('status')).json()).phase,'starting');
  assert.equal(object(await (await pending.request('launch','/',{method:'POST',body:JSON.stringify(scenario)})).json()).phase,'failed');
  assert.equal(object(await (await pending.request('launch','/',{method:'POST',body:JSON.stringify(scenario)})).json()).phase,'failed');assert.equal(pending.calls.creates,0);
});

test('unknown slugs, visitor references and untrusted callback requests cannot select infrastructure or override internal actions',async()=>{
  const worker=createWorker({format:'enois-preview-ts-v1',scenarios:{music:scenario}});const actions:(string|null)[]=[];
  const env={GITHUB_REPOSITORY:scenario.repository,LAUNCH_ENABLED:'true',SCENARIOS:{idFromName:(name:string)=>{assert.equal(name,'music');return name;},get:()=>({fetch:async(request:Request)=>{actions.push(request.headers.get('X-Demo-Action'));return Response.json({phase:request.headers.get('X-Demo-Action')==='launch'?'starting':'expired'});}})}};

  assert.equal((await worker.fetch(new Request('https://demo.example/preview/unknown'),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://demo.example/preview/music?ref=main'),env)).status,400);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/register',{method:'POST',body:'{}'}),env)).status,403);assert.deepEqual(actions,[]);
  const preparing=await worker.fetch(new Request('https://demo.example/preview/music'),env);assert.equal(preparing.status,202);assert.match(await preparing.text(),/content="5;url=\/__demo\/status\/music"/);
  const expired=await worker.fetch(new Request('https://demo.example/__demo/status/music'),env);assert.equal(expired.status,410);assert.doesNotMatch(await expired.text(),/http-equiv="refresh"/);
  await worker.fetch(new Request('https://demo.example/api/feed?limit=20',{headers:{Cookie:'__Host-demo-scenario=music','X-Demo-Action':'launch'}}),env);
  assert.deepEqual(actions,['launch','status','proxy']);
});

test('GitHub chooses the smallest two-core machine and pins creation, idle timeout and zero retention without a fallback',async()=>{
  const requests:{url:string;method:string;body:unknown}[]=[];
  const client=new GitHub({GITHUB_TOKEN:'controlled-management'},async(input,init)=>{
    requests.push({url:String(input),method:init?.method??'GET',body:typeof init?.body==='string'?JSON.parse(init.body):null});
    return String(input).includes('/machines?')?Response.json({machines:[{name:'big',cpus:4,memory_in_bytes:4},{name:'small',cpus:2,memory_in_bytes:8},{name:'larger',cpus:2,memory_in_bytes:16}]}):Response.json({name:'created'});
  });

  const machine=await client.smallestMachine(scenario);assert.equal(machine,'small');await client.create(scenario,machine,'controlled-display');

  assert.equal(requests.length,2);assert.match(requests[0]!.url,new RegExp(`ref=${'a'.repeat(40)}$`));
  assert.deepEqual(requests[1]!.body,{ref:'a'.repeat(40),machine:'small',devcontainer_path:'.devcontainer/music/devcontainer.json',display_name:'controlled-display',idle_timeout_minutes:240,retention_period_minutes:0,multi_repo_permissions_opt_out:true});
});

test('accepted asynchronous deletion retains ownership until absence is confirmed before creating a replacement',async()=>{
  const s=setup(ready);s.tick(600_000);let removalRequests=0;
  s.instance.github.remove=async()=>{removalRequests++;};

  const first=await s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)});

  assert.equal(object(await first.json()).phase,'deleting');assert.equal(s.calls.creates,0);
  assert.equal(object(await s.storage.get('state')).name,'demo-one');assert.equal(object(await s.storage.get('state')).credentials,undefined);
  await s.instance.alarm();assert.equal(object(await s.storage.get('state')).phase,'deleting');assert.equal(s.calls.creates,0);
  s.instance.github.get=async()=>{throw new GitHubFailure(404);};

  const replacement=await s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)});

  assert.equal(object(await replacement.json()).phase,'starting');assert.equal(s.calls.creates,1);assert.equal(removalRequests,3);
});

test('failed deletion preserves ownership and schedules retry before allowing a replacement, while provider 404 completes cleanup',async()=>{
  const s=setup(ready);s.tick(600_000);s.instance.github.remove=async()=>{s.calls.deletes++;throw new Error('Provider unavailable');};

  await assert.rejects(s.instance.alarm(),/cleanup failed/);

  const retained=object(await s.storage.get('state'));assert.equal(retained.name,'demo-one');assert.equal(retained.phase,'deleting');assert.equal(retained.portToken,undefined);assert.equal(retained.credentials,undefined);assert.ok(s.alarm!>1_600_000);assert.equal(s.calls.creates,0);
  assert.equal((await s.request('launch','/',{method:'POST',body:JSON.stringify(scenario)})).status,503);assert.equal(s.calls.creates,0);
  s.instance.github.remove=async()=>{throw new GitHubFailure(404);};await s.instance.alarm();
  assert.equal(await s.storage.get('state'),undefined);assert.equal(s.alarm,undefined);assert.equal(s.calls.creates,0);
});

test('catalog validation refuses mutable artifacts and routing keeps known scenarios in distinct Durable Objects',async()=>{
  for(const change of [{image:'ghcr.io/owner/demo:latest'},{launcherCommit:'main'},{devcontainerPath:'.devcontainer/other/devcontainer.json'},{provenanceSha256:'unknown'},{revision:'unknown'}])assert.throws(()=>validateScenario('music',{...scenario,...change},scenario.repository));
  const alternate={...scenario,devcontainerPath:'.devcontainer/art/devcontainer.json'},worker=createWorker({format:'enois-preview-ts-v1',scenarios:{music:scenario,art:alternate}}),selected:string[]=[],paths:string[]=[];
  const env={...setup().env,SCENARIOS:{idFromName:(slug:string)=>{selected.push(slug);return slug;},get:()=>({fetch:async(request:Request)=>{paths.push(new URL(request.url).pathname+new URL(request.url).search);return Response.json({phase:'starting'});}})}};

  assert.equal((await worker.fetch(new Request('https://demo.example/preview/music'),env)).status,202);
  assert.equal((await worker.fetch(new Request('https://demo.example/preview/art'),env)).status,202);
  assert.equal((await worker.fetch(new Request('https://demo.example/api/feed?limit=20',{headers:{Cookie:'__Host-demo-scenario=art'}}),env)).status,200);

  assert.deepEqual(selected,['music','art','art']);assert.deepEqual(paths,['/preview/music','/preview/art','/api/feed?limit=20']);
});

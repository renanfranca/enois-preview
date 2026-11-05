import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scenario, IDLE_MS } from '../src/scenario.mjs';
import { GitHub, GitHubFailure, failureReason } from '../src/github.mjs';
import { createWorker } from '../src/worker.mjs';
import { validateScenario } from '../src/catalog.mjs';

const config = {
  repository: 'owner/launcher', launcherCommit: 'a'.repeat(40),
  image: `ghcr.io/owner/demo@sha256:${'b'.repeat(64)}`,
  devcontainerPath: '.devcontainer/music/devcontainer.json', provenanceSha256: 'c'.repeat(64),
};
function setup(existing) {
  const map = new Map(existing ? [['state', structuredClone(existing)]] : []);
  const storage = {
    get: async key => structuredClone(map.get(key)), put: async (key, value) => map.set(key, structuredClone(value)),
    delete: async key => map.delete(key), setAlarm: async value => { storage.alarm = value; },
    deleteAlarm: async () => { storage.alarm = undefined; },
  };
  const env = { LAUNCH_ENABLED: 'true', GITHUB_TOKEN: 'management', CALLBACK_SECRET: 'callback', GITHUB_OWNER: 'owner', GITHUB_REPOSITORY: 'owner/launcher' };
  const object = new Scenario({ storage }, env);
  let now = 1_000_000;
  object.now = () => now;
  const calls = { creates: 0, deletes: 0 };
  let removed = false;
  object.github = {
    verifyConfig: async () => {}, smallestMachine: async () => 'two-core',
    create: async () => { calls.creates++; await new Promise(resolve => setTimeout(resolve, 5)); return { name: 'demo-one' }; },
    remove: async () => { calls.deletes++; removed = true; }, find: async () => [],
    get: async () => { if (removed) throw new GitHubFailure(404); return { owner: { login: 'owner' }, repository: { full_name: 'owner/launcher' }, git_status: { ref: config.launcherCommit }, machine: { cpus: 2 } }; },
  };
  const request = (action, path = '/', options = {}) => object.fetch(new Request(`https://demo.example${path}`, {
    ...options, headers: { 'X-Demo-Action': action, ...options.headers },
  }));
  return { object, storage, calls, env, map, request, tick: ms => { now += ms; } };
}
const demoCredentials = { email: 'demo@enois.invalid', password: 'd'.repeat(32) };
const ready = { config, name: 'demo-one', phase: 'ready', origin: 'https://demo-one-3000.app.github.dev', portToken: 'private-port-token', credentials: demoCredentials, lastActivity: 1_000_000 };

test('provider refusal diagnostics classify limits without retaining private response text',async()=>{
  for(const [message,expected] of [
    ['Codespaces usage limit reached','QUOTA_OR_BILLING'],['Too many active codespaces','CONCURRENCY_LIMIT'],
    ['Resource not accessible by personal access token','ACCESS'],['API rate limit exceeded','RATE_LIMIT'],['private arbitrary provider details','UNCLASSIFIED'],
  ])assert.equal(failureReason({message}),expected);
  const client=new GitHub({GITHUB_TOKEN:'private-control'},async()=>Response.json({message:'Too many active codespaces for private-person'}, {status:422}));
  await assert.rejects(()=>client.request('/user/codespaces'),error=>error.status===422 && error.reason==='CONCURRENCY_LIMIT' && !String(error).includes('private-person'));
});

test('proxy identifies its server hop without forwarding browser fetch metadata or an empty cookie', async () => {
  const s=setup(ready);
  s.object.transport=async (target,options) => {
    assert.equal(options.headers.get('Origin'),'https://demo.example');
    assert.equal(options.headers.get('X-CSRF-Protection'),'1');
    assert.equal(options.headers.get('Sec-Fetch-Site'),null);
    assert.equal(options.headers.get('Sec-Fetch-Mode'),null);
    assert.equal(options.headers.get('Cookie'),null);
    assert.equal(options.headers.get('X-Github-Token'),'private-port-token');
    return Response.json({status:'UP'});
  };
  const response=await s.request('proxy','/api/auth/login',{method:'POST',headers:{Origin:'https://demo.example','X-CSRF-Protection':'1','Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors',Cookie:'__Host-demo-scenario=music'},body:'{}'});
  assert.equal(response.status,200);
});

test('a tunnel authentication failure is diagnosed by a read and never repeats a write', async () => {
  const s=setup(ready);const methods=[];
  s.object.transport=async (target,options) => {
    methods.push(options.method??'GET');
    return methods.length===1?new Response(null,{status:401,headers:{'WWW-Authenticate':'tunnel'}}):Response.json({status:'UP'});
  };
  const response=await s.request('proxy','/api/auth/login',{method:'POST',headers:{Origin:'https://demo.example','X-CSRF-Protection':'1'},body:'{}'});
  assert.equal(response.status,502);
  assert.deepEqual(methods,['POST','GET']);
  assert.doesNotMatch(await response.text(),/private-port-token/);
});

test('twenty simultaneous clicks create one codespace and persist it across restart', async () => {
  const s = setup();
  const states = await Promise.all(Array.from({ length: 20 }, () => s.object.serialized(() => s.object.launch(config))));
  assert.equal(s.calls.creates, 1);
  assert.ok(states.every(state => state.name === 'demo-one'));
  const restarted = new Scenario({ storage: s.storage }, s.env);
  restarted.now = s.object.now; restarted.github = s.object.github;
  await restarted.launch(config);
  assert.equal(s.calls.creates, 1);
});

test('ordinary traffic and launch refreshes do not postpone deletion', async () => {
  const s = setup(ready);
  s.object.transport = async () => new Response('{}');
  s.tick(IDLE_MS - 1);
  assert.equal((await s.request('proxy', '/api/feed?limit=20')).status, 200);
  await s.object.launch(config);
  assert.equal((await s.storage.get('state')).lastActivity, ready.lastActivity);
  s.tick(1); await s.object.alarm();
  assert.equal(s.calls.deletes, 1); assert.equal(await s.storage.get('state'), undefined);
});

test('real activity postpones deadline, and the old alarm respects the new deadline', async () => {
  const s = setup(ready); s.tick(500_000);
  const response = await s.request('activity', '/__demo/activity', { method: 'POST', headers: { Origin: 'https://demo.example', 'X-Demo-Activity': '1', 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(response.status, 204);
  assert.equal(s.storage.alarm, ready.lastActivity + 500_000 + IDLE_MS);
  s.tick(100_000); await s.object.alarm(); assert.equal(s.calls.deletes, 0);
  s.tick(500_000); await s.object.alarm(); assert.equal(s.calls.deletes, 1);
});

test('untrusted activity and automatic POST without activity header cannot renew time', async () => {
  const s = setup(ready);
  for (const headers of [{}, { Origin: 'https://evil.example', 'X-Demo-Activity': '1' }, { Origin: 'https://demo.example', 'X-Demo-Activity': '1', 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await s.request('activity', '/__demo/activity', { method: 'POST', headers })).status, 403);
  }
  assert.equal((await s.storage.get('state')).lastActivity, ready.lastActivity);
});

test('expired background API traffic never creates another environment', async () => {
  const s = setup(ready); s.tick(IDLE_MS);
  assert.equal((await s.request('proxy', '/api/feed')).status, 410);
  assert.equal(s.calls.creates, 0); assert.equal(s.calls.deletes, 1);
  await s.object.launch(config); assert.equal(s.calls.creates, 1);
});

test('forgotten preparation status polling expires without creating another codespace', async () => {
  const s = setup({ ...ready, phase: 'starting' });
  assert.equal((await (await s.request('status')).json()).phase, 'starting');
  s.tick(IDLE_MS);
  for (let i = 0; i < 20; i++) assert.equal((await (await s.request('status')).json()).phase, 'expired');
  assert.equal(s.calls.creates, 0);
  assert.equal(s.calls.deletes, 1);
  await s.object.launch(config);
  assert.equal(s.calls.creates, 1);
});

test('preparation page refreshes the read-only status URL and stops refreshing after expiration', async () => {
  const actions = [];
  const worker = createWorker({ music: config });
  const env = { LAUNCH_ENABLED: 'true', GITHUB_REPOSITORY: config.repository, SCENARIOS: {
    idFromName: slug => slug,
    get: () => ({ fetch: async request => { const action = request.headers.get('X-Demo-Action'); actions.push(action); return Response.json({ phase: action === 'launch' ? 'starting' : 'expired' }); } }),
  } };
  const preparing = await worker.fetch(new Request('https://demo.example/preview/music'), env);
  assert.equal(preparing.status, 202);
  assert.match(await preparing.text(), /content="5;url=\/__demo\/status\/music"/);
  const expired = await worker.fetch(new Request('https://demo.example/__demo/status/music'), env);
  assert.equal(expired.status, 410);
  assert.doesNotMatch(await expired.text(), /http-equiv="refresh"/);
  assert.deepEqual(actions, ['launch', 'status']);
});

test('failed deletion retains name and retries before any replacement can be created', async () => {
  const s = setup(ready); s.tick(IDLE_MS);
  s.object.github.remove = async () => { throw new Error('unavailable'); };
  await assert.rejects(s.object.launch(config));
  assert.equal((await s.storage.get('state')).name, 'demo-one');
  assert.equal((await s.storage.get('state')).phase, 'deleting');
  assert.equal(s.calls.creates, 0);
  s.object.github.remove = async () => {}; s.object.github.get = async () => { throw new GitHubFailure(404); }; await s.object.alarm();
  assert.equal(await s.storage.get('state'), undefined);
});

test('accepted asynchronous deletion does not allow a replacement until GitHub confirms 404', async () => {
  const s = setup(ready); s.tick(IDLE_MS);
  s.object.github.remove = async () => {};
  assert.equal((await s.object.launch(config)).phase, 'deleting');
  assert.equal(s.calls.creates, 0);
  await s.object.alarm(); assert.equal((await s.storage.get('state')).phase, 'deleting');
  s.object.github.get = async () => { throw new GitHubFailure(404); };
  await s.object.launch(config); assert.equal(s.calls.creates, 1);
});

test('404 during deletion is successful cleanup', async () => {
  const s = setup(ready); s.tick(IDLE_MS);
  s.object.github.remove = async () => { throw new GitHubFailure(404); };
  await s.object.alarm(); assert.equal(await s.storage.get('state'), undefined);
});

test('ambiguous creation is reconciled and never repeated', async () => {
  const s = setup();
  s.object.github.create = async () => { s.calls.creates++; throw new Error('response lost'); };
  await assert.rejects(s.object.launch(config));
  await s.object.launch(config); assert.equal(s.calls.creates, 1);
  s.object.github.find = async () => [{ name: 'demo-recovered' }];
  assert.equal((await s.object.launch(config)).name, 'demo-recovered');
  assert.equal(s.calls.creates, 1);
});

test('quota or permission refusal has a cooldown and no paid machine fallback', async () => {
  const s = setup();
  s.object.github.create = async () => { s.calls.creates++; throw new GitHubFailure(403); };
  await assert.rejects(s.object.launch(config));
  assert.equal((await s.object.launch(config)).phase, 'refused');
  assert.equal(s.calls.creates, 1);
  s.tick(IDLE_MS); await s.object.alarm(); assert.equal(await s.storage.get('state'), undefined);
});

test('disabled launch and unavailable image fail before creation', async () => {
  const s = setup(); s.env.LAUNCH_ENABLED = 'false';
  await assert.rejects(s.object.launch(config)); assert.equal(s.calls.creates, 0);
  s.env.LAUNCH_ENABLED = 'true'; s.object.github.verifyConfig = async () => { throw new Error('image mismatch'); };
  await assert.rejects(s.object.launch(config)); assert.equal(s.calls.creates, 0);
});

test('Codespace image/start failure is reported without refreshing into repeated creation', async () => {
  const s = setup({ ...ready, phase: 'starting' });
  s.object.github.get = async () => ({ state: 'Failed' });
  assert.equal((await s.object.launch(config)).phase, 'failed');
  assert.equal((await s.object.launch(config)).phase, 'failed');
  assert.equal(s.calls.creates, 0);
});

test('proxy preserves origin, CSRF, secure cookies, queries and private port authentication', async () => {
  const s = setup(ready);
  s.object.transport = async (target, options) => {
    assert.equal(target.href, `${ready.origin}/api/feed?limit=20`);
    assert.equal(options.headers.get('X-Github-Token'), ready.portToken);
    assert.equal(options.headers.get('X-Tunnel-Skip-AntiPhishing-Page'), '1');
    assert.equal(options.headers.get('X-Tunnel-Authorization'), null);
    assert.equal(options.headers.get('Origin'), 'https://demo.example');
    assert.equal(options.headers.get('X-CSRF-Protection'), '1');
    assert.equal(options.headers.get('X-Forwarded-Proto'), 'https');
    assert.equal(options.headers.get('Cookie'), 'session=app');
    const headers = new Headers();
    headers.append('Set-Cookie', 'session=new; Domain=github.dev; Path=/; HttpOnly; SameSite=Lax');
    headers.append('Set-Cookie', '.Tunnels.Relay.WebForwarding.Cookies=private-tunnel-session; Path=/; Secure; HttpOnly');
    return new Response('ok', { headers });
  };
  const response = await s.request('proxy', '/api/feed?limit=20', { headers: {
    Origin: 'https://demo.example', 'X-CSRF-Protection': '1', 'X-Github-Token': 'visitor-value', 'X-Tunnel-Authorization': 'visitor-value',
    Cookie: '__Host-demo-scenario=music; .Tunnels.Relay.WebForwarding.Cookies=visitor-tunnel-session; session=app',
  } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /; Secure/);
  assert.doesNotMatch(response.headers.get('Set-Cookie'), /Domain=/);
  assert.doesNotMatch(response.headers.get('Set-Cookie'), /Tunnels|private-tunnel-session/);
  assert.equal(response.headers.get('X-Github-Token'), null);
});

test('external redirects cannot disclose a tunnel token', async () => {
  const s = setup(ready);
  s.object.transport = async (_target, options) => { assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://github.com/login' } }); };
  assert.equal((await s.request('proxy')).status, 502);
});

test('callback accepts only the awaited owner, repository, commit, machine and private domain', async () => {
  const s = setup({ ...ready, phase: 'starting' });
  s.object.transport = async () => Response.json({ status: 'UP' });
  const body = { name: ready.name, domain: 'app.github.dev', portToken: 'new-private-token-with-enough-length', credentials: demoCredentials };
  assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify({ ...body, domain: 'evil.app.github.dev' }) })).status, 403);
  assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify(body) })).status, 200);
  assert.equal((await s.storage.get('state')).phase, 'ready');
});

test('a codespace created from the pinned SHA can register when GitHub reports detached HEAD', async () => {
  const s = setup();
  await s.object.launch(config);
  const get = s.object.github.get;
  s.object.github.get = async () => ({ ...await get(), git_status: { ref: 'HEAD' } });
  s.object.transport = async () => Response.json({ status: 'UP' });
  const body = { name: 'demo-one', domain: 'app.github.dev', portToken: 'private-token-with-enough-length', credentials: demoCredentials };
  assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify({ ...body, name: 'other-codespace' }) })).status, 409);
  assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify(body) })).status, 200);
  assert.equal((await s.storage.get('state')).phase, 'ready');
});

test('registration rejects a branch, a different SHA, or mismatched codespace metadata', async () => {
  for (const override of [
    { git_status: { ref: 'main' } }, { git_status: { ref: 'e'.repeat(40) } },
    { git_status: {} }, { owner: { login: 'other' } },
    { repository: { full_name: 'owner/other' } }, { machine: { cpus: 4 } },
  ]) {
    const s = setup({ ...ready, phase: 'starting' });
    const get = s.object.github.get;
    s.object.github.get = async () => ({ ...await get(), ...override });
    const body = { name: ready.name, domain: 'app.github.dev', portToken: 'private-token-with-enough-length', credentials: demoCredentials };
    assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify(body) })).status, 403);
    assert.equal((await s.storage.get('state')).phase, 'starting');
  }
});

test('readiness accepts Spring Actuator JSON but rejects an HTML login page or a non-ready app', async () => {
  for (const [type, responseBody, expectedStatus] of [
    ['application/vnd.spring-boot.actuator.v3+json; charset=UTF-8', '{"status":"UP"}', 200],
    ['text/html', '<html>Sign in</html>', 503],
    ['application/jsonp', '{"status":"UP"}', 503],
    ['application/vnd.spring-boot.actuator.v3+json', '{"status":"DOWN"}', 503],
  ]) {
    const s = setup({ ...ready, phase: 'starting' });
    s.object.transport = async () => new Response(responseBody, { headers: { 'Content-Type': type } });
    const body = { name: ready.name, domain: 'app.github.dev', portToken: 'private-token-with-enough-length', credentials: demoCredentials };
    assert.equal((await s.request('register', '/__demo/register', { method: 'POST', body: JSON.stringify(body) })).status, expectedStatus);
    assert.equal((await s.storage.get('state')).phase, expectedStatus === 200 ? 'ready' : 'starting');
  }
});

test('unknown slugs and visitor supplied references cannot reach GitHub', async () => {
  const worker = createWorker({ music: config });
  const env = { GITHUB_REPOSITORY: config.repository, SCENARIOS: { idFromName: () => { throw new Error('must not reach namespace'); } } };
  assert.equal((await worker.fetch(new Request('https://demo.example/preview/unknown'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://demo.example/preview/music?ref=main'), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/register', { method: 'POST', body: '{}' }), env)).status, 403);
});

test('known slugs use distinct Durable Objects and API queries are preserved', async () => {
  const second = { ...config, devcontainerPath: '.devcontainer/other/devcontainer.json' };
  const worker = createWorker({ music: config, other: second });
  const seen = [];
  const env = { GITHUB_REPOSITORY: config.repository, LAUNCH_ENABLED: 'true', SCENARIOS: {
    idFromName: name => { seen.push(name); return name; }, get: () => ({ fetch: async request => Response.json(request.headers.get('X-Demo-Action') === 'credentials' ? demoCredentials : { phase: 'ready' }) }),
  } };
  for (const slug of ['music', 'other']) assert.equal((await worker.fetch(new Request(`https://demo.example/preview/${slug}`), env)).status, 200);
  assert.deepEqual(seen, ['music', 'other']);
  assert.equal((await worker.fetch(new Request('https://demo.example/api/feed?limit=20', { headers: { Cookie: '__Host-demo-scenario=music' } }), env)).status, 200);
});

test('catalog rejects mutable image tags, arbitrary paths and launcher branches', () => {
  assert.equal(validateScenario('music', config, config.repository), config);
  for (const change of [{ image: 'ghcr.io/owner/demo:latest' }, { launcherCommit: 'main' }, { repository: 'evil/repo' }, { devcontainerPath: '../file' }]) {
    assert.throws(() => validateScenario('music', { ...config, ...change }, config.repository));
  }
});

test('GitHub selects the smallest two core machine and pins creation parameters', async () => {
  const requests = [];
  const github = new GitHub({ GITHUB_TOKEN: 'management' }, async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.includes('/machines?') ? { machines: [{ name: 'big', cpus: 4, memory_in_bytes: 10 }, { name: 'small', cpus: 2, memory_in_bytes: 8 }, { name: 'larger', cpus: 2, memory_in_bytes: 16 }] } : { name: 'created' });
  });
  const machine = await github.smallestMachine(config); assert.equal(machine, 'small');
  await github.create(config, machine, 'display');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.ref, config.launcherCommit); assert.equal(body.machine, 'small');
  assert.equal(body.idle_timeout_minutes, 240); assert.equal(body.retention_period_minutes, 0);
  assert.equal(body.multi_repo_permissions_opt_out, true);
});

test('literal ten minute boundary starts at the public URL and polling never renews it', async () => {
  const s = setup();
  s.object.transport = async () => Response.json({ status: 'UP' });
  const worker = createWorker({ music: config });
  const env = { ...s.env, SCENARIOS: { idFromName: slug => slug, get: () => ({ fetch: request => s.object.fetch(request) }) } };
  assert.equal((await worker.fetch(new Request('https://demo.example/preview/music'), env)).status, 202);
  assert.equal(s.calls.creates, 1);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/register', {
    method: 'POST', headers: { Authorization: `Bearer ${env.CALLBACK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'music', name: 'demo-one', domain: 'app.github.dev', portToken: 'x'.repeat(32), credentials: demoCredentials }),
  }), env)).status, 200);
  const initial = await s.storage.get('state');
  s.tick(599_999);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/status/music'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/credentials', { headers: { Cookie: '__Host-demo-scenario=music' } }), env)).status, 200);
  assert.equal((await s.storage.get('state')).lastActivity, initial.lastActivity);
  await s.object.alarm();
  assert.equal(s.calls.deletes, 0);
  s.tick(1);
  await s.object.alarm();
  assert.equal(s.calls.deletes, 1);
  assert.equal(await s.storage.get('state'), undefined);
  assert.equal((await worker.fetch(new Request('https://demo.example/__demo/status/music'), env)).status, 410);
  assert.equal(s.calls.creates, 1);
});

test('multi account callback validates ordered stable identities and distinct passwords', async () => {
  const accounts = [{ id: 'author', email: 'author@enois.invalid', label: 'Author' }, { id: 'reader', email: 'reader@enois.invalid', label: 'Reader' }];
  const selected = { ...config, accounts, revision: 'f'.repeat(64) };
  const s = setup({ ...ready, config: selected, phase: 'starting' });
  s.object.transport = async () => Response.json({ status: 'UP' });
  const callback = credentials => s.request('register', '/', { method: 'POST', body: JSON.stringify({ name: ready.name, domain: 'app.github.dev', portToken: 'x'.repeat(32), credentials }) });
  const credentials = { accounts: accounts.map((account, index) => ({ ...account, password: String(index).repeat(32) })) };
  assert.equal((await callback(credentials)).status, 200);
  assert.deepEqual(await (await s.request('credentials')).json(), credentials);
  assert.equal((await callback({ accounts: [...credentials.accounts].reverse() })).status, 403);
  assert.equal((await callback({ accounts: credentials.accounts.map(account => ({ ...account, password: 'x'.repeat(32) })) })).status, 403);
});

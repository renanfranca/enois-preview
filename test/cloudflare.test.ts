import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real Cloudflare runtime persists SQLite state and serializes simultaneous launch requests', async () => {
  const config = { format: 'enois-preview-ts-v1', revision: 'f'.repeat(64), accounts: [{id:'author',email:'author@enois.invalid',label:'Author'}], repository: 'owner/launcher', launcherCommit: 'a'.repeat(40), image: `ghcr.io/owner/demo@sha256:${'b'.repeat(64)}`, devcontainerPath: '.devcontainer/music/devcontainer.json', provenanceSha256: 'c'.repeat(64) };
  const bundled = await build({ stdin: {
    contents: `import {createWorker} from './src/worker.ts'; export {Scenario} from './src/scenario.ts'; export default createWorker(${JSON.stringify({ format:'enois-preview-ts-v1', scenarios:{ music: config } })});`,
    resolveDir: process.cwd(), sourcefile: 'integration.mjs', loader: 'js',
  }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  let creates = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0]!.text, compatibilityDate: '2026-10-01',
    durableObjects: { SCENARIOS: { className: 'Scenario', useSQLite: true } },
    bindings: { GITHUB_REPOSITORY: config.repository, GITHUB_OWNER: 'owner', GITHUB_TOKEN: 'management', CALLBACK_SECRET: 'callback', LAUNCH_ENABLED: 'true' },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.pathname.includes('/contents/')) return Response.json({ content: btoa(JSON.stringify({ image: config.image, overrideCommand: true, forwardPorts: [3000] })) });
      if (url.pathname.endsWith('/machines')) return Response.json({ machines: [{ name: 'small', cpus: 2, memory_in_bytes: 8_000_000_000 }] });
      if (request.method === 'POST' && url.pathname.endsWith('/codespaces')) { creates++; return Response.json({ name: 'native-codespace' }, { status: 201 }); }
      if (url.pathname === '/user/codespaces/native-codespace') return Response.json({ name:'native-codespace', owner: { login: 'owner' }, repository: { full_name: config.repository }, machine: { cpus: 2 }, git_status: { ref: config.launcherCommit } });
      if (url.hostname.endsWith('.app.github.dev')) {
        assert.equal(request.headers.get('X-Github-Token'), 'native-private-token-long-enough');
        if (url.pathname.endsWith('/readiness')) return Response.json({ status: 'UP' });
        return Response.json({ origin: request.headers.get('Origin'), csrf: request.headers.get('X-CSRF-Protection'), body: await request.json() }, { headers: { 'Set-Cookie': 'enois_session=fake-session; Path=/; HttpOnly; SameSite=Lax' } });
      }
      throw new Error(`Unexpected test route ${request.method} ${url.pathname}`);
    },
  }));
  try {
    const responses = await Promise.all(Array.from({ length: 10 }, () => mf.dispatchFetch('https://demo.example/preview/music')));
    assert.deepEqual(responses.map(r => r.status), Array(10).fill(202));
    await Promise.all(responses.map(r => r.arrayBuffer()));
    assert.equal(creates, 1);
    const registered = await mf.dispatchFetch('https://demo.example/__demo/register', {
      method: 'POST', headers: { Authorization: 'Bearer callback', 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'music', name: 'native-codespace', domain: 'app.github.dev', portToken: 'native-private-token-long-enough', credentials: { format:'enois-preview-ts-v1',accounts:[{id:'author',email:'author@enois.invalid',label:'Author',password:'d'.repeat(32)}] } }),
    });
    assert.equal(registered.status, 200, await registered.text());
    const ready = await mf.dispatchFetch('https://demo.example/preview/music', { redirect: 'manual' });
    assert.equal(ready.status, 200);
    assert.match(ready.headers.get('Set-Cookie') ?? '', /Secure; HttpOnly; SameSite=Lax/);
    const html = await ready.text();
    assert.match(html, /author@enois.invalid/);
    assert.match(html, /href="\/entrar\?tab=login"/);
    assert.match(html, new RegExp('d'.repeat(32)));
    assert.doesNotMatch(html, /native-private-token|management|Bearer callback/);
    const activity = await mf.dispatchFetch('https://demo.example/__demo/activity', {
      method: 'POST', headers: { Cookie: '__Host-demo-scenario=music', Origin: 'https://demo.example', 'X-Demo-Activity': '1' },
    });
    assert.equal(activity.status, 204);
    const proxied = await mf.dispatchFetch('https://demo.example/api/feed/posts?mode=test', {
      method: 'POST', headers: { Cookie: '__Host-demo-scenario=music', Origin: 'https://demo.example', 'X-CSRF-Protection': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });
    assert.equal(proxied.status, 200);
    assert.match(proxied.headers.get('Set-Cookie') ?? '', /; Secure/);
    assert.deepEqual(await proxied.json(), { origin: 'https://demo.example', csrf: '1', body: { content: 'test' } });
  } finally { await mf.dispose(); }
});

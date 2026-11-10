import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

type Outcome = { code: number | null; stdout: string; stderr: string };
// Entry points that read configuration from the environment run with only PATH, so none reaches network, files or children.
const bare = { PATH: process.env.PATH ?? '' };
function run(root: string, script: string, args: string[] = [], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): Outcome {
  const result = spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8', timeout: 20_000, ...options });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
function withCurrent(work: (roots: string[], directory: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const directory = mkdtempSync(join(tmpdir(), 'enois-entry-points-'));
    try { const real = resolve('.'); const current = join(directory, 'current'); symlinkSync(real, current); await work([current, real], directory); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  };
}

test('service and script entry points behave the same through the installer current symlink as through their real path', withCurrent((roots, directory) => {
  const database = join(directory, 'fixture.mv.db'); const config = join(directory, 'service.json');
  writeFileSync(config, JSON.stringify({ format: 'enois-preview-ts-v1', database, jar: config, cwd: directory, port: 18089, pidfile: join(directory, 'absent.pid'), log: join(directory, 'service.log') }));
  for (const root of roots) {
    assert.deepEqual(run(root, 'dist/preview/service.js', [config, 'identity']), { code: 0, stdout: `${database}\n`, stderr: '' }, root);
    assert.deepEqual(run(root, 'dist/preview/service.js', [config, 'status']), { code: 0, stdout: 'stopped\n', stderr: '' }, root);
    assert.deepEqual(run(root, 'dist/scripts/pin-scenario.js'), { code: 1, stdout: '', stderr: 'Usage: node dist/scripts/pin-scenario.js SLUG LAUNCHER_COMMIT_SHA\n' }, root);
  }
}));

test('recipe and example preparation entry points refuse missing arguments the same way through the current symlink', withCurrent(roots => {
  for (const root of roots) {
    assert.deepEqual(run(root, 'dist/recipe/prepare.js'), { code: 1, stdout: '', stderr: 'Usage: node dist/recipe/prepare.js FROZEN_BUILD_CONTEXT\n' }, root);
    assert.deepEqual(run(root, 'dist/example/prepare.js'), { code: 1, stdout: '', stderr: 'Usage: npm run example:prepare -- /ABSOLUTE/NEW_WORKSPACE\n' }, root);
  }
}));

test('image runtime entry points answer the same way through the current symlink as through their real path', withCurrent(async roots => {
  for (const root of roots) {
    assert.deepEqual(run(root, 'dist/runtime/image-type.js', [], { input: '[]' }), { code: 0, stdout: '[]', stderr: '' }, root);
    assert.deepEqual(run(root, 'dist/runtime/start.js', [], { env: bare }), { code: 1, stdout: '', stderr: 'Demo startup failed; inspect private runtime diagnostics and configured environment.\n' }, root);
    assert.deepEqual(run(root, 'dist/runtime/register-codespace.js', [], { env: bare }), { code: 1, stdout: '', stderr: 'Private port registration failed; inspect configured startup environment.\n' }, root);
    // Outside the image the gateway cannot find its runtime manifest; reaching that read proves the entry point ran.
    const gateway = spawn(process.execPath, [join(root, 'dist/runtime/gateway.js')], { env: { ...bare, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; gateway.stdout.on('data', chunk => { stdout += String(chunk); }); gateway.stderr.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => gateway.kill('SIGKILL'), 20_000);
    const code = await new Promise<number | null>(done => gateway.once('close', done)); clearTimeout(timer);
    assert.equal(code, 1, root); assert.equal(stdout, '', root); assert.match(stderr, /ENOENT.*\/opt\/render-demo\/runtime-manifest\.json/, root);
  }
}));

import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const serviceJs = fileURLToPath(new URL('../preview/service.js', import.meta.url));
const fakeJava = fileURLToPath(new URL('./fixtures/fake-java.js', import.meta.url));
type Outcome = { code: number | null; stdout: string; stderr: string };
interface Home { root: string; config: string; pidfile: string; env: NodeJS.ProcessEnv; run: (action: string) => Outcome; aux: () => Promise<ChildProcess> }

function alive(pid: number): boolean {
  try { return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
}
function starttime(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
}
async function until(check: () => boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds; while (Date.now() < deadline) { if (check()) return true; await delay(20); } return check();
}
function pidOf(home: Home): number {
  const text = readFileSync(home.pidfile, 'utf8').trim(); return /^\d+$/.test(text) ? Number(text) : Number(JSON.parse(text).pid);
}

function serviceHome(work: (home: Home) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), 'enois-service-journey-'));
    const bin = join(root, 'bin'), cwd = join(root, 'backend'), signals = join(root, 'signals');
    for (const directory of [bin, cwd, signals]) mkdirSync(directory);
    writeFileSync(join(bin, 'java'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeJava)} "$@"\n`); chmodSync(join(bin, 'java'), 0o755);
    const config = join(root, 'service.json'), pidfile = join(root, 'backend.pid');
    writeFileSync(config, JSON.stringify({ format: 'enois-preview-ts-v1', database: join(root, 'data/rede.mv.db'), jar: join(cwd, 'rede.jar'), cwd, port: 18097, pidfile, log: join(root, 'backend.log') }));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_JAVA_ROOT: signals };
    const run = (action: string): Outcome => { const result = spawnSync(process.execPath, [serviceJs, config, action], { encoding: 'utf8', env, timeout: 90_000 }); return { code: result.status, stdout: result.stdout, stderr: result.stderr }; };
    const helpers: ChildProcess[] = [];
    const aux = async () => {
      const child = spawn(process.execPath, [fakeJava], { env, stdio: 'ignore' }); helpers.push(child);
      assert.ok(await until(() => existsSync(join(signals, `started-${child.pid}`)), 10_000), 'auxiliary process did not start'); return child;
    };
    try { await work({ root, config, pidfile, env, run, aux }); }
    finally {
      for (const name of readdirSync(signals).filter(name => name.startsWith('started-'))) { try { process.kill(Number(name.slice(8)), 'SIGKILL'); } catch {} }
      for (const child of helpers) child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  };
}
const signalled = (home: Home, pid: number) => existsSync(join(home.root, 'signals', `sigterm-${pid}`));

test('an orphaned stop ends with the backend it signalled and leaves a newer backend running and owned', serviceHome(async home => {
  writeFileSync(join(home.root, 'signals', 'hold'), '');
  assert.equal(home.run('start').code, 0); assert.equal(home.run('status').stdout, 'running\n');
  const first = pidOf(home);

  const stop = spawn(process.execPath, [serviceJs, home.config, 'stop'], { env: home.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; stop.stderr!.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise<number | null>(done => stop.once('close', done));
  assert.ok(await until(() => signalled(home, first), 10_000), 'first backend did not receive the stop');
  process.kill(stop.pid!, 'SIGSTOP');
  writeFileSync(join(home.root, 'signals', `release-${first}`), '');
  assert.ok(await until(() => !alive(first), 10_000), 'first backend did not exit');
  assert.equal(home.run('start').code, 0);
  const second = pidOf(home); assert.notEqual(second, first);
  assert.equal(home.run('status').stdout, 'running\n');
  process.kill(stop.pid!, 'SIGCONT');
  const resumed = Date.now(); const code = await Promise.race([exited, delay(75_000).then(() => 'timeout' as const)]);

  assert.equal(code, 0, stderr); assert.ok(Date.now() - resumed < 10_000, `orphaned stop took ${Date.now() - resumed} ms`);
  assert.doesNotMatch(stderr, /did not stop/);
  assert.equal(alive(second), true); assert.equal(signalled(home, second), false);
  assert.equal(existsSync(home.pidfile), true); assert.equal(pidOf(home), second);
  assert.deepEqual(home.run('status'), { code: 0, stdout: 'running\n', stderr: '' });
}));

test('a pidfile naming a reused PID with another start time counts as stopped and start replaces it without signalling that process', serviceHome(async home => {
  const other = await home.aux();
  writeFileSync(home.pidfile, JSON.stringify({ pid: other.pid, starttime: starttime(other.pid!) + 1 }), { mode: 0o600 });

  const status = home.run('status'); const start = home.run('start');

  assert.deepEqual(status, { code: 0, stdout: 'stopped\n', stderr: '' });
  assert.equal(start.code, 0, start.stderr); const backend = pidOf(home);
  assert.notEqual(backend, other.pid); assert.equal(home.run('status').stdout, 'running\n');
  assert.equal(alive(other.pid!), true); assert.equal(signalled(home, other.pid!), false);
}));

test('a pidfile naming a live process with its own start time but foreign ownership is refused without signalling it', serviceHome(async home => {
  const other = await home.aux();
  writeFileSync(home.pidfile, JSON.stringify({ pid: other.pid, starttime: starttime(other.pid!) }), { mode: 0o600 });

  const status = home.run('status'); const stop = home.run('stop');

  for (const outcome of [status, stop]) assert.deepEqual(outcome, { code: 1, stdout: '', stderr: 'Backend ownership mismatch; no process was signalled.\n' });
  assert.equal(alive(other.pid!), true); assert.equal(signalled(home, other.pid!), false);
}));

test('a legacy PID-only pidfile keeps the previous status, stop and ownership behavior', serviceHome(async home => {
  assert.equal(home.run('start').code, 0); const backend = pidOf(home);
  writeFileSync(home.pidfile, String(backend), { mode: 0o600 });

  assert.deepEqual(home.run('status'), { code: 0, stdout: 'running\n', stderr: '' });
  assert.equal(home.run('stop').code, 0);
  assert.equal(alive(backend), false); assert.equal(signalled(home, backend), true);
  writeFileSync(home.pidfile, String(backend), { mode: 0o600 });
  assert.deepEqual(home.run('status'), { code: 0, stdout: 'stopped\n', stderr: '' });

  const other = await home.aux(); writeFileSync(home.pidfile, String(other.pid), { mode: 0o600 });
  for (const action of ['status', 'stop']) assert.deepEqual(home.run(action), { code: 1, stdout: '', stderr: 'Backend ownership mismatch; no process was signalled.\n' });
  assert.equal(alive(other.pid!), true); assert.equal(signalled(home, other.pid!), false);
}));

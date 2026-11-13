import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { create } from 'tar';
import { inventory } from '../../preview/state.js';
import { exportPublic } from '../../scripts/export-public.js';

type Result = { code: number | null; stdout: string; stderr: string };
function install(archives: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<Result> {
  return command(resolve('dist/test/fixtures/install-driver.js'), env, archives, ...args);
}
function command(script: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<Result> { return program(process.execPath, [script, ...args], env); }
function program(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject); child.on('close', code => done({ code, stdout, stderr }));
  });
}
function installing(archives: string, env: NodeJS.ProcessEnv, ...args: string[]): { child: ChildProcess; finished: Promise<Result> } {
  return running(resolve('dist/test/fixtures/install-driver.js'), env, archives, ...args);
}
function running(script: string, env: NodeJS.ProcessEnv, ...args: string[]): { child: ChildProcess; finished: Promise<Result> } {
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout?.on('data', chunk => { stdout += String(chunk); }); child.stderr?.on('data', chunk => { stderr += String(chunk); });
  return { child, finished: new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done({ code, stdout, stderr })); }) };
}
async function appeared(file: string): Promise<number> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { const pid = Number(existsSync(file) ? readFileSync(file, 'utf8').trim() : ''); if (pid > 0) return pid; await delay(20); }
  throw new Error(`${file} never appeared`);
}
async function within(finished: Promise<Result>, child: ChildProcess): Promise<Result> {
  const result = await Promise.race([finished, delay(10_000).then(() => undefined)]);
  if (!result) { child.kill('SIGKILL'); assert.fail('The interrupted installer did not end within 10 s'); }
  return result;
}
function ended(pid: number): void {
  const stat = `/proc/${pid}/stat`;
  if (existsSync(stat)) assert.match(readFileSync(stat, 'utf8'), /^\d+ \(.*\) [ZX] /s, `process ${pid} must have terminated`);
}
function served(file: string): Server {
  return createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/x-gzip' }).end(readFileSync(file)); });
}
async function listening(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/tar.gz`;
}

async function archive(work: string, name: string, root: string, change?: (source: string) => Promise<void>): Promise<{ file: string; source: string }> {
  const parent = join(work, name); const source = join(parent, root);
  await exportPublic(source); await change?.(source);
  const file = join(work, `${name}.tar.gz`); await create({ cwd: parent, file, gzip: true, portable: true }, [root]);
  return { file, source };
}

test('the installer command interrupted while its download is pending ends promptly and leaves no partial installation', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-download-interrupted-'));
  const commit = 'b'.repeat(40);
  try {
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      const tunnels: string[] = []; const held: Socket[] = []; let tunnelled = (): void => {}; const first = new Promise<void>(done => { tunnelled = done; });
      const proxy = createServer((_request, response) => { response.writeHead(405).end(); });
      proxy.on('connect', (request, socket: Socket) => { tunnels.push(request.url ?? ''); held.push(socket); socket.on('error', () => {}); tunnelled(); });
      await listening(proxy); const address = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      const home = join(work, `home-${signal}`); await mkdir(home); const prefix = join(work, `prefix-${signal}`);
      const { child, finished } = running(resolve('dist/scripts/install-tool.js'), { HOME: home, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: address, https_proxy: address, NO_PROXY: '', no_proxy: '' }, '--commit', commit, '--prefix', prefix);
      try {
        await first;
        child.kill(signal);

        const result = await within(finished, child);

        assert.equal(result.code, code, result.stderr);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `Interrupted by ${signal}; cancelling active work and completing required restoration.\nInterrupted by ${signal}.\n`);
        assert.deepEqual(tunnels, ['codeload.github.com:443']);
        assert.deepEqual(existsSync(prefix) ? readdirSync(prefix).filter(name => name === commit || name === 'current' || name.startsWith('.staging-')) : [], []);
      } finally {
        child.kill('SIGKILL'); for (const socket of held) socket.destroy();
        await new Promise(done => proxy.close(done));
      }
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('the installer command downloads only from the public codeload origin, even when ENOIS_PREVIEW_TEST_ARCHIVES names another origin', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-origin-'));
  const commit = 'a'.repeat(40); const prefix = join(work, 'prefix');
  const archiveRequests: string[] = []; const tunnels: string[] = [];
  const archives = createServer((request, response) => { archiveRequests.push(request.url ?? ''); response.writeHead(404).end(); });
  const proxy = createServer((_request, response) => { response.writeHead(405).end(); });
  proxy.on('connect', (request, socket) => { tunnels.push(request.url ?? ''); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  archives.listen(0, '127.0.0.1'); proxy.listen(0, '127.0.0.1');
  await Promise.all([new Promise(done => archives.once('listening', done)), new Promise(done => proxy.once('listening', done))]);
  try {
    const env = {
      ENOIS_PREVIEW_TEST_ARCHIVES: `http://127.0.0.1:${(archives.address() as AddressInfo).port}/tar.gz`,
      NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, NO_PROXY: ''
    };

    const attempted = await command(resolve('dist/scripts/install-tool.js'), env, '--commit', commit, '--prefix', prefix);

    assert.notEqual(attempted.code, 0);
    assert.deepEqual(archiveRequests, []);
    assert.deepEqual(tunnels, ['codeload.github.com:443']);
    assert.equal(existsSync(join(prefix, commit)), false);
    assert.equal(existsSync(join(prefix, 'current')), false);
  } finally {
    archives.close(); proxy.close();
    await rm(work, { recursive: true, force: true });
  }
});

test('installing a public commit creates a stamped installation outside the development folder, refuses replacement or another commit, and stays verified when the source changes later', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-tool-'));
  const commit = 'c'.repeat(40); const foreign = 'e'.repeat(40); const sideEffect = 'f'.repeat(40);
  const good = await archive(work, 'good', `enois-preview-${commit}`);
  const other = await archive(work, 'other', `enois-preview-${'d'.repeat(40)}`);
  const dirty = await archive(work, 'dirty', `enois-preview-${sideEffect}`, async source => {
    const file = join(source, 'package.json'); const pkg = JSON.parse(await readFile(file, 'utf8'));
    pkg.scripts.build = `${pkg.scripts.build} && node -e "require('fs').writeFileSync('build-side-effect.txt','')"`; await writeFile(file, JSON.stringify(pkg, null, 2));
  });
  const served: Record<string, string> = { [commit]: good.file, [foreign]: other.file, [sideEffect]: dirty.file };
  const server = createServer((request, response) => {
    const file = served[(request.url ?? '').replace('/tar.gz/', '')];
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/x-gzip' }).end(readFileSync(file));
  });
  server.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  try {
    const global = join(work, 'global'); await mkdir(global);
    const tools = join(work, 'tools'); await mkdir(tools); const browserCalls = join(work, 'browser-calls.txt');
    await writeFile(join(tools, 'npx'), `#!/bin/sh\nprintf '%s %s\\n' "$PWD" "$*" >> '${browserCalls}'\n`, { mode: 0o755 });
    const archives = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tar.gz`; const env = { NPM_CONFIG_PREFIX: global, PATH: `${tools}:${process.env.PATH}` };
    const prefix = join(work, 'prefix'); const installation = join(prefix, commit);

    const installed = await install(archives, env, '--commit', commit, '--prefix', prefix);

    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).installation, installation);
    assert.equal(JSON.parse(installed.stdout).browser, true);
    assert.equal(readFileSync(browserCalls, 'utf8'), `${realpathSync(installation)} --no-install playwright install chromium\n`);
    const stamp = JSON.parse(readFileSync(join(installation, 'install.json'), 'utf8'));
    assert.equal(stamp.commit, commit);
    assert.deepEqual(stamp.source, await inventory(good.source));
    assert.deepEqual(stamp.dist, await inventory(join(installation, 'dist')));
    assert.equal(existsSync(join(installation, 'dist/preview/cli.js')), true);
    assert.equal(statSync(join(installation, 'install.json')).mode & 0o777, 0o600);
    assert.equal(readlinkSync(join(prefix, 'current')), commit);
    assert.equal(realpathSync(join(global, 'lib/node_modules/enois-preview')), realpathSync(installation));
    assert.deepEqual(readdirSync(prefix).filter(name => name.startsWith('.')), []);

    const database = join(work, 'fixture.mv.db'); const serviceConfig = join(work, 'service.json');
    await writeFile(serviceConfig, JSON.stringify({ format: 'enois-preview-ts-v1', database, jar: serviceConfig, cwd: work, port: 18089, pidfile: join(work, 'absent.pid'), log: join(work, 'service.log') }));
    const throughCurrent = await command(join(prefix, 'current/dist/preview/service.js'), {}, serviceConfig, 'identity');

    assert.deepEqual(throughCurrent, { code: 0, stdout: `${database}\n`, stderr: '' });

    const before = readFileSync(join(installation, 'install.json'));
    const again = await install(archives, env, '--commit', commit, '--prefix', prefix);

    assert.notEqual(again.code, 0); assert.match(again.stderr, /^Commit c{40} is already installed at .*; installations are immutable.\n$/);
    assert.deepEqual(readFileSync(join(installation, 'install.json')), before);

    const separate = join(work, 'separate'); await mkdir(separate);
    const mismatched = await install(archives, env, '--commit', foreign, '--prefix', separate);

    assert.notEqual(mismatched.code, 0); assert.match(mismatched.stderr, /^Archive root differs from enois-preview-e{40}; refusing to install another commit.\n$/);
    assert.deepEqual(readdirSync(separate), []);

    const unstable = join(work, 'unstable');
    const changed = await install(archives, env, '--commit', sideEffect, '--prefix', unstable);

    assert.notEqual(changed.code, 0); assert.match(changed.stderr, /Build changed source files outside dist: build-side-effect\.txt/);
    assert.equal(existsSync(join(unstable, sideEffect)), false); assert.equal(existsSync(join(unstable, 'current')), false);
    assert.equal(readFileSync(browserCalls, 'utf8').split('\n').length, 2, 'Only the completed installation fetches the browser');

    const installedFiles = await inventory(installation, ['node_modules']);
    await writeFile(join(good.source, 'preview/cli.ts'), '// development change after installation\n');
    await rm(join(good.source, 'recipe'), { recursive: true });

    const { verifiedCommit } = await import(pathToFileURL(join(installation, 'dist/preview/installation.js')).href) as { verifiedCommit: (root: string) => Promise<string> };

    assert.equal(await verifiedCommit(installation), commit);
    assert.deepEqual(await inventory(installation, ['node_modules']), installedFiles);
  } finally {
    server.close();
    await rm(work, { recursive: true, force: true });
  }
});

test('the bootstrap script refuses a branch, tag or short commit before any download and without leaving temporary files', async () => {
  const work = await mkdtemp(join(tmpdir(), 'enois-bootstrap-arguments-'));
  try {
    for (const args of [[], ['main'], ['v0.3.8'], ['a'.repeat(39)], ['A'.repeat(40)]]) {
      const refused = await program('bash', [resolve('install.sh'), ...args], { TMPDIR: work, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9' });

      assert.equal(refused.code, 1, args.join(' '));
      assert.match(refused.stderr, /^Usage: install\.sh PUBLIC_TOOL_COMMIT \[--prefix DIRECTORY\]\nUse the full 40 character public tool commit, never a branch or tag\.\n$/);
      assert.deepEqual(readdirSync(work), []);
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('the bootstrap script downloads only from the public codeload origin and removes its temporary directory when the download fails', async () => {
  const work = await mkdtemp(join(tmpdir(), 'enois-bootstrap-origin-'));
  const commit = 'b'.repeat(40); const prefix = join(work, 'prefix'); const temporary = join(work, 'tmp'); await mkdir(temporary);
  const tunnels: string[] = [];
  const proxy = createServer((_request, response) => { response.writeHead(405).end(); });
  proxy.on('connect', (request, socket) => { tunnels.push(request.url ?? ''); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  proxy.listen(0, '127.0.0.1'); await new Promise(done => proxy.once('listening', done));
  try {
    const address = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    const attempted = await program('bash', [resolve('install.sh'), commit, '--prefix', prefix], { TMPDIR: temporary, HTTPS_PROXY: address, https_proxy: address, NO_PROXY: '', no_proxy: '' });

    assert.equal(attempted.code, 1);
    assert.match(attempted.stderr, /Download of commit b{40} failed\. Confirm that it is a published public commit\.\n$/);
    assert.deepEqual(tunnels, ['codeload.github.com:443']);
    assert.deepEqual(readdirSync(temporary), []);
    assert.equal(existsSync(prefix), false);
  } finally {
    proxy.close();
    await rm(work, { recursive: true, force: true });
  }
});

test('interrupting the installer while it builds stops the build and leaves no partial installation', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-build-interrupted-'));
  const commit = 'c'.repeat(40); const good = await archive(work, 'good', `enois-preview-${commit}`); const server = served(good.file);
  const tools = join(work, 'tools'); await mkdir(tools); const npmPid = join(work, 'npm.pid');
  await writeFile(join(tools, 'npm'), `#!/bin/sh\necho $$ > '${npmPid}'\nexec sleep 600\n`, { mode: 0o755 });
  const prefix = join(work, 'prefix');
  const { child, finished } = installing(await listening(server), { NPM_CONFIG_PREFIX: join(work, 'global'), PATH: `${tools}:${process.env.PATH}` }, '--commit', commit, '--prefix', prefix);
  let pid: number | undefined;
  try {
    pid = await appeared(npmPid);
    child.kill('SIGINT');

    const result = await within(finished, child);

    assert.equal(result.code, 130, result.stderr);
    assert.match(result.stderr, /Interrupted by SIGINT\.\n$/);
    ended(pid);
    assert.deepEqual(readdirSync(prefix).filter(name => name === commit || name === 'current' || name.startsWith('.staging-')), []);
  } finally {
    child.kill('SIGKILL'); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    server.close(); await rm(work, { recursive: true, force: true });
  }
});

test('interrupting the installer while it fetches Chromium keeps the complete installation and names the retry command', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-browser-interrupted-'));
  const commit = 'c'.repeat(40); const good = await archive(work, 'good', `enois-preview-${commit}`); const server = served(good.file);
  const global = join(work, 'global'); await mkdir(global);
  const tools = join(work, 'tools'); await mkdir(tools); const npxPid = join(work, 'npx.pid');
  await writeFile(join(tools, 'npx'), `#!/bin/sh\necho $$ > '${npxPid}'\nexec sleep 600\n`, { mode: 0o755 });
  const prefix = join(work, 'prefix');
  const { child, finished } = installing(await listening(server), { NPM_CONFIG_PREFIX: global, PATH: `${tools}:${process.env.PATH}` }, '--commit', commit, '--prefix', prefix);
  let pid: number | undefined;
  try {
    pid = await appeared(npxPid);
    child.kill('SIGINT');

    const result = await within(finished, child);

    assert.equal(result.code, 130, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Chromium, used by the public validation, was not installed/);
    assert.match(result.stderr, /retry with: \(cd .* && npx --no-install playwright install chromium\)/);
    assert.equal(JSON.parse(readFileSync(join(prefix, commit, 'install.json'), 'utf8')).commit, commit);
    assert.equal(readlinkSync(join(prefix, 'current')), commit);
    ended(pid);
  } finally {
    child.kill('SIGKILL'); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    server.close(); await rm(work, { recursive: true, force: true });
  }
});

test('interrupting the installer after the installation is created and before Chromium keeps the installation, skips Chromium and names no missing log', async () => {
  const work = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-install-before-browser-interrupted-'));
  const commit = 'c'.repeat(40); const good = await archive(work, 'good', `enois-preview-${commit}`); const server = served(good.file);
  const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  const tools = join(work, 'tools'); await mkdir(tools); const linkPid = join(work, 'link.pid'); const go = join(work, 'go'); const npxPid = join(work, 'npx.pid');
  await writeFile(join(tools, 'npm'), `#!/bin/sh\nif [ "$1" = link ]; then\n  echo $$ > '${linkPid}'\n  i=0; while [ ! -f '${go}' ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done\n  exit 0\nfi\nexec '${realNpm}' "$@"\n`, { mode: 0o755 });
  await writeFile(join(tools, 'npx'), `#!/bin/sh\necho $$ > '${npxPid}'\n`, { mode: 0o755 });
  const prefix = join(work, 'prefix');
  const { child, finished } = installing(await listening(server), { NPM_CONFIG_PREFIX: join(work, 'global'), PATH: `${tools}:${process.env.PATH}` }, '--commit', commit, '--prefix', prefix);
  try {
    await appeared(linkPid);
    child.kill('SIGINT');
    await writeFile(go, '');

    const result = await within(finished, child);

    assert.equal(result.code, 130, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Interrupted by SIGINT; cancelling active work and completing required restoration\.\n/);
    assert.ok(result.stderr.includes(`Chromium, used by the public validation, was not installed. The installation is complete; retry with: (cd ${join(prefix, commit)} && npx --no-install playwright install chromium)\n`), result.stderr);
    assert.equal(result.stderr.includes('(see '), false, result.stderr);
    assert.equal(existsSync(join(prefix, 'logs', `${commit}-browser.log`)), false);
    assert.equal(existsSync(npxPid), false, 'npx must not run after the interruption');
    assert.equal(JSON.parse(readFileSync(join(prefix, commit, 'install.json'), 'utf8')).commit, commit);
    assert.equal(readlinkSync(join(prefix, 'current')), commit);
  } finally {
    child.kill('SIGKILL'); await writeFile(go, '');
    server.close(); await rm(work, { recursive: true, force: true });
  }
});

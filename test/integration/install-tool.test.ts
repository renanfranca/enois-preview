import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
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
async function archive(work: string, name: string, root: string, change?: (source: string) => Promise<void>): Promise<{ file: string; source: string }> {
  const parent = join(work, name); const source = join(parent, root);
  await exportPublic(source); await change?.(source);
  const file = join(work, `${name}.tar.gz`); await create({ cwd: parent, file, gzip: true, portable: true }, [root]);
  return { file, source };
}

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

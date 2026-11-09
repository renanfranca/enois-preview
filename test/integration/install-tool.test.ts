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
function install(env: NodeJS.ProcessEnv, ...args: string[]): Promise<Result> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve('dist/scripts/install-tool.js'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const env = { ENOIS_PREVIEW_TEST_ARCHIVES: `http://127.0.0.1:${(server.address() as AddressInfo).port}/tar.gz`, NPM_CONFIG_PREFIX: global };
    const prefix = join(work, 'prefix'); const installation = join(prefix, commit);

    const installed = await install(env, '--commit', commit, '--prefix', prefix);

    assert.equal(installed.code, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).installation, installation);
    const stamp = JSON.parse(readFileSync(join(installation, 'install.json'), 'utf8'));
    assert.equal(stamp.commit, commit);
    assert.deepEqual(stamp.source, await inventory(good.source));
    assert.deepEqual(stamp.dist, await inventory(join(installation, 'dist')));
    assert.equal(existsSync(join(installation, 'dist/preview/cli.js')), true);
    assert.equal(statSync(join(installation, 'install.json')).mode & 0o777, 0o600);
    assert.equal(readlinkSync(join(prefix, 'current')), commit);
    assert.equal(realpathSync(join(global, 'lib/node_modules/enois-preview')), realpathSync(installation));
    assert.deepEqual(readdirSync(prefix).filter(name => name.startsWith('.')), []);

    const before = readFileSync(join(installation, 'install.json'));
    const again = await install(env, '--commit', commit, '--prefix', prefix);

    assert.notEqual(again.code, 0); assert.match(again.stderr, /^Commit c{40} is already installed at .*; installations are immutable.\n$/);
    assert.deepEqual(readFileSync(join(installation, 'install.json')), before);

    const separate = join(work, 'separate'); await mkdir(separate);
    const mismatched = await install(env, '--commit', foreign, '--prefix', separate);

    assert.notEqual(mismatched.code, 0); assert.match(mismatched.stderr, /^Archive root differs from enois-preview-e{40}; refusing to install another commit.\n$/);
    assert.deepEqual(readdirSync(separate), []);

    const unstable = join(work, 'unstable');
    const changed = await install(env, '--commit', sideEffect, '--prefix', unstable);

    assert.notEqual(changed.code, 0); assert.match(changed.stderr, /Build changed source files outside dist: build-side-effect\.txt/);
    assert.equal(existsSync(join(unstable, sideEffect)), false); assert.equal(existsSync(join(unstable, 'current')), false);

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

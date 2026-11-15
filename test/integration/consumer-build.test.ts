import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateLauncher, WRANGLER_VERSION } from '../../preview/launcher.js';
import { exists, run, writeRecord } from '../../preview/state.js';
import { exportPublic } from '../../scripts/export-public.js';

test('a generated launcher installs the packed tool with lifecycle scripts ignored, needs no build of enois-preview and passes the Worker dry run', async () => {
  const evidence = await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE ?? tmpdir(), 'enois-consumer-build-'));
  const destination = join(evidence, 'launcher');
  const packed = JSON.parse((await run(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', evidence])).toString());
  const tarball = join(evidence, packed[0].filename);

  await generateLauncher(destination, { repository: 'fixture/private-launcher', worker: 'fixture-preview', version: `file:${tarball}` });
  await run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: destination,
    timeout: 600,
    logPath: join(evidence, 'install.log'),
  });
  await run(['npx', '--no-install', 'wrangler', 'deploy', '--dry-run'], {
    cwd: destination,
    timeout: 300,
    logPath: join(evidence, 'check.log'),
  });

  const pkg = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.scripts ?? {}), ['check']);
  assert.equal(pkg.devDependencies.wrangler, WRANGLER_VERSION);
  assert.equal(await exists(join(destination, 'tool.lock.json')), false);
  assert.equal(await exists(join(destination, 'package-lock.json')), true);
  const tool = join(destination, 'node_modules/enois-preview');
  assert.equal((await lstat(tool)).isSymbolicLink(), false);
  assert.equal(await exists(join(tool, 'dist/src/worker.js')), true);
  assert.equal(await exists(join(tool, 'test')), false);
  const worker = JSON.parse(await readFile(join(destination, 'wrangler.jsonc'), 'utf8'));
  assert.equal(worker.vars.LAUNCH_ENABLED, 'false');
  assert.deepEqual(worker.observability, { enabled: false });
  assert.equal(await readFile(join(destination, '.nvmrc'), 'utf8'), '24\n');
  assert.deepEqual(JSON.parse(await readFile(join(destination, 'catalog/scenarios.json'), 'utf8')), {
    format: 'enois-preview-ts-v1',
    scenarios: {},
  });
  await writeRecord(join(evidence, 'consumer-build-validation.json'), {
    installationScriptsIgnored: true,
    toolBuildInLauncher: false,
    compiledWorkerFromPackage: true,
    workerDryRunPassed: true,
    remoteWrites: false,
  });
});

test('the actual reviewed distribution exports the complete TypeScript source tree and no historical automation or private execution files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'enois-real-public-export-'));
  try {
    const destination = join(directory, 'public');

    const report = await exportPublic(destination);

    assert.equal(report.published, false);
    assert.equal(existsSync(join(destination, '.git')), false);
    for (const file of [
      '.nvmrc',
      'preview/cli.ts',
      'src/entry.ts',
      'shared/accounts.ts',
      'runtime/start.ts',
      'runtime/gateway.ts',
      'recipe/prepare.ts',
      'example/prepare.ts',
      'scripts/add-scenario.ts',
      'scripts/pin-scenario.ts',
      'test/capture-journey.test.ts',
      'test/fixtures/timeout-tree.ts',
      'test/integration/worker-upload.test.ts',
      'tsconfig.json',
      'tsconfig.cloudflare.json',
      'runtime/DemoCredentials.java',
      'recipe/Dockerfile',
    ])
      assert.equal(existsSync(join(destination, file)), true, file);
    for (const file of [
      'EXECPLAN.md',
      '.agent',
      'runtime/start.sh',
      'scripts/snapshot.py',
      'preview/cli.py',
      'src/worker.mjs',
      'release/resume-compatible-tools.json',
    ])
      assert.equal(existsSync(join(destination, file)), false, file);
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'catalog/scenarios.json'), 'utf8')), {
      format: 'enois-preview-ts-v1',
      scenarios: {},
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

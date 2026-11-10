import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

type Outcome = { code: number | null; stdout: string; stderr: string };
function run(root: string, script: string, ...args: string[]): Outcome {
  const result = spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('service and script entry points behave the same through the installer current symlink as through their real path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-entry-points-'));
  try {
    const real = resolve('.'); const current = join(directory, 'current'); symlinkSync(real, current);
    const database = join(directory, 'fixture.mv.db'); const config = join(directory, 'service.json');
    writeFileSync(config, JSON.stringify({ format: 'enois-preview-ts-v1', database, jar: config, cwd: directory, port: 18089, pidfile: join(directory, 'absent.pid'), log: join(directory, 'service.log') }));

    for (const root of [current, real]) {
      assert.deepEqual(run(root, 'dist/preview/service.js', config, 'identity'), { code: 0, stdout: `${database}\n`, stderr: '' }, root);
      assert.deepEqual(run(root, 'dist/preview/service.js', config, 'status'), { code: 0, stdout: 'stopped\n', stderr: '' }, root);
      assert.deepEqual(run(root, 'dist/scripts/pin-scenario.js'), { code: 1, stdout: '', stderr: 'Usage: node dist/scripts/pin-scenario.js SLUG LAUNCHER_COMMIT_SHA\n' }, root);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

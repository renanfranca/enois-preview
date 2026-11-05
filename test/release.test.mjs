import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('release refuses a disabled configuration before any deployment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-disabled-'));
  try {
    fs.writeFileSync(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ vars: { LAUNCH_ENABLED: 'false' } }));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Launch is disabled/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release after initial installation does not require a recurring billing evidence file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-installed-'));
  try {
    fs.mkdirSync(path.join(directory, 'catalog'));
    fs.writeFileSync(path.join(directory, 'wrangler.jsonc'), JSON.stringify({ vars: { LAUNCH_ENABLED: 'true', GITHUB_REPOSITORY: 'fixture/launcher' } }));
    fs.writeFileSync(path.join(directory, 'catalog/scenarios.json'), JSON.stringify({ music: {
      repository: 'fixture/launcher', launcherCommit: 'a'.repeat(40), image: `ghcr.io/fixture/image@sha256:${'b'.repeat(64)}`,
      devcontainerPath: '.devcontainer/music/devcontainer.json', provenanceSha256: 'c'.repeat(64),
    } }));
    const env = { ...process.env }; delete env.DEMO_BILLING_EVIDENCE;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /only during initial setup/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../scripts/add-scenario.mjs', import.meta.url));
const image = `ghcr.io/owner/demo@sha256:${'b'.repeat(64)}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(20);
  }
  assert.fail('Startup fixture did not finish');
}

test('generated startup supplies scenario and forwarding environment and survives hook exit and SIGHUP', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-startup-'));
  let pid;
  try {
    fs.mkdirSync(path.join(directory, 'catalog/provenance'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'catalog/provenance/snapshot.json'), '{}');
    const generated = spawnSync(process.execPath, [generator, 'music', image, 'https://demo.example'], { cwd: directory, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const dev = JSON.parse(fs.readFileSync(path.join(directory, '.devcontainer/music/devcontainer.json')));
    assert.equal(dev.image, image);
    const script = path.join(directory, 'service.sh');
    const log = path.join(directory, 'service.log');
    const pidFile = path.join(directory, 'service.pid');
    fs.writeFileSync(script, '#!/usr/bin/env bash\nset -eu\nprintf "%s\\n" "$$" > "$DEMO_TEST_PID"\nprintf "%s\\n" "$DEMO_SLUG|$DEMO_PUBLIC_ORIGIN|$CODESPACE_PORT_FORWARDING_DOMAIN"\nsleep 0.5\nprintf "service survived\\n"\n', { mode: 0o755 });
    // Substitute only the image filesystem paths with a fixture service. Execute
    // the generated lifecycle command, including the real nohup and bash.
    const [command, ...args] = dev.postStartCommand.map(arg => arg.replace('/opt/render-demo/start.sh', script).replace('/tmp/enois-demo.log', log));
    const started = spawnSync(command, args, {
      cwd: directory, encoding: 'utf8', timeout: 3000,
      env: { ...process.env, DEMO_TEST_PID: pidFile, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev', CODESPACE_PORT_FORWARDING_DOMAIN: '' },
    });
    assert.equal(started.status, 0, started.stderr);
    await until(() => fs.existsSync(pidFile));
    pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    process.kill(pid, 'SIGHUP');
    await until(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('service survived'));
    assert.match(fs.readFileSync(log, 'utf8'), /music\|https:\/\/demo\.example\|app\.github\.dev/);
  } finally {
    if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('missing Worker URL reports usage before creating a scenario', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-arguments-'));
  try {
    const result = spawnSync(process.execPath, [generator, 'music', image], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.equal(fs.existsSync(path.join(directory, '.devcontainer')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

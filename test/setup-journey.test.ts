import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { InfrastructureState } from './fixtures/infrastructure.js';
import { workspace } from './fixtures/workspace.js';

const LAUNCHER = 'fixture/enois-preview-launcher';
const TOKEN = 'github_pat_fixture_valid_token';
const WRITES = /gh repo create|gh secret set|gh api -i -X PUT|wrangler secret put|wrangler deploy($| )|git .* push|docker login/;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
function operator(adjust: (state: InfrastructureState) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'enois-setup-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fake = resolve('dist/test/fixtures/infrastructure.js');
  chmodSync(fake, 0o755);
  for (const name of ['gh', 'docker', 'npx', 'npm', 'git']) symlinkSync(fake, join(bin, name));
  mkdirSync(join(root, 'docker'));
  writeFileSync(join(root, 'docker/config.json'), JSON.stringify({ auths: { 'ghcr.io': {} } }));
  const state: InfrastructureState = {
    login: 'fixture',
    ghLoggedIn: true,
    scopes: ['gist', 'read:org', 'repo', 'codespace', 'write:packages'],
    wranglerLoggedIn: true,
    accounts: [{ id: 'b'.repeat(32), name: 'Fixture account' }],
    subdomain: 'fixture-sub',
    repositories: {},
    workers: {},
    workerSecrets: {},
    codespacesSecrets: {},
    validTokens: [TOKEN],
    published: ['0.0.0-SNAPSHOT'],
    failOnce: [],
  };
  adjust(state);
  const stateFile = join(root, 'state.json');
  writeFileSync(stateFile, JSON.stringify(state));
  const log = join(root, 'commands.log');
  const infrastructure = join(root, 'operator/infrastructure.json');
  const home = join(root, 'home');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    FIXTURE_INFRA_STATE: stateFile,
    FIXTURE_PREFLIGHT_LOG: log,
    ENOIS_PREVIEW_INFRASTRUCTURE: infrastructure,
    ENOIS_PREVIEW_HOME: home,
    DOCKER_CONFIG: join(root, 'docker'),
    PLAYWRIGHT_BROWSERS_PATH: join(root, 'browsers'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${join(root, 'remote')}/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  };
  delete env.NODE_TEST_CONTEXT;
  const cli = resolve('dist/preview/cli.js');
  return {
    root,
    home,
    infrastructure,
    pending: join(root, 'operator/pending-callback-secret'),
    env,
    state: (): InfrastructureState => JSON.parse(readFileSync(stateFile, 'utf8')),
    change: (update: (current: InfrastructureState) => void) => {
      const current = JSON.parse(readFileSync(stateFile, 'utf8'));
      update(current);
      writeFileSync(stateFile, JSON.stringify(current));
    },
    commands: (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []),
    clearLog: () => rmSync(log, { force: true }),
    remote: (...args: string[]) => {
      const result = spawnSync('git', ['-C', join(root, 'remote', `${LAUNCHER}.git`), ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    },
    /** Without a terminal: stdin is not a TTY. */
    setup: (...args: string[]): Run => {
      const result = spawnSync(process.execPath, [cli, 'setup', ...args], { encoding: 'utf8', env, timeout: 60_000, input: '' });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    /** In a pseudo terminal; each answer is typed only after its prompt appears. */
    interactive: (answers: [RegExp, string][], ...args: string[]): Promise<Run> => {
      const command = 'exec ' + [process.execPath, cli, 'setup', ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
      const child = spawn('script', ['--return', '--quiet', '--command', command, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let consumed = 0;
      const pendingAnswers = [...answers];
      const receive = (data: Buffer) => {
        output += String(data);
        const next = pendingAnswers[0];
        if (next && next[0].test(output.slice(consumed))) {
          consumed = output.length;
          pendingAnswers.shift();
          child.stdin.write(next[1] + '\r');
        }
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      return new Promise((done, reject) => {
        child.on('error', reject);
        child.on('close', code => {
          clearTimeout(timer);
          const text = output.replaceAll('\r\n', '\n');
          done({ code, stdout: text, stderr: text });
        });
      });
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
type Operator = ReturnType<typeof operator>;
function report(run: Run): Record<string, unknown> & { created: string[]; updated: string[]; warnings: { code: string }[] } {
  const start = run.stdout.lastIndexOf('\n{\n') >= 0 ? run.stdout.lastIndexOf('\n{\n') + 1 : run.stdout.indexOf('{');
  return JSON.parse(run.stdout.slice(start));
}
function plan(run: Run): string[] {
  return run.stderr
    .split('\n')
    .filter(line => /^ {2}(exists|create|update) /.test(line))
    .map(line => line.trim());
}
async function configured(op: Operator): Promise<Run> {
  const result = await op.interactive([
    [/Apply this plan\? \[y\/N\]/, 'y'],
    [/GITHUB_TOKEN \(input hidden\): /, TOKEN],
  ]);
  assert.equal(result.code, 0, result.stdout);
  return result;
}
function secretValues(op: Operator): string[] {
  const state = op.state();
  return [
    ...Object.values(state.workerSecrets).flatMap(secrets => Object.values(secrets)),
    ...Object.entries(state.codespacesSecrets)
      .filter(([name]) => name !== 'DEMO_WORKER_URL')
      .map(([, secret]) => secret.value),
    TOKEN,
  ].filter(value => value.length >= 16);
}

test('a complete setup from nothing, confirmed interactively, creates the launcher, Worker, secrets and activation in order without storing secret values', async () => {
  const op = operator();
  try {
    const result = await configured(op);

    const output = report(result);
    assert.equal(output.status, 'configured');
    assert.equal(output.repository, LAUNCHER);
    assert.equal(output.branch, 'main');
    assert.equal(output.registry, 'ghcr.io/fixture/enois-preview');
    assert.equal(output.worker, 'enois-preview-launcher');
    assert.equal(output.origin, 'https://enois-preview-launcher.fixture-sub.workers.dev');
    assert.equal(output.cloudflareAccountId, 'b'.repeat(32));
    assert.deepEqual(output.updated, []);
    assert.ok(
      output.created.includes(`repository ${LAUNCHER}`) && output.created.includes('secret GITHUB_TOKEN (Worker)'),
      output.created.join(),
    );
    assert.deepEqual(
      output.warnings.map(warning => warning.code),
      ['free-plan'],
    );
    const writes = op
      .commands()
      .filter(line => WRITES.test(line))
      .map(line => line.replace(/^git -C \S+ push.*$/, 'git push').replace(/ --(?!no-install).*$/, ''));
    assert.deepEqual(writes, [
      `gh repo create ${LAUNCHER}`,
      'git push',
      'npx --no-install wrangler deploy',
      'npx --no-install wrangler secret put GITHUB_TOKEN',
      'npx --no-install wrangler secret put CALLBACK_SECRET',
      'gh secret set DEMO_CALLBACK_SECRET',
      'gh secret set DEMO_WORKER_URL',
      'gh secret set REDE_SECURITY_ENCRYPTION_KEY',
      'git push',
      'npx --no-install wrangler deploy',
    ]);
    const state = op.state();
    assert.deepEqual(state.workers['enois-preview-launcher']?.deploys, [
      { launchEnabled: 'false', account: 'b'.repeat(32) },
      { launchEnabled: 'true', account: 'b'.repeat(32) },
    ]);
    const workerSecrets = state.workerSecrets['enois-preview-launcher'] ?? {};
    assert.equal(workerSecrets.GITHUB_TOKEN, TOKEN);
    assert.equal(workerSecrets.CALLBACK_SECRET, state.codespacesSecrets.DEMO_CALLBACK_SECRET?.value);
    assert.equal(state.codespacesSecrets.DEMO_WORKER_URL?.value, 'https://enois-preview-launcher.fixture-sub.workers.dev');
    assert.equal(Buffer.from(state.codespacesSecrets.REDE_SECURITY_ENCRYPTION_KEY?.value ?? '', 'base64').length, 32);
    const launcherId = state.repositories[LAUNCHER]?.id;
    for (const secret of Object.values(state.codespacesSecrets)) assert.deepEqual(secret.repositories, [launcherId]);
    assert.equal(state.repositories[LAUNCHER]?.private, true);
    const launcher = JSON.parse(op.remote('show', 'main:package.json'));
    assert.equal(launcher.devDependencies['enois-preview'], '0.0.0-SNAPSHOT');
    assert.equal(JSON.parse(op.remote('show', 'main:wrangler.jsonc')).vars.LAUNCH_ENABLED, 'true');
    assert.doesNotMatch(op.remote('ls-tree', '--name-only', 'main'), /tool\.lock\.json/);
    assert.deepEqual(op.remote('log', '--format=%an %s', 'main').trim().split('\n'), [
      'enois-preview feat: enable enois-preview launches',
      'enois-preview feat: create enois-preview launcher',
    ]);
    assert.equal(statSync(op.infrastructure).mode & 0o777, 0o600);
    const stored = readFileSync(op.infrastructure, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), [
      'branch',
      'cloudflareAccountId',
      'format',
      'origin',
      'registry',
      'repository',
      'worker',
    ]);
    assert.equal(existsSync(op.pending), false);
    const everything = stored + result.stdout + op.commands().join('\n');
    for (const secret of secretValues(op)) assert.equal(everything.includes(secret), false, 'a secret value leaked');
  } finally {
    op.cleanup();
  }
});

test('a second setup on a complete infrastructure performs no remote write and reports every resource as exists', async () => {
  const op = operator();
  try {
    await configured(op);
    op.clearLog();
    const before = op.state();

    const result = op.setup();

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
    assert.deepEqual(op.state(), before);
    const lines = plan(result);
    assert.ok(lines.length >= 12, result.stderr);
    assert.deepEqual(
      lines.filter(line => !line.startsWith('exists ')),
      [],
    );
    assert.deepEqual(report(result).created, []);
    assert.deepEqual(report(result).updated, []);
  } finally {
    op.cleanup();
  }
});

test('without a terminal and without --yes, setup prints the plan, exits 1 and writes nothing locally or remotely', () => {
  const op = operator();
  try {
    const before = op.state();

    const result = op.setup();

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.ok(plan(result).includes(`create repository ${LAUNCHER}`), result.stderr);
    assert.match(
      result.stderr,
      /Setup incomplete: Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes\.\n$/,
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
    assert.deepEqual(op.state(), before);
    assert.equal(existsSync(op.infrastructure), false);
    assert.equal(existsSync(op.pending), false);
    assert.equal(existsSync(op.home), false);
  } finally {
    op.cleanup();
  }
});

test('with --yes and no terminal, setup stops before any write when GITHUB_TOKEN is missing and names it', () => {
  const op = operator();
  try {
    const before = op.state();

    const result = op.setup('--yes');

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Setup incomplete: Setup needs the Worker secret GITHUB_TOKEN, which is read from a hidden prompt; rerun in an interactive terminal\./,
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
    assert.deepEqual(op.state(), before);
    assert.equal(existsSync(op.infrastructure), false);
  } finally {
    op.cleanup();
  }
});

test('existing secrets are never rewritten and an existing Codespaces secret missing the launcher is updated without a value write', async () => {
  const op = operator();
  try {
    await configured(op);
    const launcherId = op.state().repositories[LAUNCHER]?.id;
    op.change(state => {
      for (const name of ['DEMO_CALLBACK_SECRET', 'DEMO_WORKER_URL']) {
        const secret = state.codespacesSecrets[name];
        if (secret) secret.repositories = [7];
      }
    });
    const before = op.state();
    op.clearLog();

    const result = op.setup('--yes');

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(report(result).updated, ['secret DEMO_CALLBACK_SECRET (Codespaces)', 'secret DEMO_WORKER_URL (Codespaces)']);
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [
        `gh api -i -X PUT user/codespaces/secrets/DEMO_CALLBACK_SECRET/repositories/${launcherId}`,
        `gh api -i -X PUT user/codespaces/secrets/DEMO_WORKER_URL/repositories/${launcherId}`,
      ],
    );
    const after = op.state();
    for (const name of ['DEMO_CALLBACK_SECRET', 'DEMO_WORKER_URL']) {
      assert.equal(after.codespacesSecrets[name]?.value, before.codespacesSecrets[name]?.value);
      assert.deepEqual(after.codespacesSecrets[name]?.repositories, [7, launcherId]);
    }
    assert.deepEqual(after.workerSecrets, before.workerSecrets);
  } finally {
    op.cleanup();
  }
});

test('an interruption after the Worker callback secret completes the Codespaces side from the pending file on the next run', async () => {
  const op = operator(state => {
    state.failOnce = ['gh secret set DEMO_CALLBACK_SECRET'];
  });
  try {
    const interrupted = await op.interactive([
      [/Apply this plan\? \[y\/N\]/, 'y'],
      [/GITHUB_TOKEN \(input hidden\): /, TOKEN],
    ]);
    assert.equal(interrupted.code, 1, interrupted.stdout);
    assert.equal(existsSync(op.pending), true);
    assert.equal(statSync(op.pending).mode & 0o777, 0o600);
    const workerSide = op.state().workerSecrets['enois-preview-launcher']?.CALLBACK_SECRET;
    op.clearLog();

    const completed = op.setup('--yes');

    assert.equal(completed.code, 0, completed.stderr);
    const state = op.state();
    assert.equal(state.codespacesSecrets.DEMO_CALLBACK_SECRET?.value, workerSide);
    assert.equal(state.workerSecrets['enois-preview-launcher']?.CALLBACK_SECRET, workerSide);
    assert.equal(existsSync(op.pending), false);
    assert.equal(
      op.commands().some(line => line.includes('wrangler secret put CALLBACK_SECRET')),
      false,
    );
  } finally {
    op.cleanup();
  }
});

test('one callback side without a pending file stops with guidance naming the secret to delete', async () => {
  const op = operator();
  try {
    await configured(op);
    op.change(state => {
      delete state.codespacesSecrets.DEMO_CALLBACK_SECRET;
    });
    const before = op.state();
    op.clearLog();

    const result = op.setup('--yes');

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /the two sides can no longer be matched\. Delete the Worker secret CALLBACK_SECRET \(npx wrangler secret delete CALLBACK_SECRET --name enois-preview-launcher\), then repeat enois-preview setup\./,
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
    assert.deepEqual(op.state(), before);
  } finally {
    op.cleanup();
  }
});

test('a token that fails the Codespaces verification is not stored', async () => {
  const op = operator();
  try {
    const result = await op.interactive([
      [/Apply this plan\? \[y\/N\]/, 'y'],
      [/GITHUB_TOKEN \(input hidden\): /, 'github_pat_fixture_rejected_one'],
      [/GITHUB_TOKEN \(input hidden\): /, 'github_pat_fixture_rejected_two'],
      [/GITHUB_TOKEN \(input hidden\): /, 'github_pat_fixture_rejected_three'],
    ]);

    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /GITHUB_TOKEN could not be verified by listing the launcher Codespaces and was not stored/);
    assert.equal(op.state().workerSecrets['enois-preview-launcher']?.GITHUB_TOKEN, undefined);
    assert.equal(
      op.commands().some(line => line.includes('secret put GITHUB_TOKEN')),
      false,
    );
    assert.doesNotMatch(result.stdout + op.commands().join('\n'), /github_pat_fixture_rejected/);
  } finally {
    op.cleanup();
  }
});

test('setup on a launcher in another format stops without writing', () => {
  const op = operator();
  try {
    const seed = join(op.root, 'seed');
    mkdirSync(seed);
    writeFileSync(join(seed, 'tool.lock.json'), JSON.stringify({ commit: 'd'.repeat(40) }));
    writeFileSync(
      join(seed, 'package.json'),
      JSON.stringify({
        devDependencies: { 'enois-preview': `https://codeload.github.com/renanfranca/enois-preview/tar.gz/${'d'.repeat(40)}` },
      }),
    );
    writeFileSync(
      join(seed, 'wrangler.jsonc'),
      JSON.stringify({
        name: 'enois-preview-launcher',
        main: 'launcher.ts',
        vars: { GITHUB_REPOSITORY: LAUNCHER, GITHUB_OWNER: 'fixture' },
      }),
    );
    const bare = join(op.root, 'remote', `${LAUNCHER}.git`);
    mkdirSync(bare, { recursive: true });
    for (const args of [
      ['init', '--bare', '-q', bare],
      ['-C', seed, 'init', '-q', '-b', 'main'],
      ['-C', seed, 'add', '.'],
      ['-C', seed, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'legacy launcher'],
      ['-C', seed, 'push', '-q', bare, 'HEAD:refs/heads/main'],
    ])
      assert.equal(spawnSync('git', args).status, 0);
    op.change(state => {
      state.repositories[LAUNCHER] = { id: 4242, private: true, push: true };
    });
    const before = op.state();

    const result = op.setup('--yes');

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Launcher fixture\/enois-preview-launcher uses another format .*choose a new --launcher\./);
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
    assert.deepEqual(op.state(), before);
    assert.equal(existsSync(op.infrastructure), false);
  } finally {
    op.cleanup();
  }
});

test('several Cloudflare accounts without --account stop setup and list the accounts', () => {
  const op = operator(state => {
    state.accounts = [
      { id: 'b'.repeat(32), name: 'First account' },
      { id: 'c'.repeat(32), name: 'Second account' },
    ];
  });
  try {
    const result = op.setup('--yes');

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `Several Cloudflare accounts are available; choose one with --account: First account \\(${'b'.repeat(32)}\\), Second account \\(${'c'.repeat(32)}\\)\\.`,
      ),
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
  } finally {
    op.cleanup();
  }
});

test('a flag contradicting infrastructure.json stops setup and names both values', async () => {
  const op = operator();
  try {
    await configured(op);
    op.clearLog();

    const result = op.setup('--yes', '--launcher', 'fixture/other-launcher');

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /--launcher fixture\/other-launcher contradicts fixture\/enois-preview-launcher in infrastructure\.json; changing infrastructure is out of scope\./,
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
  } finally {
    op.cleanup();
  }
});

test('setup with --config validates the workspace and stores it beside the infrastructure', async () => {
  const op = operator();
  try {
    await configured(op);
    const config = workspace(op.root);
    writeFileSync(config.database, 'fictional');
    writeFileSync(config.h2Jar, 'fixture');
    const input = join(op.root, 'workspace.json');
    writeFileSync(input, JSON.stringify({ ...config, repository: 'fixture/ignored' }));
    op.clearLog();

    const result = op.setup('--yes', '--config', input);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(report(result).created, [`local ${join(op.home, 'config.json')}`]);
    assert.deepEqual(
      report(result).warnings.map(warning => warning.code),
      ['ignored-config-fields', 'free-plan'],
    );
    assert.deepEqual(JSON.parse(readFileSync(join(op.home, 'config.json'), 'utf8')), { ...config, repository: 'fixture/ignored' });
    assert.ok(op.commands().includes('docker info'));
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
  } finally {
    op.cleanup();
  }
});

/** A PATH whose `docker` runs the timeout tree fixture in ROOT, so the workspace preflight has live descendants to interrupt. */
function slowDocker(op: Operator, root: string): string {
  const bin = join(root, 'slow-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh\nexec '${process.execPath}' '${resolve('dist/test/fixtures/timeout-tree.js')}' '${root}' identity\n`,
    {
      mode: 0o755,
    },
  );
  return `${bin}:${op.env.PATH ?? ''}`;
}
function workspaceInput(op: Operator): string {
  const base = workspace(op.root);
  writeFileSync(base.database, 'fictional');
  writeFileSync(base.h2Jar, 'fixture');
  const input = join(op.root, 'input.json');
  writeFileSync(input, JSON.stringify(base));
  return input;
}

test('setup interruption terminates active descendants and prevents later local writes', async () => {
  for (const signal of [undefined, 'SIGINT', 'SIGTERM'] as const) {
    const op = operator();
    const root = join(op.root, 'tree');
    mkdirSync(root);
    try {
      await configured(op);
      const input = workspaceInput(op);
      const args = [process.execPath, resolve('dist/preview/cli.js'), 'setup', '--yes', '--config', input];
      const command = 'exec ' + args.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
      const child = spawn('script', ['--return', '--quiet', '--command', command, '/dev/null'], {
        env: { ...op.env, PATH: slowDocker(op, root) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const receive = (data: Buffer) => {
        output += String(data);
      };
      child.stdout.on('data', receive);
      child.stderr.on('data', receive);
      const completed = new Promise<number | null>((done, reject) => {
        child.on('error', reject);
        child.on('close', done);
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
      try {
        const deadline = Date.now() + 10_000;
        while (!existsSync(join(root, 'observed.json')) && Date.now() < deadline) await delay(10);
        assert.ok(existsSync(join(root, 'observed.json')), output);
        const observed = JSON.parse(readFileSync(join(root, 'observed.json'), 'utf8'));
        assert.equal(observed.bothAlive, true);
        process.kill(observed.child, 0);
        process.kill(observed.grandchild, 0);
        if (signal === 'SIGINT') child.stdin.write('\x03');
        else if (signal) process.kill(observed.cli, signal);

        const code = await completed;
        await delay(2800);

        assert.equal(code, signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 0, output);
        if (signal)
          for (const pid of [observed.parent, observed.child, observed.grandchild]) {
            const stat = `/proc/${pid}/stat`;
            if (existsSync(stat))
              assert.match(readFileSync(stat, 'utf8'), /^\d+ \(.*\) [ZX] /s, 'owned command and descendants must have terminated');
          }
        assert.equal(existsSync(join(root, 'child.effect')), !signal, 'child delayed effect');
        assert.equal(existsSync(join(root, 'grandchild.effect')), !signal, 'grandchild delayed effect');
        assert.equal(existsSync(join(op.home, 'config.json')), !signal, 'the workspace must not be written after interruption');
        if (signal) {
          assert.match(output, /interrupt/i);
          assert.doesNotMatch(output, /"configured"/);
        }
        const independent = JSON.parse(readFileSync(join(root, 'independent.json'), 'utf8'));
        assert.equal(await (await fetch(`http://127.0.0.1:${independent.port}`)).text(), 'independent ready');
      } finally {
        clearTimeout(timer);
        child.kill('SIGKILL');
      }
    } finally {
      if (existsSync(join(root, 'observed.json'))) {
        try {
          process.kill(-JSON.parse(readFileSync(join(root, 'observed.json'), 'utf8')).parent, 'SIGKILL');
        } catch {}
      }
      if (existsSync(join(root, 'independent.json'))) {
        try {
          process.kill(JSON.parse(readFileSync(join(root, 'independent.json'), 'utf8')).pid, 'SIGKILL');
        } catch {}
      }
      op.cleanup();
    }
  }
});

test('a cancelled main invocation preserves unrelated signal handlers and does not cancel the next setup in the same process', async () => {
  const op = operator();
  const previous = { ...process.env };
  const outsider = () => {};
  process.on('SIGTERM', outsider);
  const handlers = process.listenerCount('SIGTERM');
  const interrupts = process.listenerCount('SIGINT');
  try {
    await configured(op);
    const input = workspaceInput(op);
    Object.assign(process.env, op.env, { PATH: slowDocker(op, op.root) });
    const { main } = await import('../preview/cli.js');
    const cancelled = main(['setup', '--yes', '--config', input]);
    const deadline = Date.now() + 5000;
    while (!existsSync(join(op.root, 'observed.json')) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(join(op.root, 'observed.json')));
    process.emit('SIGTERM');
    assert.equal(await cancelled, 143);
    assert.equal(process.listenerCount('SIGTERM'), handlers);
    assert.equal(process.listenerCount('SIGINT'), interrupts);
    assert.ok(process.listeners('SIGTERM').includes(outsider));
    process.env.PATH = op.env.PATH;

    assert.equal(await main(['setup', '--yes', '--config', input]), 0);

    assert.equal(process.listenerCount('SIGTERM'), handlers);
    assert.equal(process.listenerCount('SIGINT'), interrupts);
    assert.ok(process.listeners('SIGTERM').includes(outsider));
    assert.equal(existsSync(join(op.home, 'config.json')), true);
  } finally {
    process.removeListener('SIGTERM', outsider);
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    if (existsSync(join(op.root, 'independent.json'))) {
      try {
        process.kill(JSON.parse(readFileSync(join(op.root, 'independent.json'), 'utf8')).pid, 'SIGKILL');
      } catch {}
    }
    op.cleanup();
  }
});

test('without a terminal, a missing login stops setup with the command to run, even with --yes', () => {
  const op = operator(state => {
    state.ghLoggedIn = false;
  });
  try {
    const result = op.setup('--yes');

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Setup incomplete: GitHub CLI is not logged in\. Run gh auth login -h github\.com -s repo,codespace,write:packages, then repeat enois-preview setup\./,
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line) || line.startsWith('gh auth login')),
      [],
    );
  } finally {
    op.cleanup();
  }
});

test('an --account that wrangler does not list stops setup and lists the available accounts', () => {
  const op = operator();
  try {
    const result = op.setup('--yes', '--account', 'c'.repeat(32));

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `Cloudflare account ${'c'.repeat(32)} is not available to the logged in Wrangler user; accounts: Fixture account \\(${'b'.repeat(32)}\\)\\.`,
      ),
    );
    assert.deepEqual(
      op.commands().filter(line => WRITES.test(line)),
      [],
    );
  } finally {
    op.cleanup();
  }
});

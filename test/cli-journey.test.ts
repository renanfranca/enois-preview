import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fixture as h2Fixture } from './fixtures/h2.js';
import { workspace } from './fixtures/workspace.js';

test('the compiled CLI explains setup, frozen publication and resume through Node without Python', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-cli-'));
  try {
    assert.deepEqual(JSON.parse(readFileSync('package.json', 'utf8')).engines, { node: '>=24 <25' });
    mkdirSync(join(directory, 'bin'));
    symlinkSync(process.execPath, join(directory, 'bin/node'));

    const result = spawnSync(resolve('dist/preview/cli.js'), ['--help'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: join(directory, 'bin') },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /enois-preview/);
    assert.match(result.stdout, /setup/);
    assert.match(result.stdout, /publish/);
    assert.match(result.stdout, /--refresh-data/);
    assert.match(result.stdout, /--accounts ID\[,ID\.\.\.\]/);
    assert.match(result.stdout, /--force-lease/);
    assert.match(result.stdout, /warnings: \[\{code, message\}\]/);
    assert.match(result.stdout, /resume/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the declared CLI executable remains usable through a launcher symlink after an explicit build', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-rebuilt-bin-'));
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')),
      binary = resolve(pkg.bin['enois-preview']);
    const link = join(directory, 'enois-preview');
    symlinkSync(binary, link);
    mkdirSync(join(directory, 'bin'));
    symlinkSync(process.execPath, join(directory, 'bin/node'));

    const result = spawnSync(link, ['--help'], { encoding: 'utf8', env: { ...process.env, PATH: join(directory, 'bin') } });

    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /enois-preview/);
    assert.match(result.stdout, /setup/);
    assert.match(result.stdout, /resume/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('--version prints the running version of a development checkout and exits 0', () => {
  const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '0.0.0-SNAPSHOT\n');
  assert.equal(result.stderr, '');
});

test('legacy installation is refused before any mutation with fresh installation guidance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-legacy-'));
  try {
    const bytes = '{"schema":1,"secret":"private-sentinel"}\n';
    writeFileSync(join(directory, 'config.json'), bytes);

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', directory, 'setup'], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /enois-preview-ts-v1/);
    assert.match(result.stderr, /fresh installation/i);
    assert.doesNotMatch(result.stderr, /private-sentinel/);
    assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), bytes);
    assert.deepEqual(readdirSync(directory), ['config.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('setup refuses private state reached through an application directory alias before preflight or writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-state-location-'));
  try {
    const base = workspace(directory);
    const backend = base.repositories['enois-backend'];
    assert.ok(backend);
    const alias = join(directory, 'alias');
    symlinkSync(backend, alias, 'dir');
    const config = { ...base, state: join(alias, 'private-state') };
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify(config));
    const home = join(directory, 'home');
    mkdirSync(home);
    const file = join(home, 'config.json');
    const before = JSON.stringify(base);
    writeFileSync(file, before);

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'setup', '--config', input], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Private state must be outside application repositories/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(config.state), false);
    assert.deepEqual(readdirSync(home), ['config.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the removed install command is reported as unknown with help guidance and reads or writes nothing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-install-command-'));
  try {
    const help = spawnSync(process.execPath, ['dist/preview/cli.js', '--help'], { encoding: 'utf8' });

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', 'install', 'a'.repeat(40)], {
      encoding: 'utf8',
      env: { ...process.env, HOME: directory, ENOIS_PREVIEW_HOME: join(directory, 'absent') },
    });

    assert.equal(help.status, 0);
    assert.doesNotMatch(help.stdout, /install/i);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Unknown command install. Choose setup, publish, resume or source-digest. Run enois-preview --help.\n');
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publish, resume and source-digest without infrastructure.json stop before reading the workspace and create nothing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-no-infrastructure-'));
  try {
    const config = workspace(directory);
    const home = join(directory, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    const env = { ...process.env, ENOIS_PREVIEW_INFRASTRUCTURE: join(directory, 'absent/infrastructure.json') };
    for (const [args, failure] of [
      [['publish', 'fixture'], 'Publication incomplete'],
      [['resume', 'a'.repeat(64)], 'Publication incomplete'],
      [['source-digest'], 'Source digest incomplete'],
    ] as const) {
      const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, ...args], { encoding: 'utf8', env });

      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stderr, `${failure}: Infrastructure missing. Run enois-preview setup first.\n`);
      assert.equal(result.stdout, '');
      assert.deepEqual(readdirSync(home), ['config.json']);
      assert.equal(existsSync(config.state), false);
      assert.equal(existsSync(join(directory, 'absent')), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('publish and resume before setup name the missing configuration and create nothing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-before-setup-'));
  try {
    for (const args of [
      ['publish', 'fixture'],
      ['publish', 'fixture', '--refresh-data'],
      ['resume', 'a'.repeat(64)],
    ]) {
      const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', join(directory, 'home'), ...args], { encoding: 'utf8' });

      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stderr, 'Publication incomplete: Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.\n');
      assert.equal(result.stdout, '');
      assert.deepEqual(readdirSync(directory), []);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid command arguments are refused before service recovery or publication writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-arguments-'));
  try {
    const config = workspace(directory);
    const home = join(directory, 'home');
    mkdirSync(home);
    const file = join(home, 'config.json');
    const before = JSON.stringify(config);
    writeFileSync(file, before);
    for (const args of [
      ['setup', 'extra'],
      ['setup', '--refresh-data'],
      ['setup', '--accounts', 'author'],
      ['setup', '--force-lease'],
      ['resume', 'a'.repeat(64), '--accounts', 'author'],
      ['source-digest', '--force-lease'],
      ['publish'],
      ['publish', 'fixture', 'extra'],
      ['publish', 'fixture', '--config', file],
      ['resume'],
      ['resume', 'a'.repeat(64), 'extra'],
      ['resume', 'a'.repeat(64), '--refresh-data'],
    ]) {
      const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, ...args], { encoding: 'utf8' });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Invalid command arguments.*--help/, args.join(' '));
      assert.equal(readFileSync(file, 'utf8'), before);
      assert.equal(existsSync(config.state), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('historical scenario pointers and operation journals are refused by the CLI before creating locks or changing records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-historical-state-'));
  try {
    const config = workspace(directory);
    const home = join(directory, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    const revision = 'a'.repeat(64);
    mkdirSync(join(config.state, 'scenarios'), { recursive: true });
    mkdirSync(join(config.state, 'operations', revision), { recursive: true });
    const pointer = join(config.state, 'scenarios/fixture.json');
    const journal = join(config.state, 'operations', revision, 'journal.json');
    const original = '{"schema":3,"data":"historical-private-fixture"}\n';
    writeFileSync(pointer, original);
    writeFileSync(journal, original);
    const before = readdirSync(config.state, { recursive: true }).sort();
    for (const args of [
      ['publish', 'fixture'],
      ['resume', revision],
    ]) {
      const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, ...args], { encoding: 'utf8' });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
      assert.doesNotMatch(result.stderr, /historical-private-fixture/);
      assert.equal(readFileSync(pointer, 'utf8'), original);
      assert.equal(readFileSync(journal, 'utf8'), original);
      assert.deepEqual(readdirSync(config.state, { recursive: true }).sort(), before);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a command with nothing to observe reports an empty warnings array in its final JSON', () => {
  const f = h2Fixture();
  try {
    const config = f.config;
    const home = join(f.root, 'home');
    mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'source-digest'], {
      encoding: 'utf8',
      timeout: 120_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).warnings, []);
    assert.doesNotMatch(result.stderr, /^warning:/m);
  } finally {
    f.cleanup();
  }
});

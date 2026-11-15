import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/preview/cli.js',
  'dist/preview/version.js',
  'dist/src/worker.js',
  'dist/runtime/activity-bundle.js',
  'dist/runtime/reset-worker-bundle.js',
  'dist/scripts/validate-decoding.js',
  'dist/example/prepare.js',
  'recipe/SeedTool.java',
  'runtime/DemoCredentials.java',
  'src/worker.ts',
  'shared/records.ts',
  'example/media/cover.svg',
  'docs/pt-BR/TUTORIAL.md',
  'docs/en/TUTORIAL.md',
];
const ALLOWED = [
  /^dist\//,
  /^recipe\//,
  /^runtime\//,
  /^src\//,
  /^shared\//,
  /^example\//,
  /^docs\/pt-BR\//,
  /^docs\/en\//,
  /^(package\.json|README\.md|LICENSE)$/,
];
const EXCLUDED = [/^test\//, /^dist\/test\//, /^docs\/validation\//, /^VALIDATION\.md$/, /^\.agent\//, /^\.github\//];

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

test('the npm tarball installs globally, runs --version and --help, and contains exactly the run-time allowlist', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-package-'));
  try {
    const packed: unknown = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], { cwd: resolve('.') }));
    assert.ok(Array.isArray(packed) && packed[0] && typeof packed[0].filename === 'string');
    const files = (packed[0].files as { path: string }[]).map(file => file.path).sort();
    const prefix = join(directory, 'prefix');
    mkdirSync(prefix);
    run('npm', ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', '--prefer-offline', join(directory, packed[0].filename)]);
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'node'));
    const env = { ...process.env, PATH: `${join(prefix, 'bin')}:${bin}` };
    const installed = join(prefix, 'lib/node_modules/enois-preview');

    const version = spawnSync('enois-preview', ['--version'], { encoding: 'utf8', env });
    const help = spawnSync('enois-preview', ['--help'], { encoding: 'utf8', env });

    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout, `${JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version}\n`);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /setup/);
    assert.match(help.stdout, /publish SCENARIO/);
    assert.deepEqual(
      REQUIRED.filter(path => !files.includes(path)),
      [],
      'run-time files missing from the package',
    );
    assert.deepEqual(
      files.filter(path => EXCLUDED.some(pattern => pattern.test(path))),
      [],
      'excluded paths present in the package',
    );
    assert.deepEqual(
      files.filter(path => !ALLOWED.some(pattern => pattern.test(path))),
      [],
      'paths outside the allowlist present in the package',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

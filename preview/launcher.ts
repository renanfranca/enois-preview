import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './project.js';
import { canonical, exists, object, PreviewError, privateDir, run, writeRecord } from './state.js';

/** The exact wrangler version the running tool depends on; generated and repinned launchers deploy with it. */
export const WRANGLER_VERSION: string = String(
  object(object(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))).dependencies).wrangler,
);
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LOCK = ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];

export function notPublished(version: string): string {
  return `enois-preview ${version} is not published on npm; run setup from an installed release.`;
}
export interface LauncherOptions {
  repository: string;
  worker: string;
  version: string;
}
function manifest(version: string): Record<string, unknown> {
  return {
    name: 'enois-private-preview-launcher',
    private: true,
    type: 'module',
    engines: { node: '>=24 <25' },
    scripts: { check: 'wrangler deploy --dry-run' },
    devDependencies: { 'enois-preview': version, wrangler: WRANGLER_VERSION },
  };
}
/** Writes the launcher of section 5.5 into an empty directory and locks it with lifecycle scripts ignored. */
export async function generateLauncher(directory: string, options: LauncherOptions, command: typeof run = run): Promise<void> {
  const plain = (name: string, value: unknown) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await privateDir(directory);
  await plain('package.json', manifest(options.version));
  await writeFile(join(directory, '.nvmrc'), '24\n', { mode: 0o600 });
  await writeRecord(join(directory, 'catalog/scenarios.json'), { scenarios: {} });
  await writeFile(
    join(directory, 'launcher.ts'),
    "import catalog from './catalog/scenarios.json' with {type:'json'};\nimport { createWorker } from 'enois-preview/worker';\nexport { Scenario } from 'enois-preview/worker';\nexport default createWorker(catalog);\n",
    { mode: 0o600 },
  );
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.wrangler/\ndist/\n.dev.vars*\n.env*\n', { mode: 0o600 });
  await plain('tsconfig.json', {
    compilerOptions: {
      target: 'ES2023',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      resolveJsonModule: true,
      lib: ['ES2023', 'WebWorker', 'WebWorker.Iterable'],
      types: [],
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['launcher.ts'],
  });
  await plain('wrangler.jsonc', {
    name: options.worker,
    main: 'launcher.ts',
    compatibility_date: '2026-10-01',
    workers_dev: true,
    observability: { enabled: false },
    vars: { LAUNCH_ENABLED: 'false', GITHUB_REPOSITORY: options.repository, GITHUB_OWNER: options.repository.split('/')[0] },
    durable_objects: { bindings: [{ name: 'SCENARIOS', class_name: 'Scenario' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['Scenario'] }],
  });
  await command(LOCK, { cwd: directory, timeout: 600 });
}
/** The exact enois-preview version a launcher of the current format pins, or null for any other format (such as a 0.4.0 launcher). */
export async function launcherVersion(directory: string): Promise<string | null> {
  if (await exists(join(directory, 'tool.lock.json'))) return null;
  try {
    const worker = object(JSON.parse(await readFile(join(directory, 'wrangler.jsonc'), 'utf8')));
    const dependency = object(object(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))).devDependencies)['enois-preview'];
    if (worker.main !== 'launcher.ts' || typeof dependency !== 'string' || !EXACT.test(dependency)) return null;
    return dependency;
  } catch {
    return null;
  }
}
/** Only a version that exists on npm can be installed by a launcher. */
export async function requirePublished(version: string, command: typeof run = run): Promise<void> {
  let answer = '';
  try {
    answer = (await command(['npm', 'view', `enois-preview@${version}`, 'version'], { timeout: 120 })).toString().trim();
  } catch (error: unknown) {
    if (!(error instanceof PreviewError)) throw error;
  }
  if (answer !== version) throw new PreviewError(notPublished(version));
}
/** Moves a launcher to `version` (and the tool's wrangler) and relocks it; the caller commits the two files. */
export async function repinLauncher(directory: string, version: string, command: typeof run = run): Promise<void> {
  const file = join(directory, 'package.json');
  const current = object(JSON.parse(await readFile(file, 'utf8')));
  const next = {
    ...current,
    devDependencies: { ...object(current.devDependencies), 'enois-preview': version, wrangler: WRANGLER_VERSION },
  };
  if (canonical(next) !== canonical(current)) await writeFile(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await command(LOCK, { cwd: directory, timeout: 600 });
}

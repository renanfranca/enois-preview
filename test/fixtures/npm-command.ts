#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// An `npm` for tests: `view enois-preview@V version` answers from FIXTURE_NPM_PUBLISHED (comma separated versions);
// `install --package-lock-only` writes a minimal lockfile from package.json; `ci` succeeds. Every call goes to FIXTURE_NPM_LOG.
const args = process.argv.slice(2);
if (process.env.FIXTURE_NPM_LOG) appendFileSync(process.env.FIXTURE_NPM_LOG, `npm ${args.join(' ')}\n`);
const published = (process.env.FIXTURE_NPM_PUBLISHED ?? '').split(',').filter(Boolean);
if (args[0] === 'view') {
  const version = (args[1] ?? '').split('@').pop() ?? '';
  if (!published.includes(version)) {
    console.error('npm error code E404');
    process.exit(1);
  }
  console.log(version);
} else if (args[0] === 'install' && args.includes('--package-lock-only')) {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  writeFileSync(
    join(process.cwd(), 'package-lock.json'),
    JSON.stringify(
      { name: manifest.name, lockfileVersion: 3, requires: true, packages: { '': { devDependencies: manifest.devDependencies } } },
      null,
      2,
    ) + '\n',
  );
} else if (args[0] !== 'ci') {
  console.error(`Unexpected fixture npm command ${args.join(' ')}`);
  process.exit(2);
}

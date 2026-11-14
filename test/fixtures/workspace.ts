import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const repositories = ['enois-backend', 'enois-frontend', 'enois-design-system'] as const;
export function git(directory: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
export function workspace(root: string) {
  const paths = Object.fromEntries(repositories.map(name => {
    const directory = join(root, name); mkdirSync(directory);
    git(directory, 'init', '-q'); writeFileSync(join(directory, 'source'), name);
    git(directory, 'add', '.'); git(directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    return [name, directory];
  }));
  return { format: 'enois-preview-ts-v1', workspace: root, state: join(root, 'state'),
    repositories: paths, database: join(root, 'live.mv.db'), h2Jar: join(root, 'h2.jar'),
    repository: 'fixture/launcher', registry: 'ghcr.io/fixture/image', branch: 'preview', origin: 'https://preview.example.invalid', cloudflareAccountId: 'a'.repeat(32) };
}
/** The fields a 0.3.9 configuration carried and 0.4.0 ignores. */
export function legacyFields() {
  return { toolCommit: '1'.repeat(40),
    installation: { githubOwner: 'fixture', cloudflareAccountId: 'a'.repeat(32), freePlansAndSpendingBlocksConfirmed: true, checkedAt: '2000-01-01T00:00:00Z' },
    service: { ...Object.fromEntries(['identity','status','stop','start','released','ready'].map(action => [action, [process.execPath, '-e', 'process.exit(91)']])), expectedIdentity: 'fixture' } };
}

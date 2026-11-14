import { isAbsolute, resolve, relative, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { object, PreviewError, requireFormat, string } from './state.js';
import { warn } from './warnings.js';

import type { Account } from '../shared/accounts.js';
export type { Account } from '../shared/accounts.js';
export interface Media { root: string; url: string }
export interface CaptureConfig { format: 'enois-preview-ts-v1'; state: string; database: string; h2Jar: string; accounts: Account[]; media: Media[] }
import { accounts } from '../shared/accounts.js';
export { accounts } from '../shared/accounts.js';
function absolute(value: unknown): string {
  const path = string(value); if (!isAbsolute(path)) throw new PreviewError('Configuration paths must be absolute.'); return resolve(path);
}
function physicalPath(path: string): string {
  try { return realpathSync(path); }
  catch (error: unknown) {
    if (object(error).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(physicalPath(dirname(path)), basename(path));
  }
}
export function captureConfig(value: unknown): CaptureConfig {
  requireFormat(value);
  const mappings = value.media ?? [];
  if (!Array.isArray(mappings)) throw new PreviewError('Configure media mappings.');
  const media = mappings.map((entry: unknown) => {
    const item = object(entry); const root = absolute(item.root); const url = string(item.url);
    if (!/^\/[a-zA-Z0-9._/-]+\/$/.test(url) || url.split('/').includes('..') || url.includes('//')) throw new PreviewError('Media URLs require safe prefixes.');
    return { root, url };
  });
  if (media.some((a, i) => media.some((b, j) => i !== j && b.url.startsWith(a.url)))) throw new PreviewError('Media prefixes must not overlap.');
  return { format: value.format, state: absolute(value.state), database: absolute(value.database), h2Jar: absolute(value.h2Jar), accounts: value.accounts === undefined || (Array.isArray(value.accounts) && value.accounts.length===0) ? [] : accounts(value.accounts), media };
}
const KNOWN = new Set(['format','workspace','state','repositories','database','h2Jar','accounts','media','repository','registry','branch','origin','cloudflareAccountId','leaseWaitSeconds']);
/** Fields a 0.3.x configuration may still carry (`service`, `toolCommit`, `installation`) and any other unused field: ignored, never deleted. */
export function warnIgnoredFields(value: Record<string, unknown>): void {
  const ignored = Object.keys(value).filter(key => !KNOWN.has(key)).sort();
  if (ignored.length) warn('ignored-config-fields', `Configuration fields no longer used are ignored and preserved: ${ignored.join(', ')}.`);
}

import { access, stat, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { commandRunner } from './state.js';
import { ROOT, REPOSITORIES } from './project.js';

export interface Config extends CaptureConfig {
  [key: string]: unknown;
  workspace: string; repositories: Record<string, string>; repository: string; registry: string; branch: string;
  origin: string; cloudflareAccountId: string; leaseWaitSeconds: number;
}
export function validateConfig(value: unknown): Config {
  requireFormat(value);
  const sourcePaths = object(value.repositories); const repositories: Record<string, string> = {};
  const state = absolute(value.state);
  for (const name of REPOSITORIES) {
    const path = absolute(sourcePaths[name]); const inside = relative(physicalPath(path), physicalPath(state));
    if (inside === '' || (!inside.startsWith('../') && !isAbsolute(inside))) throw new PreviewError('Private state must be outside application repositories.');
    repositories[name] = path;
  }
  const repository = string(value.repository); const registry = string(value.registry); const branch = string(value.branch);
  const cloudflareAccountId = string(value.cloudflareAccountId);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new PreviewError('Configure an existing private launcher repository.');
  if (!/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+$/.test(registry)) throw new PreviewError('Configure an existing private GHCR destination.');
  if (!/^[a-zA-Z0-9._-]+$/.test(branch)) throw new PreviewError('Configure the launcher publication branch.');
  if (!/^[a-f0-9]{32}$/.test(cloudflareAccountId)) throw new PreviewError('Configure cloudflareAccountId.');
  const origin = new URL(string(value.origin));
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !origin.hostname) throw new PreviewError('Configure the public HTTPS Worker origin without credentials or a path.');
  const leaseWaitSeconds = value.leaseWaitSeconds ?? 900;
  if (typeof leaseWaitSeconds !== 'number' || !Number.isFinite(leaseWaitSeconds) || leaseWaitSeconds < 0 || leaseWaitSeconds > 3600) throw new PreviewError('leaseWaitSeconds must be between 0 and 3600.');
  return { ...value, ...captureConfig(value), workspace: absolute(value.workspace), repositories, repository, registry, branch, cloudflareAccountId, origin: origin.origin, leaseWaitSeconds };
}
export async function prerequisites(config: Config, signal?: AbortSignal): Promise<void> {
  const run = commandRunner(signal);
  signal?.throwIfAborted();
  for (const name of ['git','node','npm','java','javac','docker','gh','npx','flock']) {
    const paths = (process.env.PATH ?? '').split(':');
    const found = await Promise.all(paths.map(path => access(join(path, name), constants.X_OK).then(() => true, () => false)));
    if (!found.some(Boolean)) throw new PreviewError(`Install ${name}, then repeat enois-preview setup.`);
  }
  for (const directory of Object.values(config.repositories)) await run(['git', '-C', directory, 'rev-parse', '--git-dir']);
  if (!(await stat(config.h2Jar)).isFile()) throw new PreviewError('Configure the H2 driver jar matching the local database.');
  const database = await stat(config.database); if (!database.isFile()) throw new PreviewError('Configure an existing local H2 file.');
  await storageWarning(config, database.size);
  await run(['docker', 'info']);
  const repository = object(JSON.parse((await run(['gh','api',`repos/${config.repository}`])).toString()));
  if (object(repository.permissions).push !== true) throw new PreviewError('Launcher must be writable.');
  if (repository.private !== true) warn('launcher-not-private', `Launcher repository ${config.repository} is not private.`);
  const [owner, ...packageParts] = config.registry.slice('ghcr.io/'.length).split('/');
  const ownerInfo = object(JSON.parse((await run(['gh','api',`users/${owner}`])).toString()));
  const namespace = ownerInfo.type === 'Organization' ? 'orgs' : 'users';
  const registry = object(JSON.parse((await run(['gh','api',`${namespace}/${owner}/packages/container/${encodeURIComponent(packageParts.join('/'))}`])).toString()));
  if (registry.visibility !== 'private') warn('registry-not-private', `GHCR package ${config.registry} is not private.`);
  await run(['npx','--no-install','wrangler','whoami','--account',config.cloudflareAccountId], { cwd: ROOT });
}
/** Capture needs about four times the database size; less is reported, not refused. */
export async function storageWarning(config: Pick<CaptureConfig,'state'>, bytes: number): Promise<void> {
  let directory = config.state;
  for (;;) { try { await stat(directory); break; } catch { const parent = dirname(directory); if (parent === directory) return; directory = parent; } }
  const storage = await statfs(directory);
  if (storage.bavail * storage.bsize < bytes * 4) warn('storage-low', 'Free space for private capture is below four times the database size.');
}

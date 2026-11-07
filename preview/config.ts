import { isAbsolute, resolve, relative, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { object, PreviewError, requireFormat, string } from './state.js';

import type { Account } from '../shared/accounts.js';
export type { Account } from '../shared/accounts.js';
export interface Media { root: string; url: string }
export interface Service { status: string[]; identity: string[]; stop: string[]; start: string[]; ready: string[]; released: string[]; expectedIdentity: string; timeout: number }
export interface CaptureConfig { format: 'enois-preview-ts-v1'; state: string; database: string; h2Jar: string; accounts: Account[]; media: Media[]; service: Service }
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
  const service = object(value.service);
  const commands = (name: string): string[] => {
    const args = service[name];
    if (!Array.isArray(args) || !args.length || !args.every((a: unknown) => typeof a === 'string' && a.length > 0)) throw new PreviewError(`Configure service.${name} as an argument array.`);
    return args as string[];
  };
  const timeout = service.timeout ?? 60;
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) throw new PreviewError('Service timeout must be positive.');
  const mappings = value.media ?? [];
  if (!Array.isArray(mappings)) throw new PreviewError('Configure media mappings.');
  const media = mappings.map((entry: unknown) => {
    const item = object(entry); const root = absolute(item.root); const url = string(item.url);
    if (!/^\/[a-zA-Z0-9._/-]+\/$/.test(url) || url.split('/').includes('..') || url.includes('//')) throw new PreviewError('Media URLs require safe prefixes.');
    return { root, url };
  });
  if (media.some((a, i) => media.some((b, j) => i !== j && b.url.startsWith(a.url)))) throw new PreviewError('Media prefixes must not overlap.');
  return { format: value.format, state: absolute(value.state), database: absolute(value.database), h2Jar: absolute(value.h2Jar), accounts: value.accounts === undefined || (Array.isArray(value.accounts) && value.accounts.length===0) ? [] : accounts(value.accounts), media,
    service: { status: commands('status'), identity: commands('identity'), stop: commands('stop'), start: commands('start'), ready: commands('ready'), released: commands('released'), expectedIdentity: string(service.expectedIdentity), timeout } };
}

export function installed(config: Record<string, unknown>): void {
  const record = config.installation;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new PreviewError('Initial Free plan verification required. Run enois-preview setup --config PRIVATE_JSON in an interactive local terminal.');
  const value = object(record);
  const date = typeof value.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.checkedAt) ? Date.parse(value.checkedAt) : NaN;
  if (!Number.isFinite(date) || date > Date.now() || value.freePlansAndSpendingBlocksConfirmed !== true || value.githubOwner !== string(config.repository).split('/')[0] || value.cloudflareAccountId !== config.cloudflareAccountId) throw new PreviewError('Malformed or mismatched initial verification. Run enois-preview setup in an interactive local terminal.');
}

import { access, stat, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { run } from './state.js';
import { ROOT, REPOSITORIES } from './project.js';

export interface Config extends CaptureConfig {
  [key: string]: unknown;
  workspace: string; repositories: Record<string, string>; repository: string; registry: string; branch: string;
  origin: string; cloudflareAccountId: string; toolCommit: string; leaseWaitSeconds: number;
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
  const toolCommit = string(value.toolCommit); const cloudflareAccountId = string(value.cloudflareAccountId);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new PreviewError('Configure an existing private launcher repository.');
  if (!/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+$/.test(registry)) throw new PreviewError('Configure an existing private GHCR destination.');
  if (!/^[a-zA-Z0-9._-]+$/.test(branch)) throw new PreviewError('Configure the launcher publication branch.');
  if (!/^[a-f0-9]{40}$/.test(toolCommit)) throw new PreviewError('Configure the full immutable public toolCommit.');
  if (!/^[a-f0-9]{32}$/.test(cloudflareAccountId)) throw new PreviewError('Configure cloudflareAccountId.');
  const origin = new URL(string(value.origin));
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !origin.hostname) throw new PreviewError('Configure the public HTTPS Worker origin without credentials or a path.');
  const leaseWaitSeconds = value.leaseWaitSeconds ?? 900;
  if (typeof leaseWaitSeconds !== 'number' || !Number.isFinite(leaseWaitSeconds) || leaseWaitSeconds < 0 || leaseWaitSeconds > 3600) throw new PreviewError('leaseWaitSeconds must be between 0 and 3600.');
  return { ...value, ...captureConfig(value), workspace: absolute(value.workspace), repositories, repository, registry, branch, toolCommit, cloudflareAccountId, origin: origin.origin, leaseWaitSeconds };
}
export async function prerequisites(config: Config): Promise<void> {
  for (const name of ['git','node','npm','java','javac','docker','gh','npx','fuser','flock']) {
    const paths = (process.env.PATH ?? '').split(':');
    const found = await Promise.all(paths.map(path => access(join(path, name), constants.X_OK).then(() => true, () => false)));
    if (!found.some(Boolean)) throw new PreviewError(`Install ${name}, then repeat enois-preview setup.`);
  }
  for (const directory of Object.values(config.repositories)) await run(['git', '-C', directory, 'rev-parse', '--git-dir']);
  if (!(await stat(config.h2Jar)).isFile()) throw new PreviewError('Configure the H2 driver jar matching the local database.');
  const database = await stat(config.database); if (!database.isFile()) throw new PreviewError('Configure an existing local H2 file.');
  const storage = await statfs(dirname(config.state));
  if (storage.bavail * storage.bsize < database.size * 4) throw new PreviewError('Insufficient private capture storage.');
  await run(['docker', 'info']);
  const repository = object(JSON.parse((await run(['gh','api',`repos/${config.repository}`])).toString()));
  if (repository.private !== true || object(repository.permissions).push !== true) throw new PreviewError('Launcher must be private and writable.');
  const [owner, ...packageParts] = config.registry.slice('ghcr.io/'.length).split('/');
  const ownerInfo = object(JSON.parse((await run(['gh','api',`users/${owner}`])).toString()));
  const namespace = ownerInfo.type === 'Organization' ? 'orgs' : 'users';
  const registry = object(JSON.parse((await run(['gh','api',`${namespace}/${owner}/packages/container/${encodeURIComponent(packageParts.join('/'))}`])).toString()));
  if (registry.visibility !== 'private') throw new PreviewError('GHCR package must already exist and be private.');
  await run(['npx','--no-install','wrangler','whoami','--account',config.cloudflareAccountId], { cwd: ROOT });
  if ((await run(config.service.identity, { timeout: config.service.timeout })).toString().trim() !== config.service.expectedIdentity) throw new PreviewError('Backend service ownership mismatch; configure its identity and database.');
}

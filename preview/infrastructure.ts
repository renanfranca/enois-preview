import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists, object, PreviewError, readRecord, string, writeRecord } from './state.js';

/** What one operator owns once; never secrets. */
export interface Infrastructure {
  repository: string;
  branch: string;
  registry: string;
  worker: string;
  origin: string;
  cloudflareAccountId: string;
}
export const INFRASTRUCTURE_FIELDS = ['repository', 'branch', 'registry', 'worker', 'origin', 'cloudflareAccountId'] as const;
export const MISSING = 'Infrastructure missing. Run enois-preview setup first.';

export function infrastructureFile(): string {
  return process.env.ENOIS_PREVIEW_INFRASTRUCTURE ?? join(homedir(), '.config/enois-preview-ts/infrastructure.json');
}
export function infrastructureRecord(value: unknown): Infrastructure {
  const record = object(value);
  const repository = string(record.repository);
  const branch = string(record.branch);
  const registry = string(record.registry);
  const worker = string(record.worker);
  const cloudflareAccountId = string(record.cloudflareAccountId);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new PreviewError('Infrastructure launcher repository is invalid; run enois-preview setup.');
  if (!/^[a-zA-Z0-9._-]+$/.test(branch)) throw new PreviewError('Infrastructure launcher branch is invalid; run enois-preview setup.');
  if (!/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+$/.test(registry))
    throw new PreviewError('Infrastructure GHCR destination is invalid; run enois-preview setup.');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(worker)) throw new PreviewError('Infrastructure Worker name is invalid; run enois-preview setup.');
  if (!/^[a-f0-9]{32}$/.test(cloudflareAccountId))
    throw new PreviewError('Infrastructure Cloudflare account is invalid; run enois-preview setup.');
  let origin: URL;
  try {
    origin = new URL(string(record.origin));
  } catch {
    throw new PreviewError('Infrastructure Worker origin is invalid; run enois-preview setup.');
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new PreviewError('Infrastructure Worker origin is invalid; run enois-preview setup.');
  return { repository, branch, registry, worker, origin: origin.origin, cloudflareAccountId };
}
export async function readInfrastructure(file = infrastructureFile()): Promise<Infrastructure> {
  if (!(await exists(file))) throw new PreviewError(MISSING);
  return infrastructureRecord(await readRecord(file));
}
/** Written with mode 0600 through the atomic private record writer. */
export async function writeInfrastructure(value: Infrastructure, file = infrastructureFile()): Promise<void> {
  await writeRecord(file, infrastructureRecord(value));
}
/** publish, resume and source-digest work on the workspace with the operator's infrastructure; infrastructure always wins. */
export function combine(workspace: Record<string, unknown>, infrastructure: Infrastructure): Record<string, unknown> {
  return { ...workspace, ...infrastructure };
}

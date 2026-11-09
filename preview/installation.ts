import { join } from 'node:path';
import { canonical, exists, inventory, PreviewError, readRecord, writeRecord } from './state.js';
import type { Inventory } from './state.js';

export const STAMP = 'install.json';
const OUTSIDE_SOURCE = ['node_modules', 'dist', '.wrangler', STAMP];
const COMMIT = /^[a-f0-9]{40}$/;

export type Contents = { source: Inventory; dist: Inventory };
export async function sourceContents(root: string): Promise<Inventory> { return inventory(root, OUTSIDE_SOURCE); }
export async function installedContents(root: string): Promise<Contents> {
  return { source: await sourceContents(root), dist: await inventory(join(root, 'dist')) };
}
export async function stampInstallation(root: string, commit: string, contents?: Contents): Promise<void> {
  if (!COMMIT.test(commit)) throw new PreviewError('Installation commit must be a full 40 character SHA.');
  const { source, dist } = contents ?? await installedContents(root);
  await writeRecord(join(root, STAMP), { commit, source, dist });
}
export async function verifiedCommit(root: string): Promise<string> {
  const refusal = new PreviewError('Tool is not a verified installation of a public commit; install the configured commit with install-tool before publishing or resuming.');
  if (!await exists(join(root, STAMP))) throw refusal;
  try {
    const record = await readRecord(join(root, STAMP));
    const { commit, source, dist } = record;
    if (typeof commit !== 'string' || !COMMIT.test(commit)) throw refusal;
    if (canonical({ source, dist }) !== canonical(await installedContents(root))) throw refusal;
    return commit;
  } catch { throw refusal; }
}

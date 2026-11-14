import { object, PreviewError, run, string, commandRunner, listenForInterruption } from './state.js';

import { ROOT, REPOSITORIES } from './project.js';
export { ROOT, REPOSITORIES } from './project.js';
export async function commits(config: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, string>> {
  const run = commandRunner(signal);
  const sources = object(config.repositories);
  const result: Record<string, string> = {};
  for (const name of REPOSITORIES) {
    const directory = string(sources[name]);
    const head = (await run(['git', '-C', directory, 'rev-parse', 'HEAD'])).toString().trim();
    if ((await run(['git', '-C', directory, 'status', '--porcelain=v1', '--untracked-files=all'])).length) warn('source-dirty', `${name} has staged, unstaged or untracked changes; only the committed HEAD ${head} is published.`);
    result[name] = head;
  }
  return result;
}

import { constants } from 'node:fs';
import { copyFile, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { accounts as parseAccounts, captureConfig, storageWarning } from './config.js';
import { warn } from './warnings.js';
import type { Account, CaptureConfig } from './config.js';
import { canonical, exists, FORMAT, identity, inventory, lease, privateDir, readRecord, sha, verify, writeRecord } from './state.js';
import type { Inventory } from './state.js';

export interface DataManifest {
  format: typeof FORMAT; id: string; logicalSeedSha256: string; sanitizerSha256: string;
  accounts: Account[]; permissions: Record<string, { admin: boolean; moderator: boolean }>;
  externalReads: string[]; media: { directory: string; url: string; inventory: Inventory }[]; files: Inventory;
}
/** An interactive selection; a missing email becomes a generated disposable login. */
export type AccountSelector=(listing:string,signal:AbortSignal)=>Promise<{id:string;label:string;email?:string}[]>;
export async function sourceLease<T>(config: CaptureConfig, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const base = join(process.env.XDG_RUNTIME_DIR ?? join(homedir(), '.cache'), 'enois-preview/capture');
  return lease(join(base, `${identity(await realpath(config.database))}.lock`), work, signal);
}
/** Copies one regular file privately. Returns false when the source changed during the copy; the copy is still used. */
async function safeCopy(source: string, destination: string): Promise<boolean> {
  const original = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await original.stat(); if (!info.isFile()) throw new PreviewError('Capture source must be a regular file.');
    const before = await sha(source);
    await privateDir(dirname(destination)); const output = await open(destination, 'wx', 0o600);
    try { for await (const chunk of original.createReadStream({ autoClose: false })) await output.write(chunk); await output.sync(); }
    finally { await output.close(); }
    return await sha(destination) === before && await sha(source) === before;
  } finally { await original.close(); }
}
/** Observes, never resolves: an H2 file held by another process is reported, and nothing is stopped or removed. */
async function inUseWarning(database: string, signal?: AbortSignal): Promise<void> {
  const lock = database.endsWith('.mv.db') ? `${database.slice(0, -'.mv.db'.length)}.lock.db` : undefined;
  if (lock && await exists(lock)) { warn('database-in-use', `The configured H2 file appears in use: ${basename(lock)} exists next to it. The copy may be inconsistent.`); return; }
  try { await run(['fuser', database], { signal, timeout: 30 }); }
  catch { signal?.throwIfAborted(); return; }
  warn('database-in-use', 'The configured H2 file appears in use: fuser reports a process holding it. The copy may be inconsistent.');
}
async function copyDatabase(database: string, destination: string, signal?: AbortSignal): Promise<void> {
  await inUseWarning(database, signal);
  if (!await safeCopy(database, destination)) warn('database-changed-during-copy', 'The configured H2 file changed during the copy; the copy is used, and a damaged copy surfaces as a build or validation failure.');
}
async function javaTool(config: CaptureConfig, signal: AbortSignal, action: string, ...args: string[]): Promise<string> {
  const run = commandRunner(signal);
  const classes = await privateDir(join(config.state, 'tools'));
  await run(['javac', '-d', classes, join(ROOT, 'recipe/SeedTool.java')]);
  const logPath = join(classes, `${action}.log`);
  try { return (await run(['java', '-cp', `${classes}:${config.h2Jar}`, 'SeedTool', action, ...args], { logPath })).toString(); }
  catch (error: unknown) {
    signal.throwIfAborted();
    if (action === 'sanitize' && (await readFile(logPath, 'utf8')).includes('Selected identity missing')) throw new PreviewError('Selected identity missing in refreshed data. Correct private account IDs in the configuration or with --accounts, then explicitly refresh again. Previous complete data preserved.');
    throw error;
  }
}
export interface SourceDigest { format: typeof FORMAT; databaseSha256: string; logicalSha256: string; tables: Record<string, number> }
/** Read only: digests a private copy of the configured file, whether or not a backend uses it. Never starts or stops anything. */
export async function sourceDigest(value: unknown, signal: AbortSignal): Promise<SourceDigest> {
  const config = captureConfig(value);
  return sourceLease(config, async () => {
    signal.throwIfAborted();
    const directory = await privateDir(join(config.state, 'digest', randomUUID()));
    try {
      const copy = join(directory, 'rede.mv.db'); await copyDatabase(config.database, copy, signal); const databaseSha256 = await sha(copy);
      let logicalSha256: string | undefined; const tables: Record<string, number> = {};
      for (const line of (await javaTool(config, signal, 'digest', join(directory, 'rede'))).trim().split('\n')) {
        const fields = line.split('\t');
        if (fields[0] === 'logical' && fields.length === 2 && /^[a-f0-9]{64}$/.test(fields[1]!) && logicalSha256 === undefined) logicalSha256 = fields[1];
        else if (fields[0] === 'table' && fields.length === 3 && /^[A-Za-z0-9_]+$/.test(fields[1]!) && /^\d+$/.test(fields[2]!)) tables[fields[1]!] = Number(fields[2]);
        else throw new PreviewError('Unrecognized digest output; no digest reported.');
      }
      if (!logicalSha256) throw new PreviewError('Logical digest missing; no digest reported.');
      return { format: FORMAT, databaseSha256, logicalSha256, tables };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, signal);
}
/** Account selection precedence: explicit IDs, configured accounts, the previous frozen selection, then an interactive terminal. */
export async function capture(value: unknown, previous?: DataManifest, select?: AccountSelector, operationSignal?: AbortSignal, accountIds?: string[]): Promise<DataManifest> {
  const interruption = operationSignal ? undefined : listenForInterruption();
  const signal = operationSignal ?? interruption!.signal;
  const check = () => signal.throwIfAborted();
  try {
  check();
  const config = captureConfig(value);
  return await sourceLease(config, async () => {
    check();
    const staging = await privateDir(join(config.state, 'staging', randomUUID()));
    const raw = await privateDir(join(staging, 'raw')); const seed = await privateDir(join(staging, 'package/seed'));
    const media: DataManifest['media'] = [];
    try {
      await storageWarning(config, (await stat(config.database)).size);
      await copyDatabase(config.database, join(raw, 'rede.mv.db'), signal); check();
      for (const [index, mapping] of config.media.entries()) {
        const files = await inventory(mapping.root); const target = await privateDir(join(staging, 'package/media', String(index)));
        let changed = false;
        for (const file of Object.keys(files)) { check(); if (!await safeCopy(join(mapping.root, file), join(target, file))) changed = true; }
        const copied = await inventory(target);
        if (changed || canonical(copied) !== canonical(files)) warn('media-changed-during-copy', `Media under ${mapping.url} changed during the copy; the copied files are used.`);
        media.push({ directory: String(index), url: mapping.url, inventory: copied });
      }
      check();
      let selectionAccounts: unknown[] = config.accounts.length ? config.accounts : previous?.accounts ?? [];
      if (accountIds?.length) {
        const listing = listed(await javaTool(config, signal, 'list', join(raw, 'rede')));
        selectionAccounts = accountIds.map(id => { const label = listing.get(id); if (label === undefined) throw new PreviewError(`Unknown account ID ${id}; use an ID from the captured listing.`); return { id, label: label || id }; });
      } else if (!selectionAccounts.length && select) selectionAccounts = await select(await javaTool(config, signal, 'list', join(raw, 'rede')), signal);
      check();
      if (!selectionAccounts.length) throw new PreviewError('Select stable account IDs with enois-preview publish SCENARIO --accounts ID[,ID...], in an interactive local terminal, or in the configuration.');
      const selected = parseAccounts(selectionAccounts);
      const selection = join(staging, 'accounts.tsv');
      const handle = await open(selection, 'wx', 0o600);
      try { await handle.writeFile(selected.map(a => `${a.id}\t${a.email}\n`).join('')); } finally { await handle.close(); }
      const sanitizer = join(ROOT, 'recipe/SeedTool.java'); const sanitizerSha256 = await sha(sanitizer);
      for (const line of (await javaTool(config, signal, 'sanitize', join(raw, 'rede'), join(seed, 'rede'), selection)).split('\n')) {
        const fields = line.split('\t');
        if (fields[0] === 'warning' && fields.length === 2 && /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(fields[1]!)) warn('credential-column', `Unrecognized credential-like column ${fields[1]} was kept in the captured data.`);
        else if (line.trim()) throw new PreviewError('Unrecognized sanitizer output; capture remains incomplete.');
      }
      check();
      const permissions: DataManifest['permissions'] = {}; const externalReads: string[] = [];
      for (const line of (await javaTool(config, signal, 'metadata', join(seed, 'rede'), selection)).trim().split('\n')) {
        const fields = line.split('\t');
        if (fields[0] === 'permission' && fields[1]) permissions[fields[1]] = { admin: fields[2] === 'true', moderator: fields[3] === 'true' };
        else if (fields[0] === 'reference' && fields[1]) externalReads.push(Buffer.from(fields[1], 'base64').toString());
        else throw new PreviewError('Unrecognized seed metadata; capture remains incomplete.');
      }
      if (canonical(Object.keys(permissions).sort()) !== canonical(selected.map(a => a.id).sort())) throw new PreviewError('Selected permission inventory incomplete.');
      await writeRecord(join(seed, 'accounts.json'), { accounts: selected });
      const logicalSeedSha256 = (await readFile(join(seed, 'logical.sha256'), 'utf8')).trim();
      await rm(raw, { recursive: true }); await rm(selection); await copyFile(sanitizer, join(staging, 'sanitizer.java'));
      if (await sha(join(staging, 'sanitizer.java')) !== sanitizerSha256) throw new PreviewError('Sanitization recipe changed during capture; retry explicitly.');
      if (previous && previous.sanitizerSha256 === sanitizerSha256 && previous.logicalSeedSha256 === logicalSeedSha256 && canonical(previous.accounts) === canonical(selected) && canonical(previous.media) === canonical(media)) {
        await rm(staging, { recursive: true }); return previous;
      }
      const content = { format: FORMAT, logicalSeedSha256, sanitizerSha256, accounts: selected, permissions, externalReads, media, files: await inventory(join(staging, 'package')) } satisfies Omit<DataManifest, 'id'>;
      const manifest: DataManifest = { ...content, id: identity(content) }; check();
      await writeRecord(join(staging, 'manifest.json'), manifest);
      const target = join(config.state, 'data', manifest.id); await privateDir(dirname(target));
      if (await exists(target)) { const stored = await readRecord(join(target, 'manifest.json')); if (canonical(stored) !== canonical(manifest)) throw new PreviewError('Stored data metadata mismatch.'); await verify(join(target, 'package'), manifest.files); await rm(staging, { recursive: true }); }
      else { check(); await rename(staging, target); }
      check();
      return manifest;
    } catch (error: unknown) {
      await rm(staging, { recursive: true, force: true });
      throw new PreviewError(`Capture incomplete. ${signal.aborted?'Capture interrupted.':error instanceof PreviewError ? error.message : 'Private input unavailable.'} Previous complete data preserved; retry publication explicitly.`);
    }
  }, signal);
  } finally { interruption?.dispose(); }
}
function listed(listing: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of listing.split('\n')) { if (!line) continue; const split = line.indexOf('\t'); if (split < 1) throw new PreviewError('No usable existing identities in the captured data.'); rows.set(line.slice(0, split), line.slice(split + 1).trim()); }
  return rows;
}

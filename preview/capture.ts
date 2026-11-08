import { object, PreviewError, run, string, commandRunner, listenForInterruption } from './state.js';

import { ROOT, REPOSITORIES } from './project.js';
export { ROOT, REPOSITORIES } from './project.js';
export async function commits(config: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, string>> {
  const run = commandRunner(signal);
  const sources = object(config.repositories);
  const result: Record<string, string> = {};
  for (const name of REPOSITORIES) {
    const directory = string(sources[name]);
    if ((await run(['git', '-C', directory, 'status', '--porcelain=v1', '--untracked-files=all'])).length) {
      throw new PreviewError(`${name} has staged, unstaged or untracked source changes; commit or resolve them before publishing. No service was stopped.`);
    }
    result[name] = (await run(['git', '-C', directory, 'rev-parse', 'HEAD'])).toString().trim();
  }
  return result;
}

import { constants } from 'node:fs';
import { copyFile, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { accounts as parseAccounts, captureConfig } from './config.js';
import type { Account, CaptureConfig } from './config.js';
import { canonical, exists, FORMAT, identity, inventory, lease, privateDir, readRecord, sha, verify, writeRecord } from './state.js';
import type { Inventory } from './state.js';

export interface DataManifest {
  format: typeof FORMAT; id: string; logicalSeedSha256: string; sanitizerSha256: string;
  accounts: Account[]; permissions: Record<string, { admin: boolean; moderator: boolean }>;
  externalReads: string[]; media: { directory: string; url: string; inventory: Inventory }[]; files: Inventory;
}
export type AccountSelector=(listing:string,signal:AbortSignal)=>Promise<Account[]>;
async function service(config: CaptureConfig, action: 'status'|'identity'|'stop'|'start'|'ready'|'released', signal?: AbortSignal): Promise<string> {
  return (await run(config.service[action], { timeout: config.service.timeout, signal })).toString().trim();
}
async function wait(config: CaptureConfig, action: 'status'|'ready'|'released', expected: string, signal?: AbortSignal): Promise<void> {
  const deadline = performance.now() + config.service.timeout * 1000;
  do {
    try { if (await service(config, action, signal) === expected) return; } catch (error) { signal?.throwIfAborted(); if (!(error instanceof PreviewError)) throw error; }
    await delay(100, undefined, { signal });
  } while (performance.now() < deadline);
  throw new PreviewError(`Backend ${action} did not confirm ${expected}; restoration is pending if recorded.`);
}
export async function recover(config: CaptureConfig, shutdownPending = false): Promise<void> {
  const file = join(config.state, 'restoration.json'); if (!await exists(file)) return;
  const record = await readRecord(file);
  if (canonical(record.service) !== canonical(config.service) || record.database !== config.database) throw new PreviewError('Pending restoration belongs to another service configuration.');
  if (await service(config, 'identity') !== config.service.expectedIdentity) throw new PreviewError('Pending backend restoration: service identity mismatch.');
  let status = await service(config, 'status');
  if (record.running === true) {
    if(shutdownPending && status === 'running'){
      await service(config,'stop');
      await wait(config,'status','stopped');
      status='stopped';
    }
    if (status === 'stopped') await service(config, 'start'); else if (status !== 'running') throw new PreviewError('Backend restoration: ambiguous service status.');
    await wait(config, 'ready', 'ready');
  } else if (record.running !== false || status !== 'stopped') throw new PreviewError('Previously stopped backend changed state; inspect before continuing.');
  await rm(file);
}
export async function sourceLease<T>(config: CaptureConfig, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const base = join(process.env.XDG_RUNTIME_DIR ?? join(homedir(), '.cache'), 'enois-preview/capture');
  return lease(join(base, `${identity(await realpath(config.database))}.lock`), work, signal);
}
async function safeCopy(source: string, destination: string): Promise<void> {
  const original = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await original.stat(); if (!info.isFile()) throw new PreviewError('Capture source must be a regular file.');
    const before = await sha(source);
    await privateDir(dirname(destination)); const output = await open(destination, 'wx', 0o600);
    try { for await (const chunk of original.createReadStream({ autoClose: false })) await output.write(chunk); await output.sync(); }
    finally { await output.close(); }
    if (await sha(destination) !== before || await sha(source) !== before) throw new PreviewError('Source changed during capture; incomplete copy rejected.');
  } finally { await original.close(); }
}
async function javaTool(config: CaptureConfig, signal: AbortSignal, action: string, ...args: string[]): Promise<string> {
  const run = commandRunner(signal);
  const classes = await privateDir(join(config.state, 'tools'));
  await run(['javac', '-d', classes, join(ROOT, 'recipe/SeedTool.java')]);
  const logPath = join(classes, `${action}.log`);
  try { return (await run(['java', '-cp', `${classes}:${config.h2Jar}`, 'SeedTool', action, ...args], { logPath })).toString(); }
  catch (error: unknown) {
    signal.throwIfAborted();
    if (action === 'sanitize' && (await readFile(logPath, 'utf8')).includes('Selected identity missing')) throw new PreviewError('Selected identity missing in refreshed data. Correct private account IDs with setup, then explicitly refresh again. Previous complete data preserved; backend restored.');
    throw error;
  }
}
export async function capture(value: unknown, previous?: DataManifest, select?: AccountSelector, operationSignal?: AbortSignal): Promise<DataManifest> {
  const interruption = operationSignal ? undefined : listenForInterruption();
  const signal = operationSignal ?? interruption!.signal;
  const check = () => signal.throwIfAborted();
  try {
  check();
  const config = captureConfig(value);
  const restoration = join(config.state, 'restoration.json');
  if (await exists(restoration)) await readRecord(restoration);
  return await sourceLease(config, async () => {
    await recover(config);
    check();
    const initial = await service(config, 'status', signal);
    if (!['running','stopped'].includes(initial) || await service(config, 'identity', signal) !== config.service.expectedIdentity) throw new PreviewError('Backend identity or state is ambiguous; no capture attempted.');
    const staging = await privateDir(join(config.state, 'staging', randomUUID()));
    const raw = await privateDir(join(staging, 'raw')); const seed = await privateDir(join(staging, 'package/seed'));
    check();
    await writeRecord(restoration, { service: config.service, database: config.database, running: initial === 'running' });
    const media: DataManifest['media'] = [];
    let shutdownPending=false;
    try {
      try {
        check();
        if (initial === 'running') { shutdownPending=true; await service(config, 'stop', signal); }
        await wait(config, 'status', 'stopped', signal); shutdownPending=false;
        await wait(config, 'released', 'released', signal); check();
        try { await run(['fuser',config.database],{signal,timeout:config.service.timeout,successCodes:[1]}); }
        catch(error:unknown){ check(); throw new PreviewError('H2 is in use or cannot be checked. No lock file was removed.'); }
        await safeCopy(config.database, join(raw, 'rede.mv.db')); check();
        for (const [index, mapping] of config.media.entries()) {
          const files = await inventory(mapping.root); const target = await privateDir(join(staging, 'package/media', String(index)));
          for (const file of Object.keys(files)) { check(); await safeCopy(join(mapping.root, file), join(target, file)); }
          await verify(mapping.root, files); await verify(target, files); media.push({ directory: String(index), url: mapping.url, inventory: files });
        }
      } finally { await recover(config,shutdownPending); }
      check();
      let selectionAccounts=config.accounts.length?config.accounts:previous?.accounts??[];
      if(!selectionAccounts.length&&select)selectionAccounts=await select(await javaTool(config, signal,'list',join(raw,'rede')),signal);
      check();
      if(!selectionAccounts.length)throw new PreviewError('Select stable account IDs with enois-preview publish SCENARIO in an interactive local terminal, or configure accounts. Backend restored; capture incomplete.');
      const selected = parseAccounts(selectionAccounts);
      const selection = join(staging, 'accounts.tsv');
      const handle = await open(selection, 'wx', 0o600);
      try { await handle.writeFile(selected.map(a => `${a.id}\t${a.email}\n`).join('')); } finally { await handle.close(); }
      const sanitizer = join(ROOT, 'recipe/SeedTool.java'); const sanitizerSha256 = await sha(sanitizer);
      await javaTool(config, signal, 'sanitize', join(raw, 'rede'), join(seed, 'rede'), selection); check();
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
      const status = await exists(restoration) ? 'restoration pending' : 'restored to its prior state';
      throw new PreviewError(`Capture incomplete; backend ${status}. ${signal.aborted?'Capture interrupted.':error instanceof PreviewError ? error.message : 'Private input unavailable.'} Previous complete data preserved; retry publication explicitly.`);
    }
  }, signal);
  } finally { interruption?.dispose(); }
}

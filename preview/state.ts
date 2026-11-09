import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { kill, platform } from 'node:process';

import { canonical, FORMAT, object, PreviewError, requireFormat } from '../shared/records.js';
export { canonical, FORMAT, object, PreviewError, requireFormat, string } from '../shared/records.js';
export async function readRecord(file: string): Promise<Record<string, unknown> & { format: typeof FORMAT }> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  requireFormat(value);
  return value;
}

export function identity(value: unknown): string { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }

export async function run(args: readonly string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; input?: string | Uint8Array; logPath?: string; signal?: AbortSignal | undefined; successCodes?: readonly number[] } = {}): Promise<Buffer> {
  options.signal?.throwIfAborted();
  const executable = args[0];
  if (!executable) throw new PreviewError('Missing command.');
  if (options.logPath) await privateDir(dirname(options.logPath));
  const log = options.logPath ? await open(options.logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600) : undefined;
  if (log) await log.chmod(0o600);
  try {
    options.signal?.throwIfAborted();
    return await new Promise<Buffer>((resolve, reject) => {
    const process = spawn(executable, args.slice(1), { cwd: options.cwd, env: options.env, detached: platform === 'linux', stdio: ['pipe',log?.fd ?? 'pipe',log?.fd ?? 'pipe'] });
    const output: Buffer[] = [];
    let timedOut=false;
    let terminationError: PreviewError | undefined;
    const terminate = () => {
      try {
        if (platform === 'linux' && process.pid) kill(-process.pid, 'SIGKILL');
        else process.kill('SIGKILL');
      } catch (error: unknown) {
        if (object(error).code !== 'ESRCH') terminationError = new PreviewError(`${basename(executable)} command group termination failed; inspect private diagnostics and durable recovery state.`);
      }
    };
    const timer = setTimeout(() => { timedOut=true; terminate(); }, (options.timeout ?? 600) * 1000);
    const cancelled = () => terminate();
    options.signal?.addEventListener('abort', cancelled, { once: true });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancelled); };
    process.stdout?.on('data', (chunk: Buffer) => output.push(chunk));
    process.stderr?.resume();
    process.on('error', () => { cleanup(); reject(new PreviewError(`${basename(executable)} unavailable; inspect private diagnostics.`)); });
    process.on('close', code => {
      cleanup();
      if(options.signal?.aborted)reject(options.signal.reason);
      else if(terminationError)reject(terminationError);
      else if(timedOut)reject(new PreviewError(`${basename(executable)} timed out; inspect private diagnostics and durable recovery state.`));
      else if (code === null || !(options.successCodes ?? [0]).includes(code)) reject(new PreviewError(`${basename(executable)} failed (exit ${code}); inspect the configured service or authentication.`));
      else if (options.logPath) void readFile(options.logPath).then(resolve, reject);
      else resolve(Buffer.concat(output));
    });
    process.stdin?.on('error', () => {});
    process.stdin?.end(options.input);
  }); } finally { await log?.close(); }
}

export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error: unknown) { if (object(error).code === 'ENOENT') return false; throw error; }
}
export async function privateDir(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new PreviewError('Private directory must be a real directory.');
  await chmod(directory, 0o700); return directory;
}
export async function writeRecord(file: string, value: object): Promise<void> {
  if (await exists(file)) await readRecord(file);
  const data = Array.isArray(value) ? { format: FORMAT, items: value } : { ...value, format: FORMAT };
  await privateDir(dirname(file));
  const temporary = join(dirname(file), `.pending-${randomUUID()}`);
  const stream = await open(temporary, 'wx', 0o600);
  try {
    await stream.writeFile(canonical(data) + '\n'); await stream.sync(); await stream.close();
    await rename(temporary, file);
    const parent = await open(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await stream.close(); await rm(temporary, { force: true }); }
}
export async function sha(file: string): Promise<string> {
  const digest = createHash('sha256'); const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); return digest.digest('hex'); }
  finally { await handle.close(); }
}
export type Inventory = Record<string, { bytes: number; sha256: string }>;
export async function inventory(root: string, outside: readonly string[] = []): Promise<Inventory> {
  const result: Inventory = {};
  const base = await lstat(root);
  if (!base.isDirectory() || base.isSymbolicLink()) throw new PreviewError('Inventory root is missing or is a symlink.');
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      if (directory === root && outside.includes(name)) continue;
      const file = join(directory, name); const info = await lstat(file);
      if (info.isSymbolicLink()) throw new PreviewError('Symlinks are not allowed in frozen inputs.');
      if (info.isFile()) result[relative(root, file).split(sep).join('/')] = { bytes: info.size, sha256: await sha(file) };
      else if (info.isDirectory()) await visit(file);
      else throw new PreviewError('Unsupported object in frozen inputs.');
    }
  }
  await visit(root); return result;
}
export async function verify(root: string, expected: unknown): Promise<void> {
  if (canonical(await inventory(root)) !== canonical(expected)) throw new PreviewError('Frozen input integrity failure; restore the recorded artifact. No live recapture was attempted.');
}
export async function lease<T>(file: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  await privateDir(dirname(file));
  const handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn('flock', ['--exclusive', '3'], { stdio: ['ignore','ignore','ignore', handle.fd] });
      const cancelled = () => { child.kill('SIGKILL'); };
      signal?.addEventListener('abort', cancelled, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', cancelled);
      child.on('error', () => { cleanup(); reject(new PreviewError('Linux flock is required for capture exclusion.')); });
      child.on('close', code => { cleanup(); if(signal?.aborted)reject(signal.reason); else if(code === 0)resolve(); else reject(new PreviewError('Unable to acquire process lease.')); });
    });
    signal?.throwIfAborted();
    return await work();
  } finally { await handle.close(); }
}

export function commandRunner(signal?: AbortSignal): typeof run {
  return (args, options = {}) => run(args, { ...options, signal });
}

export function listenForInterruption() {
  const controller = new AbortController();
  let first: 'SIGINT' | 'SIGTERM' | undefined;
  const interrupt = (signal: 'SIGINT' | 'SIGTERM') => {
    if(first)return;
    first=signal;
    console.error(`Interrupted by ${signal}; cancelling active work and completing required restoration.`);
    controller.abort(new PreviewError(`Interrupted by ${signal}.`));
  };
  const onInt=()=>interrupt('SIGINT'), onTerm=()=>interrupt('SIGTERM');
  process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  return {signal:controller.signal, get exitCode(){return first==='SIGINT'?130:first==='SIGTERM'?143:undefined;},
    dispose(){process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}};
}

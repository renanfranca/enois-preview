import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from '../preview/capture.js';
import type { CaptureConfig } from '../preview/config.js';
import { exists, identity, inventory, object, PreviewError, privateDir, readRecord, run, string } from '../preview/state.js';
import { readPidRecord } from '../preview/service.js';
import { publicationHome } from '../test/fixtures/publication-home.js';

export interface LiveSpring { config: CaptureConfig; origin: string; serviceFile: string }
export interface CrossProcessContext { evidence: string; live: LiveSpring; h2Jar: string; ready: (origin: string) => Promise<void>; loginAll: (origin: string) => Promise<void> }
interface ServiceEvent { phase: 'begin' | 'end'; action: string; recorder: number; at: number; recordPresent?: boolean; shutdown?: string | null; pid?: number | null; code?: number | null; stdout?: string }
type Variant = 'sigkill' | 'timeout';

function require(condition: unknown, message: string): asserts condition { if (!condition) throw new PreviewError(message); }
const ACTIONS = ['identity', 'status', 'start', 'stop', 'released', 'ready'] as const;
const SIGTERM_BIT = 1n << 14n;

async function processState(pid: number): Promise<string> {
  try { return (await readFile(`/proc/${pid}/stat`, 'utf8')).replace(/^\d+ \(.*\) /s, '')[0] ?? 'unknown'; } catch { return 'gone'; }
}
/** True when SIGTERM is queued for the process (thread or shared pending set) but not yet delivered. */
async function sigtermPending(pid: number): Promise<boolean> {
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    return ['SigPnd', 'ShdPnd'].some(field => (BigInt('0x' + (status.match(new RegExp(`^${field}:\\s*([0-9a-f]+)`, 'm'))?.[1] ?? '0')) & SIGTERM_BIT) !== 0n);
  } catch { return false; }
}
async function until(check: () => Promise<boolean> | boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await check()) return true; await delay(25); }
  return check();
}
function cli(command: string, home: string, args: string[]) {
  const child = spawn(process.execPath, [command, '--home', home, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  child.stdout!.on('data', chunk => { output.stdout += String(chunk); }); child.stderr!.on('data', chunk => { output.stderr += String(chunk); });
  const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
  return { child, output, closed, alive: () => child.exitCode === null && child.signalCode === null };
}
async function settled(process: { closed: Promise<[number | null, NodeJS.Signals | null]> }, milliseconds: number, message: string): Promise<[number | null, NodeJS.Signals | null]> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([process.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PreviewError(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function logicalDigest(database: string, h2Jar: string, scratch: string): Promise<string> {
  const directory = await privateDir(join(scratch, randomUUID()));
  try {
    await cp(database, join(directory, 'rede.mv.db'));
    await run(['javac', '-d', directory, join(ROOT, 'recipe/SeedTool.java')]);
    const lines = (await run(['java', '-cp', `${directory}:${h2Jar}`, 'SeedTool', 'digest', join(directory, 'rede')])).toString().trim().split('\n');
    const logical = lines.map(line => line.split('\t')).find(fields => fields[0] === 'logical' && /^[a-f0-9]{64}$/.test(fields[1] ?? ''))?.[1];
    require(logical, 'SeedTool digest reported no logical digest.');
    return logical;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/**
 * Two independent CLI processes against the real Spring/H2 copy. The barrier is SIGSTOP on the owned JVM taken
 * just before the first process stops it: the real stop is then accepted (SIGTERM queued by the kernel) without
 * effect until the validator sends SIGCONT, which releases Spring's normal graceful shutdown.
 */
export async function crossProcessRecovery(context: CrossProcessContext): Promise<Record<string, unknown>> {
  const { live } = context; const timeout = live.config.service.timeout;
  const service = async (action: typeof ACTIONS[number]) => (await run(live.config.service[action], { timeout })).toString().trim();
  const pidfile = string(object(JSON.parse(await readFile(live.serviceFile, 'utf8'))).pidfile);
  const ownedPid = async () => (await readPidRecord(pidfile))?.pid;
  const stopReleased = async () => {
    await service('stop'); require(await service('status') === 'stopped', 'Copy Spring did not stop.');
    require(await until(async () => await service('released') === 'released', 30_000), 'Copy H2 was not released after stop.');
  };
  const independent = createServer((_request, response) => response.end('independent ready'));
  independent.listen(0, '127.0.0.1'); await once(independent, 'listening');
  const address = independent.address(); require(address && typeof address === 'object', 'No independent server address.');
  const independentReady = async () => (await (await fetch(`http://127.0.0.1:${address.port}`)).text()) === 'independent ready';
  const scratch = await privateDir(join(context.evidence, 'cross-process-digest'));

  async function variant(name: Variant): Promise<Record<string, unknown>> {
    const home = await publicationHome(await privateDir(join(context.evidence, `cross-process-${name}`)), ROOT);
    const events = join(home.root, 'service-events.jsonl'); const restoration = join(home.config.state, 'restoration.json');
    const recorder = join(ROOT, 'dist/test/fixtures/service-recorder.js'); const serviceJs = join(ROOT, 'dist/preview/service.js');
    const commands = Object.fromEntries(ACTIONS.map(action => [action, [process.execPath, recorder, events, restoration, serviceJs, live.serviceFile, action]]));
    await writeFile(events, '', { mode: 0o600 });
    await writeFile(join(home.home, 'config.json'), JSON.stringify({ ...home.config, database: live.config.database, h2Jar: context.h2Jar, service: { ...commands, expectedIdentity: live.config.service.expectedIdentity, timeout } }), { mode: 0o600 });
    const read = async (): Promise<ServiceEvent[]> => (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as ServiceEvent);
    const record = async () => await exists(restoration) ? await readRecord(restoration) : undefined;
    const dataBefore = identity(await inventory(join(home.config.state, 'data'))); const manifest = join(home.config.state, 'data', home.data, 'manifest.json'); const manifestBefore = await readFile(manifest);

    require(await service('status') === 'running', 'Copy Spring must be running before the variant.'); await context.ready(live.origin);
    const jvm = await ownedPid(); require(jvm, 'Copy Spring PID unavailable.');
    let paused = false; const orphans: number[] = []; let first: ReturnType<typeof cli> | undefined; let second: ReturnType<typeof cli> | undefined;
    try {
      process.kill(jvm, 'SIGSTOP'); paused = true;
      require(await until(async () => await processState(jvm) === 'T', 5000), 'Copy JVM did not pause.');
      first = cli(home.cli, home.home, ['publish', 'fixture', '--refresh-data']);
      const p1 = first;
      require(await until(async () => (await read()).some(event => event.phase === 'begin' && event.action === 'stop') || !p1.alive(), 60_000) && p1.alive(), `First process did not reach the real stop: ${p1.output.stderr}`);
      require(await until(() => sigtermPending(jvm), 10_000), 'The real stop did not leave SIGTERM pending on the paused JVM.');
      const stopAccepted = (await read()).find(event => event.phase === 'begin' && event.action === 'stop')!;
      let firstProcess: Record<string, unknown>;
      if (name === 'sigkill') {
        p1.child.kill('SIGKILL'); const exit = await settled(p1, 10_000, 'First process survived SIGKILL.');
        require(exit[0] === null && exit[1] === 'SIGKILL', `First process ended with ${exit.join(',')}.`);
        const orphan = (await read()).filter(event => event.phase === 'begin' && event.action === 'stop').map(event => event.recorder);
        orphans.push(...orphan); firstProcess = { signal: 'SIGKILL', exit, finallyRan: false, orphanStopRecorders: orphan.length };
      } else {
        p1.child.kill('SIGINT');
        require(await until(async () => (await read()).filter(event => event.phase === 'begin' && event.action === 'stop').length >= 2, 30_000), `Interrupted restoration did not settle the accepted stop: ${p1.output.stderr}`);
        require(p1.alive(), `First process ended before its restoration timed out: ${p1.output.stderr}`);
        p1.child.kill('SIGTERM');
        const exit = await settled(p1, (timeout + 90) * 1000, 'First process restoration did not time out.');
        require(exit[0] === 130 && exit[1] === null, `First process ended with ${exit.join(',')}: ${p1.output.stderr}`);
        require(p1.output.stdout === '', 'First process reported output after interruption.');
        require(/restoration pending/.test(p1.output.stderr), `First process did not report pending restoration: ${p1.output.stderr}`);
        firstProcess = { firstSignal: 'SIGINT', furtherSignal: 'SIGTERM', exit, stdoutEmpty: true, restorationPendingReported: true };
      }
      const retained = await record();
      require(retained?.shutdown === 'requested' && retained.running === true, 'Restoration record did not retain the accepted shutdown after the first process.');
      require(await service('status') === 'running' && await processState(jvm) === 'T' && await sigtermPending(jvm), 'Paused JVM did not keep the accepted stop pending after the first process.');

      await writeFile(join(string(home.config.repositories['enois-frontend']), 'source'), 'dirty after interruption');
      const offset = (await read()).length; const later = async () => (await read()).slice(offset).filter(event => !orphans.includes(event.recorder));
      second = cli(home.cli, home.home, ['publish', 'fixture']); const p2 = second;
      await until(() => !p2.alive(), 10_000);
      const observed = await later(); const begins = observed.filter(event => event.phase === 'begin').map(event => event.action);
      const pendingRecord = await record();
      require(p2.alive(), `Second process ended while the accepted stop was pending: ${p2.output.stderr}`);
      require(!begins.includes('ready') && !begins.includes('start'), `Readiness trusted while the accepted stop is pending: ${begins.join(',')}`);
      require(begins[0] === 'identity' && begins.includes('status') && begins.includes('stop'), `Second process did not check identity, status and stop first: ${begins.join(',')}`);
      require(pendingRecord?.shutdown === 'requested', 'Record lost its accepted shutdown while it was pending.');
      require(!/source changes/.test(p2.output.stderr), 'Dirty source refused before restoration settled.');
      const window = { secondProcessAlive: true, events: begins, readyOrStartWhilePending: false, recordRetainedWithShutdown: true, sourceRefusalBeforeSettlement: false, jvmState: await processState(jvm), sigtermStillPending: await sigtermPending(jvm) };

      process.kill(jvm, 'SIGCONT'); paused = false;
      const exit = await settled(p2, (timeout * 2 + 60) * 1000, 'Second process did not finish restoration.');
      require(exit[0] === 1 && exit[1] === null && /source changes.*No service was stopped/.test(p2.output.stderr), `Second process ended with ${exit.join(',')}: ${p2.output.stderr}`);
      const sequence = await later();
      const stopped = sequence.findIndex(event => event.phase === 'end' && event.action === 'status' && event.stdout === 'stopped');
      const start = sequence.findIndex((event, index) => index > stopped && event.phase === 'begin' && event.action === 'start');
      const ready = sequence.findIndex((event, index) => index > start && event.phase === 'end' && event.action === 'ready' && event.stdout === 'ready');
      const readyBegin = sequence.slice(0, ready).findLastIndex(event => event.phase === 'begin' && event.action === 'ready');
      require(stopped !== -1 && start !== -1 && ready !== -1, `Second process order was not stopped, start, ready: ${JSON.stringify(sequence.map(event => [event.phase, event.action, event.stdout ?? '']))}`);
      require(sequence[start]!.recordPresent === true && sequence[start]!.shutdown === null, 'Start ran without the record rewritten without shutdown.');
      require(sequence[readyBegin]!.recordPresent === true, 'Record removed before readiness confirmed.');
      require(!await exists(restoration), 'Restoration record remained after recovery.');
      require(await service('status') === 'running', 'Copy Spring not running after recovery.');
      const restarted = await ownedPid(); require(restarted && restarted !== jvm && await processState(restarted) !== 'gone', 'Pidfile does not point to the restarted live JVM.');
      if (orphans.length) require(await until(async () => (await read()).filter(event => event.phase === 'end' && orphans.includes(event.recorder)).length === orphans.length, 15_000), 'Orphan stop did not finish after the JVM stopped.');
      const orphanEnd = (await read()).filter(event => event.phase === 'end' && orphans.includes(event.recorder));
      require(await service('status') === 'running' && await ownedPid() === restarted, 'Orphan stop removed the restarted backend pidfile.');
      require(identity(await inventory(join(home.config.state, 'data'))) === dataBefore && (await readFile(manifest)).equals(manifestBefore), 'Complete fixture data changed.');
      require(!await exists(join(home.config.state, 'operations')), 'Recovery created an operation.');
      require(await independentReady(), 'Independent HTTP server stopped responding.');
      await context.ready(live.origin);
      return {
        transport: 'two CLI processes; real service.js, Spring and H2 copy; SIGSTOP barrier on the owned JVM', firstProcess,
        acceptedStopPendingAtFirstProcess: { recordShutdown: stopAccepted.shutdown, statusWhilePaused: 'running', sigtermPending: true },
        restorationPendingAfterFirstProcess: true, secondProcessWindow: window,
        secondProcessEvents: sequence.map(event => ({ phase: event.phase, action: event.action, ...(event.phase === 'begin' ? { recordPresent: event.recordPresent, shutdown: event.shutdown } : { code: event.code, stdout: event.action === 'identity' ? (event.stdout === live.config.service.expectedIdentity ? 'expected identity' : 'other identity') : event.stdout }) })),
        stoppedBeforeStart: true, startWithRecordWithoutShutdown: true, readyWithRecordPresent: true, dirtySourceRefusalAfterRecovery: true,
        recordAfterRecovery: false, finalStatus: 'running', newPid: restarted !== jvm, pidfilePointsToLiveJvm: true,
        orphanStop: orphans.length ? { count: orphans.length, ended: orphanEnd.length, codes: orphanEnd.map(event => event.code), endedBeforeRestartAt: orphanEnd.every(event => event.at < sequence[start]!.at) } : null,
        completeDataPreserved: true, operationsCreated: false, independentServiceReady: true,
      };
    } finally {
      if (paused) { try { process.kill(jvm, 'SIGCONT'); } catch {} }
      first?.child.kill('SIGKILL'); second?.child.kill('SIGKILL');
      for (const pid of orphans) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    }
  }

  try {
    await stopReleased(); const snapshot = join(scratch, 'before.mv.db'); await cp(live.config.database, snapshot);
    await service('start'); await context.ready(live.origin);
    const variants = { sigkill: await variant('sigkill'), timeout: await variant('timeout') };
    await stopReleased(); const before = await logicalDigest(snapshot, context.h2Jar, scratch); const after = await logicalDigest(live.config.database, context.h2Jar, scratch); await rm(snapshot);
    require(after === before, 'Cross-process recovery changed the logical content of the copy.');
    await service('start'); await context.ready(live.origin); await context.loginAll(live.origin);
    return { realSpringAndH2: true, variants, logicalSha256Before: before, logicalSha256After: after, logicalContentUnchanged: true, originalLoginsValidAfterCrossProcess: 4, independentServiceReady: await independentReady() };
  } finally { independent.closeAllConnections(); await new Promise<void>(done => independent.close(() => done())); }
}

#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { captureConfig, validateConfig, prerequisites, warnIgnoredFields } from './config.js';
import { sourceDigest } from './capture.js';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PreviewError, readRecord, privateDir, lease, writeRecord, listenForInterruption, invokedDirectly } from './state.js';
import { collectWarnings, warn } from './warnings.js';

const NO_TERMINAL='Select stable account IDs with enois-preview publish SCENARIO --accounts ID[,ID...], in an interactive local terminal, or in the configuration.';
async function selectAccounts(listing:string,signal:AbortSignal):Promise<{id:string;label:string}[]>{
  if(!process.stdin.isTTY)throw new PreviewError(NO_TERMINAL);
  const rows=new Map<string,string>();
  for(const line of listing.trim().split('\n')){const split=line.indexOf('\t');if(split<1)throw new PreviewError('No usable existing identities in the captured data; inspect private selection evidence.');rows.set(line.slice(0,split),line.slice(split+1));}
  console.error('Existing identities (private terminal only):');
  for(const [id,label]of rows)console.error(`${id}: ${label}`);
  const prompt=createInterface({input:process.stdin,output:process.stderr});
  prompt.on('SIGINT',()=>process.emit('SIGINT'));
  try{
    const answer=await prompt.question('Stable IDs to make available, separated by commas: ',{signal});
    return answer.split(',').map(value=>{const id=value.trim();const label=rows.get(id);if(label===undefined)throw new PreviewError('Unknown account ID; retry with a listed identity.');return {id,label:label||id};});
  }finally{prompt.close();}
}
function accountIds(value:string|undefined):string[]|undefined{
  if(value===undefined)return undefined;
  const ids=value.split(',').map(id=>id.trim());
  if(!ids.length||ids.some(id=>!/^[A-Za-z0-9_-]{1,100}$/.test(id))||new Set(ids).size!==ids.length)throw new PreviewError('Use --accounts with distinct stable IDs separated by commas.');
  return ids;
}
const FREE_PLAN='Keep GitHub Free and Cloudflare Workers Free with additional spending blocked for the configured accounts; enois-preview does not verify billing.';

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const interruption = listenForInterruption();
  const signal = interruption.signal;
  let failure = 'Publication incomplete';
  let unexpected = 'Invalid or unavailable private input. Run enois-preview --help.';
  try {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, home: { type: 'string' }, config: { type: 'string' }, 'refresh-data': { type: 'boolean' }, accounts: { type: 'string' }, 'force-lease': { type: 'boolean' } } });
  if (values.help) {
    console.log(`enois-preview: Publish immutable, disposable Énóis PR previews.

Usage: enois-preview [--home PRIVATE_DIRECTORY] COMMAND

Commands:
  setup --config PRIVATE_JSON    Verify existing infrastructure and store the configuration
  publish SCENARIO [--refresh-data] [--accounts ID[,ID...]] [--force-lease]    Publish commits with frozen scenario data
  resume REVISION [--force-lease]    Continue the recorded immutable revision
  source-digest    Report the logical digest of the source database from a private copy (read only)
  install PUBLIC_TOOL_COMMIT    Install another verified public commit and point the command at it

Every final JSON result carries warnings: [{code, message}]; each warning is also printed on stderr as "warning: MESSAGE".`);
    return 0;
  }
  const command=positionals[0];
  if (command==='source-digest') failure='Source digest incomplete';
  if (command==='install') { failure='Installation incomplete'; unexpected='Installation failed; inspect the logs under the installation prefix.'; }
  const publicationOnly = values.accounts!==undefined || values['force-lease']!==undefined;
  if ((command==='setup' && (positionals.length!==1 || values['refresh-data'] || publicationOnly)) ||
      (command==='publish' && (positionals.length!==2 || values.config!==undefined)) ||
      (command==='resume' && (positionals.length!==2 || values.config!==undefined || values['refresh-data'] || values.accounts!==undefined)) ||
      (command==='source-digest' && (positionals.length!==1 || values.config!==undefined || values['refresh-data'] || publicationOnly)) ||
      (command==='install' && (positionals.length!==2 || values.config!==undefined || values['refresh-data'] || publicationOnly))) {
    throw new PreviewError('Invalid command arguments. Run enois-preview --help.');
  }
  if (command==='install') {
    // Needs no configuration and touches no private state: it adds an installation under the default prefix ~/.local/share/enois-preview, beside the running one.
    const { installTool } = await import('../scripts/install-tool.js');
    signal.throwIfAborted();
    console.log(JSON.stringify(await installTool(positionals[1] ?? '', undefined, undefined, signal),null,2));
    return 0;
  }
  const home = values.home ?? process.env.ENOIS_PREVIEW_HOME ?? join(homedir(), '.config/enois-preview-ts');
  const file = join(home, 'config.json');
  const hasConfig = await access(file).then(() => true, () => false);
  const config = hasConfig ? await readRecord(file) : undefined;
  const finish = (outcome: { result: Record<string, unknown>; warnings: unknown[] }) => { signal.throwIfAborted(); console.log(JSON.stringify({ ...outcome.result, warnings: outcome.warnings },null,2)); return 0; };
  if (command==='source-digest') {
    // Read only, so it needs no verified installation: it must work before the tool is installed.
    if (!config) throw new PreviewError('Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.');
    return finish(await collectWarnings(async () => { warnIgnoredFields(config); return { ...await sourceDigest(config, signal) }; }));
  }
  if (['publish', 'resume'].includes(command ?? '')) {
    if (!config) throw new PreviewError('Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.');
    const selected = accountIds(values.accounts);
    const { publishRevision, resumeRevision } = await import('./publication.js');
    signal.throwIfAborted();
    return finish(await collectWarnings(async () => {
      warnIgnoredFields(config);
      return command === 'publish'
        ? await publishRevision(config, positionals[1] ?? '', { refresh: values['refresh-data'] ?? false, select: selectAccounts, ...(selected ? { accounts: selected } : {}), forceLease: values['force-lease'] ?? false }, signal)
        : await resumeRevision(config, positionals[1] ?? '', signal, values['force-lease'] ?? false);
    }));
  }
  const supplied = values.config ? await readRecord(values.config) : undefined;
  if (command === 'setup') {
    const candidate: Record<string, unknown> = { ...config, ...supplied };
    return finish(await collectWarnings(async () => {
      warnIgnoredFields(candidate);
      captureConfig(candidate);
      const validated = validateConfig(candidate);
      warn('free-plan', FREE_PLAN);
      await prerequisites(validated, signal);
      await lease(join(home, 'installation.lock'), async () => {
        signal.throwIfAborted();
        await privateDir(validated.state);
        signal.throwIfAborted();
        await writeRecord(file, candidate);
      }, signal);
      return { status: 'configured', message: 'Configuration verified and preserved privately. Publish and resume need no setup confirmation.' };
    }));
  }
  console.error('Choose setup, publish, resume, source-digest or install. Run enois-preview --help.');
  return 1;
  } catch (error: unknown) {
    console.error(`${failure}: ${error instanceof PreviewError ? error.message : unexpected}`);
    return interruption.exitCode ?? 1;
  } finally { interruption.dispose(); }
}

if (await invokedDirectly(import.meta.url)) {
  process.exitCode = await main();
  // main has already awaited every cancelled command; a socket abandoned by a cancelled download must not keep an interrupted process alive.
  if (process.exitCode === 130 || process.exitCode === 143) process.exit();
}

#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { installed, captureConfig, validateConfig, prerequisites } from './config.js';
import type { Account } from './config.js';
import { commits, recover, sourceLease } from './capture.js';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PreviewError, readRecord, exists, string, privateDir, lease, writeRecord, listenForInterruption } from './state.js';

async function selectAccounts(listing:string,signal:AbortSignal):Promise<Account[]>{
  if(!process.stdin.isTTY)throw new PreviewError('Select stable account IDs with enois-preview publish SCENARIO in an interactive local terminal, or configure accounts.');
  const rows=new Map<string,string>();
  for(const line of listing.trim().split('\n')){const split=line.indexOf('\t');if(split<1)throw new PreviewError('No usable existing identities in the captured data; inspect private selection evidence.');rows.set(line.slice(0,split),line.slice(split+1));}
  console.error('Existing identities (private terminal only):');
  for(const [id,label]of rows)console.error(`${id}: ${label}`);
  const prompt=createInterface({input:process.stdin,output:process.stderr});
  prompt.on('SIGINT',()=>process.emit('SIGINT'));
  try{
    const answer=await prompt.question('Stable IDs to make available, separated by commas: ',{signal});
    return answer.split(',').map((value,index)=>{const id=value.trim();const label=rows.get(id);if(label===undefined)throw new PreviewError('Unknown account ID; retry with a listed identity.');return {id,email:`account${index+1}@enois.invalid`,label};});
  }finally{prompt.close();}
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const interruption = listenForInterruption();
  const signal = interruption.signal;
  try {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, home: { type: 'string' }, config: { type: 'string' }, 'refresh-data': { type: 'boolean' } } });
  if (values.help) {
    console.log(`enois-preview: Publish immutable, disposable Énóis PR previews.

Usage: enois-preview [--home PRIVATE_DIRECTORY] COMMAND

Commands:
  setup --config PRIVATE_JSON    Verify existing infrastructure and initial Free plans
  publish SCENARIO [--refresh-data]    Publish commits with frozen scenario data
  resume REVISION    Continue the recorded immutable revision`);
    return 0;
  }
  const command=positionals[0];
  if ((command==='setup' && (positionals.length!==1 || values['refresh-data'])) ||
      (command==='publish' && (positionals.length!==2 || values.config!==undefined)) ||
      (command==='resume' && (positionals.length!==2 || values.config!==undefined || values['refresh-data']))) {
    throw new PreviewError('Invalid command arguments. Run enois-preview --help.');
  }
  const home = values.home ?? process.env.ENOIS_PREVIEW_HOME ?? join(homedir(), '.config/enois-preview-ts');
  const file = join(home, 'config.json');
  const hasConfig = await access(file).then(() => true, () => false);
  const config = hasConfig ? await readRecord(file) : undefined;
  if (['publish', 'resume'].includes(positionals[0] ?? '') && config) {
    installed(config);
    const restoration = join(string(config.state), 'restoration.json');
    if (await exists(restoration)) {
      await readRecord(restoration);
      const parsed = captureConfig(config);
      await sourceLease(parsed, async () => {
        try { await recover(parsed); } finally { if(signal.aborted)console.error(await exists(restoration)?'Backend restoration pending; preserve its record and retry this command.':'Backend restored to its prior state.'); }
      }, signal);
      signal.throwIfAborted();
    }
    const { publishRevision, resumeRevision } = await import('./publication.js');
    signal.throwIfAborted();
    const report = positionals[0] === 'publish' ? await publishRevision(config, positionals[1] ?? '', values['refresh-data'] ?? false,selectAccounts,signal) : await resumeRevision(config, positionals[1] ?? '', signal);
    signal.throwIfAborted();
    console.log(JSON.stringify(report,null,2));
    return 0;
  }
  const supplied = values.config ? await readRecord(values.config) : undefined;
  if (positionals[0] === 'setup') {
    const candidate: Record<string, unknown> = { ...config, ...supplied, installation: config?.installation };
    try { installed(candidate); }
    catch (error: unknown) {
      if (!(error instanceof PreviewError)) throw error;
      if (!process.stdin.isTTY) throw error;
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      prompt.on('SIGINT',()=>process.emit('SIGINT'));
      try {
        console.error('Verify GitHub Free and Cloudflare Workers Free, with additional spending blocked.');
        if ((await prompt.question('Confirmed for the configured accounts? Type yes: ', { signal })).trim().toLowerCase() !== 'yes') throw new PreviewError('Installation verification declined; existing files preserved.');
        candidate.installation = { githubOwner: string(candidate.repository).split('/')[0], cloudflareAccountId: candidate.cloudflareAccountId, freePlansAndSpendingBlocksConfirmed: true, checkedAt: new Date().toISOString() };
      } finally { prompt.close(); }
    }
    const validated = validateConfig(candidate);
    await prerequisites(validated, signal);
    await lease(join(home, 'installation.lock'), async () => {
      signal.throwIfAborted();
      await privateDir(validated.state);
      signal.throwIfAborted();
      await writeRecord(file, candidate);
    }, signal);
    signal.throwIfAborted();
    console.log('Installation verified. Configuration preserved privately. Publish and resume require no financial renewal.');
    return 0;
  }
  console.error('Choose setup, publish or resume. Run enois-preview --help.');
  return 1;
  } catch (error: unknown) {
    console.error(`Publication incomplete: ${error instanceof PreviewError ? error.message : 'Invalid or unavailable private input. Run enois-preview --help.'}`);
    return interruption.exitCode ?? 1;
  } finally { interruption.dispose(); }
}

const invoked=process.argv[1];
if (invoked && await realpath(invoked).then(file=>import.meta.url===pathToFileURL(file).href,()=>false)) process.exitCode = await main();

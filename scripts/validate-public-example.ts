import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { credentials as credentialRecord } from '../src/contracts.js';
import { exercise,require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { ROOT } from '../preview/project.js';
import { Session,validate } from '../preview/validation.js';
import { PreviewError,privateDir,readRecord,run,writeRecord } from '../preview/state.js';

export async function check(directoryInput:string):Promise<void>{
  const directory=resolve(directoryInput),journal=journalRecord(await readRecord(join(directory,'journal.json')));
  require(/^(exemplo-|fictional-)/.test(journal.inputs.scenario),'This verifier requires a fictional scenario.');require(journal.inputs.dataManifest.accounts.every(account=>account.id.startsWith('example_')),'This verifier only modifies fictional identities.');
  const origin=journal.target.origin;require(origin,'Missing public origin.');const evidence=await privateDir(join(directory,'public-functional-evidence'));
  const basic=await validate(origin,journal,{evidence});const credentials=credentialRecord(await new Session(origin,{slug:journal.slug}).json('/__demo/access.json'));await writeRecord(join(evidence,'credentials.json'),credentials);
  const browser:unknown=JSON.parse((await run([process.execPath,join(ROOT,'dist/scripts/validate-example-browser.js')],{input:JSON.stringify({origin,slug:journal.slug,accounts:credentials.accounts,account:credentials.accounts[0],evidence}),logPath:join(evidence,'browser.log'),timeout:600})).toString());
  await writeRecord(join(evidence,'browser.json'),{devices:browser});
  const flows=await exercise({origin,slug:journal.slug,credentials,local:false,evidence});
  await writeRecord(join(evidence,'validation.json'),{origin,revision:journal.revision,publicWorker:true,basic,browser,flows});
  console.log('Public fictional example verified: entry accounts, actual browser login, desktop/mobile emulation, blog distribution/ownership and disposable media at the exact 20 MiB boundary.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const directory=process.argv[2];require(process.argv.length===3&&directory,'Usage: node dist/scripts/validate-public-example.js PRIVATE_OPERATION_DIRECTORY');await check(directory);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Public fictional verification failed; inspect private evidence.');process.exitCode=1;}}

import { join,resolve } from 'node:path';
import { credentials as credentialRecord } from '../src/contracts.js';
import { exercise,require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { Session,validate } from '../preview/validation.js';
import { PreviewError,privateDir,readRecord,writeRecord,invokedDirectly } from '../preview/state.js';

export async function check(directoryInput:string):Promise<void>{
  const directory=resolve(directoryInput),journal=journalRecord(await readRecord(join(directory,'journal.json')));
  require(/^(exemplo-|fictional-)/.test(journal.inputs.scenario),'This verifier requires a fictional scenario.');require(journal.inputs.dataManifest.accounts.every(account=>account.id.startsWith('example_')),'This verifier only modifies fictional identities.');
  const origin=journal.target.origin;require(origin,'Missing public origin.');const evidence=await privateDir(join(directory,'public-functional-evidence'));
  const basic=await validate(origin,journal,{evidence});const credentials=credentialRecord(await new Session(origin,{slug:journal.slug}).json('/__demo/access.json'));await writeRecord(join(evidence,'credentials.json'),credentials);
  const flows=await exercise({origin,slug:journal.slug,credentials,local:false,evidence});
  await writeRecord(join(evidence,'validation.json'),{origin,revision:journal.revision,publicWorker:true,basic,flows});
  console.log('Public fictional example verified: entry accounts, blog distribution/ownership and disposable media.');
}
if(await invokedDirectly(import.meta.url)){try{const directory=process.argv[2];require(process.argv.length===3&&directory,'Usage: node dist/scripts/validate-public-example.js PRIVATE_OPERATION_DIRECTORY');await check(directory);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Public fictional verification failed; inspect private evidence.');process.exitCode=1;}}

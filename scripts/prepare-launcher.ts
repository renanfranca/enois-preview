import { writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from '../preview/project.js';
import { canonical,exists,object,PreviewError,privateDir,writeRecord,invokedDirectly } from '../preview/state.js';

export async function prepare(destinationInput:string,repository:string,toolCommit:string,workerName:string):Promise<Record<string,unknown>>{
  const destination=resolve(destinationInput);
  if(await exists(destination))throw new PreviewError('Choose a new launcher destination; existing files are never replaced.');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw new PreviewError('Use owner/private-launcher for the repository.');
  if(!/^[a-f0-9]{40}$/.test(toolCommit))throw new PreviewError('Pin the full immutable public tool commit, never a branch or mutable tag.');
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName))throw new PreviewError('Use a valid existing Worker name.');
  const dependencies=object(object(JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'))).devDependencies);
  await privateDir(destination);
  const plain=async(name:string,value:unknown)=>writeFile(join(destination,name),canonical(value)+'\n',{mode:0o600});
  await plain('package.json',{name:'enois-private-preview-launcher',private:true,type:'module',engines:{node:'>=24 <25'},scripts:{build:'npm --prefix node_modules/enois-preview run build && npm rebuild --ignore-scripts enois-preview && tsc --noEmit',test:'npm --prefix node_modules/enois-preview test',check:'wrangler deploy --dry-run',deploy:'node node_modules/enois-preview/dist/scripts/check-release.js && wrangler deploy'},devDependencies:{...dependencies,'enois-preview':`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${toolCommit}`}});
  await writeFile(join(destination,'.nvmrc'),'24\n',{mode:0o600});
  await writeRecord(join(destination,'tool.lock.json'),{repository:'renanfranca/enois-preview',commit:toolCommit});await writeRecord(join(destination,'catalog/scenarios.json'),{scenarios:{}});
  await writeFile(join(destination,'launcher.ts'),"import catalog from './catalog/scenarios.json' with {type:'json'};\nimport { createWorker } from 'enois-preview/worker';\nexport { Scenario } from 'enois-preview/worker';\nexport default createWorker(catalog);\n",{mode:0o600});
  await writeFile(join(destination,'.gitignore'),'node_modules/\n.wrangler/\ndist/\n.dev.vars*\n.env*\n',{mode:0o600});
  await plain('tsconfig.json',{compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,resolveJsonModule:true,lib:['ES2023','WebWorker','WebWorker.Iterable'],types:[],skipLibCheck:true,noEmit:true},include:['launcher.ts']});
  await plain('wrangler.jsonc',{name:workerName,main:'launcher.ts',compatibility_date:'2026-10-01',workers_dev:true,observability:{enabled:false},vars:{LAUNCH_ENABLED:'false',GITHUB_REPOSITORY:repository,GITHUB_OWNER:repository.split('/')[0]},durable_objects:{bindings:[{name:'SCENARIOS',class_name:'Scenario'}]},migrations:[{tag:'v1',new_sqlite_classes:['Scenario']}]});
  return {directory:destination,publicToolCommit:toolCommit,launchEnabled:false,remoteWrites:false,next:'Install with npm ci --ignore-scripts after creating its lockfile, run npm run build explicitly, then configure existing private infrastructure with enois-preview setup.'};
}
if(await invokedDirectly(import.meta.url)){try{const {values,positionals}=parseArgs({allowPositionals:true,options:{repository:{type:'string'},'tool-commit':{type:'string'},'worker-name':{type:'string'}}});const destination=positionals[0];if(positionals.length!==1||!destination||!values.repository||!values['tool-commit']||!values['worker-name'])throw new PreviewError('Usage: node dist/scripts/prepare-launcher.js NEW_DIRECTORY --repository OWNER/REPO --tool-commit FULL_SHA --worker-name EXISTING_WORKER');console.log(JSON.stringify(await prepare(destination,values.repository,values['tool-commit'],values['worker-name']),null,2));}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Private consumer preparation failed; existing destinations preserved.');process.exitCode=1;}}

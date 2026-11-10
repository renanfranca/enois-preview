import { copyFile,lstat,readFile,realpath,rm,writeFile } from 'node:fs/promises';
import { dirname,isAbsolute,join,normalize,relative,resolve } from 'node:path';
import { ROOT } from '../preview/project.js';
import { canonical,exists,identity,inventory,PreviewError,privateDir,readRecord,writeRecord,invokedDirectly } from '../preview/state.js';

async function physical(path:string):Promise<string>{try{return await realpath(path);}catch(error:unknown){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')||dirname(path)===path)throw error;return join(await physical(dirname(path)),relative(dirname(path),path));}}
export async function exportPublic(destinationInput:string,sourceInput:string=ROOT):Promise<Record<string,unknown>>{
  const source=await realpath(resolve(sourceInput)),destination=resolve(destinationInput);const inside=relative(source,await physical(destination));
  if(await exists(destination)||inside===''||(!inside.startsWith('../')&&!isAbsolute(inside)))throw new PreviewError('Public export requires a new destination outside the source checkout.');
  const record=await readRecord(join(source,'release/public-files.json'));const files=record.files;
  if(!Array.isArray(files)||!files.length||files.some((path:unknown)=>typeof path!=='string')||new Set(files).size!==files.length)throw new PreviewError('Review the public source allowlist.');
  for(const item of files as string[]){
    if(!item||isAbsolute(item)||normalize(item)!==item||item.includes('\\')||item.split('/').some(part=>part==='..'||part.startsWith('.')&&part!=='.gitignore'&&item!=='.nvmrc')||['EXECPLAN.md','catalog/scenarios.json','wrangler.jsonc','VALIDATION.md'].includes(item))throw new PreviewError('Unsafe or reserved public source allowlist entry.');
    const file=join(source,item);if(!(await lstat(file)).isFile()||await realpath(file)!==file)throw new PreviewError('Missing or symlinked public source; review the allowlist before export.');
  }
  const validation=await readFile(join(source,'VALIDATION.md'),'utf8');const marker='## TypeScript migration evidence';const at=validation.indexOf(marker);
  if(at<0)throw new PreviewError('Current migration acceptance section missing; private historical evidence must not be exported.');
  await privateDir(destination);
  try{
    for(const file of files as string[]){const target=join(destination,file);await privateDir(dirname(target));await copyFile(join(source,file),target);}
    await writeRecord(join(destination,'catalog/scenarios.json'),{scenarios:{}});await writeRecord(join(destination,'release/channel.json'),{requiresPublicToolPin:true});
    await writeFile(join(destination,'wrangler.jsonc'),canonical({name:'enois-preview-development',main:'dist/src/entry.js',compatibility_date:'2026-10-01',workers_dev:true,observability:{enabled:false},vars:{LAUNCH_ENABLED:'false',GITHUB_REPOSITORY:'operator/private-launcher',GITHUB_OWNER:'operator'},durable_objects:{bindings:[{name:'SCENARIOS',class_name:'Scenario'}]},migrations:[{tag:'v1',new_sqlite_classes:['Scenario']}]})+'\n');
    await writeFile(join(destination,'VALIDATION.md'),'# TypeScript migration validation\n\n'+validation.slice(at).replaceAll(source,'PRIVATE_TOOL_WORKSPACE'));
    const proof=await inventory(destination);return {destination,files:Object.keys(proof).length,sourceInventorySha256:identity(proof),historyCopied:false,operationalCatalogEntries:0,published:false};
  }catch(error:unknown){await rm(destination,{recursive:true,force:true});throw error;}
}
if(await invokedDirectly(import.meta.url)){try{const destination=process.argv[2];if(process.argv.length!==3||!destination)throw new PreviewError('Usage: node dist/scripts/export-public.js NEW_PUBLIC_SOURCE_DIRECTORY');console.log(JSON.stringify(await exportPublic(destination),null,2));}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Public export failed; review source allowlist and private evidence boundary.');process.exitCode=1;}}

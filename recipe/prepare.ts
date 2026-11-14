import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { accounts } from '../preview/config.js';
import { invokedDirectly, object, PreviewError, readRecord, string } from '../preview/state.js';

export async function prepare(rootInput:string):Promise<void>{
  const root=resolve(rootInput);const recipe=join(root,'recipe');const backend=join(root,'sources/enois-backend');const frontend=join(root,'sources/enois-frontend');const java=join(backend,'src/main/java/com/socialcoisa/rede');
  async function replace(file:string,old:string,replacement:string):Promise<void>{
    let text:string;try{text=await readFile(file,'utf8');}catch{throw new PreviewError(`Demo recipe does not support the captured source contract: ${basename(file)}`);}
    if(!text.includes(old))throw new PreviewError(`Demo recipe does not support the captured source contract: ${basename(file)}`);
    await writeFile(file,text.replaceAll(old,()=>replacement));
  }
  const manifest=await readRecord(join(root,'runtime-manifest.json'));
  if(!Array.isArray(manifest.media))throw new PreviewError('Invalid runtime media manifest.');
  const mappings=manifest.media.map((entry:unknown)=>{const value=object(entry);const url=string(value.url);const directory=string(value.directory);const paths=Object.keys(object(value.inventory));if(!/^\/[a-zA-Z0-9._/-]+\/$/.test(url)||url.includes('//')||url.split('/').includes('..')||!/^\d+$/.test(directory)||paths.some(path=>path.startsWith('/')||path.split('/').includes('..')||/[\t\r\n]/.test(path)))throw new PreviewError('Unsafe runtime media mapping.');return {url,directory,paths};});
  await copyFile(join(recipe,'application-demo.properties'),join(backend,'src/main/resources/application-demo.properties'));
  for(const name of await readdir(join(recipe,'java')))if(name.endsWith('.java'))await copyFile(join(recipe,'java',name),join(java,'media/adapters/out/storage',name));
  for(const name of ['DevMediaStorageGateway.java','DevStorageUrlFactory.java'])await replace(join(java,'media/adapters/out/storage',name),'@Component\n','@Component\n@org.springframework.context.annotation.Profile("!demo")\n');
  const prefixes=[...mappings.map(mapping=>mapping.url),'/api/storage/'];
  await replace(join(frontend,'src/lib/api/media.ts'),'  const cleaned = url.replace(/%2F/g, "/");',`  const cleaned = url.replace(/%2F/g, "/");\n  if (${JSON.stringify(prefixes)}.some(prefix => cleaned.startsWith(prefix))) return cleaned;`);
  await replace(join(frontend,'src/lib/api/client-origin.ts'),'  return import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";','  return (typeof process !== "undefined" ? process.env.DEMO_PUBLIC_ORIGIN : undefined) ?? import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";');
  const selected=accounts((await readRecord(join(root,'data/seed/accounts.json'))).accounts);
  await writeFile(join(root,'data/seed/accounts.tsv'),selected.map(account=>`${account.id}\t${account.email}\t${Buffer.from(account.label).toString('base64')}\n`).join(''),{mode:0o600});
  const packagePath=join(frontend,'package.json');const packageInfo=object(JSON.parse(await readFile(packagePath,'utf8')));object(packageInfo.dependencies)['@rede-enois/design-system']='file:../design-system.tgz';await writeFile(packagePath,JSON.stringify(packageInfo,null,2)+'\n');
  await writeFile(join(root,'media-mappings.tsv'),mappings.flatMap(mapping=>mapping.paths.map(path=>`${mapping.url}${path}\t${mapping.directory}/${path}\n`)).join(''),{mode:0o600});
}
if(await invokedDirectly(import.meta.url)){
  try{if(!process.argv[2]||process.argv.length!==3)throw new PreviewError('Usage: node dist/recipe/prepare.js FROZEN_BUILD_CONTEXT');await prepare(process.argv[2]);}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Demo recipe input unavailable; inspect private build diagnostics.');process.exitCode=1;}
}

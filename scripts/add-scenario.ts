import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { accounts } from '../shared/accounts.js';
import { canonical,exists,object,PreviewError,privateDir,readRecord,requireFormat,string,writeRecord,invokedDirectly } from '../preview/state.js';

export async function addScenario(slug:string,image:string,publicOrigin:string,repository:string,provenanceFile:string):Promise<void>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image)||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw new PreviewError('Use a new slug, immutable registry digest and owner/repository.');
  const origin=new URL(publicOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new PreviewError('Use the HTTPS Worker origin.');
  const directory=`.devcontainer/${slug}`;
  if(await exists(directory))throw new PreviewError('Scenario already exists; choose a new slug.');
  object((await readRecord('catalog/scenarios.json')).scenarios);
  const proofBytes=await readFile(provenanceFile),proof:unknown=JSON.parse(proofBytes.toString('utf8'));requireFormat(proof);const revision=string(proof.revision);
  if(!/^[a-f0-9]{64}$/.test(revision)||proof.image!==image)throw new PreviewError('Provenance does not match this immutable image.');
  const selected=accounts(object(object(proof.inputs).dataManifest).accounts);
  const provenancePath=`catalog/provenance/${revision}.json`;
  if(await exists(provenancePath)&&!(await readFile(provenancePath)).equals(proofBytes))throw new PreviewError('Existing immutable provenance differs; preserve it.');
  await privateDir(directory);await privateDir('catalog/provenance');
  await writeFile(join(directory,'devcontainer.json'),canonical({name:`Énóis ${slug}`,image,overrideCommand:true,remoteUser:'demo',containerUser:'demo',hostRequirements:{cpus:2,memory:'4gb',storage:'16gb'},forwardPorts:[3000],portsAttributes:{'3000':{label:'Énóis preview',onAutoForward:'silent'}},postStartCommand:['node','/opt/render-demo/runtime/start.js','--daemon','--slug',slug,'--origin',origin.origin]})+'\n',{mode:0o600});
  await writeFile(provenancePath,proofBytes,{mode:0o600});
  await writeRecord(join(directory,'scenario.json'),{repository,image,devcontainerPath:`${directory}/devcontainer.json`,provenancePath,provenanceSha256:createHash('sha256').update(proofBytes).digest('hex'),revision,accounts:selected});
}
if(await invokedDirectly(import.meta.url)){try{const args=process.argv.slice(2);if(args.length!==5||args.some(value=>!value))throw new PreviewError('Usage: node dist/scripts/add-scenario.js SLUG IMAGE_DIGEST HTTPS_ORIGIN OWNER/REPO PROVENANCE_JSON');await addScenario(args[0]!,args[1]!,args[2]!,args[3]!,args[4]!);console.log('Versioned scenario prepared. Commit the configuration, then pin its immutable commit with dist/scripts/pin-scenario.js.');}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Scenario preparation failed; inspect private versioned provenance.');process.exitCode=1;}}

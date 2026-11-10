import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { catalogRecord,validateScenario } from '../src/catalog.js';
import { object,PreviewError,readRecord,run,string,writeRecord,invokedDirectly } from '../preview/state.js';

export async function pinScenario(slug:string,launcherCommit:string):Promise<void>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!/^[a-f0-9]{40}$/.test(launcherCommit))throw new PreviewError('Use a scenario slug and full immutable launcher commit.');
  const file='catalog/scenarios.json',catalog=await readRecord(file),scenarios=catalogRecord(catalog);
  if(Object.hasOwn(scenarios,slug))throw new PreviewError('Never replace a published scenario; choose a new slug.');
  const path=`.devcontainer/${slug}/scenario.json`,configuration=await readRecord(path);
  const item=validateScenario(slug,{...configuration,launcherCommit},string(configuration.repository));
  const proofPath=string(item.provenancePath);
  if(proofPath!==`catalog/provenance/${item.revision}.json`)throw new PreviewError('Unexpected immutable provenance path.');
  for(const path of [item.devcontainerPath,`.devcontainer/${slug}/scenario.json`,proofPath]){
    const committed=await run(['git','show',`${launcherCommit}:${path}`]);
    if(!committed.equals(await readFile(path)))throw new PreviewError('Working files differ from the committed configuration or provenance; preserve the pinned commit.');
  }
  if(createHash('sha256').update(await readFile(proofPath)).digest('hex')!==item.provenanceSha256)throw new PreviewError('Immutable provenance digest differs.');
  const dev=object(JSON.parse(await readFile(item.devcontainerPath,'utf8')));
  if(dev.image!==item.image||dev.overrideCommand!==true||!Array.isArray(dev.forwardPorts)||!dev.forwardPorts.includes(3000))throw new PreviewError('Immutable image configuration differs.');
  scenarios[slug]=item;await writeRecord(file,{...catalog,scenarios});
}
if(await invokedDirectly(import.meta.url)){try{const [slug,commit,...extra]=process.argv.slice(2);if(!slug||!commit||extra.length)throw new PreviewError('Usage: node dist/scripts/pin-scenario.js SLUG LAUNCHER_COMMIT_SHA');await pinScenario(slug,commit);console.log('Immutable TypeScript scenario pinned. Commit the catalog before deployment.');}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Scenario pinning failed; inspect the committed configuration and versioned catalog.');process.exitCode=1;}}

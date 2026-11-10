import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { credentials as credentialRecord } from '../src/contracts.js';
import { denied,png,require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { Session,validate } from '../preview/validation.js';
import { object,PreviewError,privateDir,readRecord,string,writeRecord,invokedDirectly } from '../preview/state.js';

export async function check(directoryInput:string):Promise<void>{
  const directory=resolve(directoryInput),journal=journalRecord(await readRecord(join(directory,'journal.json')));
  require(journal.inputs.dataManifest.accounts.every(account=>account.id.startsWith('example_'))&&/^(exemplo-|fictional-)/.test(journal.inputs.scenario),'Public lifecycle checks require fictional identities and scenario.');
  const origin=journal.target.origin;require(origin,'Missing public origin.');const slug=journal.slug,session=new Session(origin,{slug});
  const credentials=credentialRecord(await session.json('/__demo/access.json'));require(credentials.accounts.every(account=>account.id.startsWith('example_')),'Fictional runtime identities required.');
  const flow=object((await readRecord(join(directory,'public-functional-evidence/validation.json'))).flows),media=object(flow.media);
  const evidence=await privateDir(join(directory,'public-lifecycle-evidence'));await writeRecord(join(evidence,'previous-credentials.json'),credentials);
  const account=credentials.accounts[0];require(account,'Selected author missing.');const author=new Session(origin,{slug});await author.json('/api/auth/login',{body:{email:account.email,password:account.password}});
  const raw=png(),asset=object(await author.json('/api/media/uploads',{body:{fileName:'before-recreation.png',mimeType:'image/png',size:raw.length,purpose:'POST_IMAGE'}}));const oldUrl=string(asset.cdnUrl);
  const uploaded=await author.request(string(asset.uploadUrl),{method:'PUT',raw,contentType:'image/png'});await uploaded.body?.cancel();
  require(object(await author.json(`/api/feed/posts/${string(media.post)}`)).id===media.post,'Runtime post did not exist before lifecycle reset.');const old=await author.request(oldUrl);require(old.status===200,'Runtime upload did not exist before lifecycle reset.');await old.body?.cancel();await denied(()=>author.request('/example.local/post-1.svg'),404);
  const samples:{elapsedSeconds:number;status:number}[]=[],start=performance.now(),startedAt=new Date().toISOString();
  for(;;){
    let status:number;try{const response=await session.request(`/__demo/status/${slug}`);status=response.status;await response.body?.cancel();}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 410\b/.test(error.message),'Inactivity polling failed for an unexpected reason.');status=410;}
    samples.push({elapsedSeconds:Math.round((performance.now()-start))/1000,status});
    await writeRecord(join(evidence,'inactivity-observation.json'),{pollingOnly:true,recognizedActivitySent:false,startedAt,samples,complete:status===410});
    if(status===410)break;require(performance.now()-start<750000,'Public inactivity deletion was not observed; no recreation requested.');await delay(20000);
  }
  const basic=await validate(origin,journal,{evidence});const current=credentialRecord(await new Session(origin,{slug}).json('/__demo/access.json'));await writeRecord(join(evidence,'current-credentials.json'),current);
  require(current.accounts.length===credentials.accounts.length,'Recreation changed the selected account count.');
  for(const [index,previous]of credentials.accounts.entries()){
    const account=current.accounts[index];require(account&&previous.id===account.id&&previous.password!==account.password,'Recreation did not rotate every selected credential.');
    await denied(()=>new Session(origin,{slug}).json('/api/auth/login',{body:{email:previous.email,password:previous.password}}),401);
  }
  const fresh=new Session(origin,{slug}),selected=current.accounts[0];require(selected,'Recreated author missing.');await fresh.json('/api/auth/login',{body:{email:selected.email,password:selected.password}});
  await denied(()=>fresh.json(`/api/feed/posts/${string(media.post)}`),404);await denied(()=>fresh.request(oldUrl),404);
  const restored=await fresh.request('/example.local/post-1.svg');require(restored.status===200,'Seed media was not restored.');await restored.body?.cancel();
  const next=object(await fresh.json('/api/media/uploads',{body:{fileName:'recreated.png',mimeType:'image/png',size:raw.length,purpose:'POST_IMAGE'}}));
  const sent=await fresh.request(string(next.uploadUrl),{method:'PUT',raw,contentType:'image/png'});await sent.body?.cancel();require(next.cdnUrl!==oldUrl,'Upload namespace reused an old URL.');await denied(()=>fresh.request(oldUrl),404);
  await writeRecord(join(evidence,'validation.json'),{publicWorker:true,revision:journal.revision,pollingDidNotPreventDeletion:true,observedExpiredBeforeRecreation:true,automaticRecreationValidated:basic,allPasswordsRotated:true,oldPasswordsRejected401:true,runtimePostDiscarded404:true,runtimeUploadDiscarded404:true,seedMediaRestored:true,oldUrlStill404AfterNewUpload:true,samples});
  console.log('Public inactivity and recreation verified: polling allowed deletion, automatic boot restored frozen data/media and rotated credentials, and old upload URLs remain 404.');
}
if(await invokedDirectly(import.meta.url)){try{const directory=process.argv[2];require(process.argv.length===3&&directory,'Usage: node dist/scripts/validate-public-lifecycle.js PRIVATE_OPERATION_DIRECTORY');await check(directory);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Public lifecycle verification failed; inspect private evidence.');process.exitCode=1;}}

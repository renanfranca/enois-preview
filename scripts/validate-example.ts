import { chmod,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { credentials as credentialRecord } from '../src/contracts.js';
import { validateLocal } from '../preview/build.js';
import { denied, exercise, png, require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { ROOT } from '../preview/project.js';
import { Session, validate } from '../preview/validation.js';
import { object, PreviewError, readRecord, run, string, writeRecord, invokedDirectly } from '../preview/state.js';

export async function check(image:string,directoryInput:string):Promise<void>{
  const directory=resolve(directoryInput),journal=journalRecord(await readRecord(join(directory,'journal.json')));
  const resetChecks=async(origin:string,value:unknown,evidence:string):Promise<Record<string,unknown>>=>{
    const current=credentialRecord(value),old=credentialRecord(await readRecord(join(evidence,'first-boot-credentials.json')));
    require(old.accounts.length===current.accounts.length,'Recreation changed the selected accounts.');
    for(const [index,previous]of old.accounts.entries()){
      const account=current.accounts[index];require(account&&previous.id===account.id&&previous.password!==account.password,'Boot did not rotate every selected credential.');
      await denied(()=>new Session(origin,{local:true}).json('/api/auth/login',{body:{email:previous.email,password:previous.password}}),401);
    }
    const flow=await readRecord(join(evidence,'example-flows.json'));const media=object(flow.media);const account=current.accounts[0];require(account,'Selected author missing.');
    const author=new Session(origin,{local:true});await author.json('/api/auth/login',{body:{email:account.email,password:account.password}});
    const feed=object(await author.json('/api/feed?tab=ALL&limit=20'));require(Array.isArray(feed.items),'Reset feed missing.');
    const ids=feed.items.map((item:unknown)=>string(object(item).id));require(ids.filter(id=>id.startsWith('example_post_')).length===8,'Seed posts were not restored.');
    require(!ids.includes(string(media.post)),'Runtime post survived boot.');await denied(()=>author.json(`/api/feed/posts/${string(media.post)}`),404);
    const oldUrl=string(media.boundaryUploadUrl);await denied(()=>author.request(oldUrl),404);
    const raw=png();const allocated=object(await author.json('/api/media/uploads',{body:{fileName:'new.png',mimeType:'image/png',size:raw.length,purpose:'POST_IMAGE'}}));
    const uploaded=await author.request(string(allocated.uploadUrl),{method:'PUT',raw,contentType:'image/png'});await uploaded.body?.cancel();
    require(allocated.cdnUrl!==oldUrl,'New boot reused the previous upload namespace.');await denied(()=>author.request(oldUrl),404);
    const seed=await author.request('/example.local/post-1.svg');require(seed.status===200,'Deleted seed media was not restored.');await seed.body?.cancel();
    return {allPasswordsRotated:true,oldPasswordsRejected401:true,seedPostsRestored:true,runtimePostDiscarded:true,seedMediaRestored:true,oldUploadUrlStill404AfterNewUpload:true};
  };
  const first=await validateLocal(image,journal,directory,async(origin,value,evidence,container)=>{
    const credentials=credentialRecord(value);const devices:unknown=JSON.parse((await run([process.execPath,join(ROOT,'dist/scripts/validate-example-browser.js')],{input:JSON.stringify({origin,accounts:credentials.accounts,account:credentials.accounts[0],evidence}),logPath:join(evidence,'example-browser.log'),timeout:300})).toString());
    await writeRecord(join(evidence,'example-browser.json'),{localOnly:true,devices});
    const flows=await exercise({origin,credentials,local:true,evidence});await writeRecord(join(evidence,'example-flows.json'),flows);
    await writeRecord(join(evidence,'first-boot-credentials.json'),credentials);
    const orphan=join(evidence,'orphan.partial');await writeFile(orphan,'controlled orphan',{mode:0o600});
    await run(['docker','cp',orphan,`${container}:/tmp/demo-uploads/.processing/orphan.partial`]);
    await run(['docker','restart',container],{timeout:120});
    const file=join(evidence,'restart-credentials.json');const deadline=Date.now()+180000;let current:ReturnType<typeof credentialRecord>|undefined;
    do{
      try{await run(['docker','cp',`${container}:/tmp/demo-credentials.json`,file]);await chmod(file,0o600);const candidate=credentialRecord(await readRecord(file));if(candidate.accounts.length===credentials.accounts.length&&candidate.accounts.every((account,index)=>account.password!==credentials.accounts[index]?.password)){current=candidate;break;}}catch{}
      await delay(200);
    }while(Date.now()<deadline);
    require(current,'Runtime restart did not rotate all selected credentials.');
    await validate(origin,journal,{credentials:current,local:true,evidence});const restarted=await resetChecks(origin,current,evidence);
    await run(['docker','exec',container,'test','!','-e','/tmp/demo-uploads/.processing/orphan.partial']);restarted.orphanedProcessingFileRemoved=true;
    await writeRecord(join(evidence,'runtime-restart-validation.json'),restarted);
    return {localOnly:true,devices,flows,runtimeRestart:restarted};
  });
  await writeRecord(join(directory,'first-boot-validation.json'),first);
  const second=await validateLocal(image,journal,directory,resetChecks);await writeRecord(join(directory,'recreation-validation.json'),second);
  console.log('Local fictional runtime verified: actual browser, independent accounts, blog and media, restart and recreation with rotated credentials.');
}
if(await invokedDirectly(import.meta.url)){try{const image=process.argv[2],directory=process.argv[3];require(process.argv.length===4&&image&&directory,'Usage: node dist/scripts/validate-example.js IMAGE PRIVATE_OPERATION_DIRECTORY');await check(image,directory);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Local fictional runtime verification failed; inspect private evidence.');process.exitCode=1;}}

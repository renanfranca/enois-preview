import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { credentials as credentialRecord } from '../src/contracts.js';
import { validateLocal } from '../preview/build.js';
import { denied,require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { Session } from '../preview/validation.js';
import { exists,object,PreviewError,privateDir,readRecord,string,writeRecord } from '../preview/state.js';

interface Asset {id:string;uploadUrl:string;cdnUrl:string}
interface Stored {id:string;url:string;inputBytes:number;storedBytes:number;physicalByteRangeBoundaryVerified:true}
function wav(count:number):Buffer{
  require(Number.isSafeInteger(count)&&count>=78&&count%2===0,'WAV size requires complete PCM frames.');const bytes=Buffer.alloc(count);
  bytes.write('RIFF',0);bytes.writeUInt32LE(count-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('LIST',36);bytes.writeUInt32LE(26,40);bytes.write('INFOISFT',44);bytes.writeUInt32LE(14,52);bytes.write('fictionaltest\0',56);bytes.write('data',70);bytes.writeUInt32LE(count-78,74);return bytes;
}
export async function exerciseCapacity(origin:string,value:unknown,evidence:string,local=true,slug?:string):Promise<Record<string,unknown>>{
  const credentials=credentialRecord(value);require(credentials.accounts.every(account=>account.id.startsWith('example_')),'Capacity checks require fictional identities.');
  const first=credentials.accounts[0],second=credentials.accounts[1];require(first&&second,'Select fictional author and reader accounts.');
  const options={local,timeout:120,...(slug?{slug}:{})};const author=new Session(origin,options),reader=new Session(origin,options);
  for(const [session,account]of [[author,first],[reader,second]] as const)await session.json('/api/auth/login',{body:{email:account.email,password:account.password}});
  const requests=new Map<string,Record<string,unknown>>();let writes=Promise.resolve();
  const phase=(asset:Asset,phase:string,details:Record<string,unknown>={})=>{
    const previous=requests.get(asset.id)??{id:asset.id,url:asset.cdnUrl};requests.set(asset.id,{...previous,phase,...details});
    const snapshot=[...requests.values()].map(item=>({...item}));const next=writes.then(()=>writeRecord(join(evidence,'capacity-uploads.json'),{localOnly:local,uploads:snapshot}));writes=next.catch(()=>{});return next;
  };
  const allocate=async(session:Session,count:number):Promise<{asset:Asset;raw:Buffer}>=>{
    const raw=wav(count);const item=object(await session.json('/api/media/uploads',{body:{fileName:'capacity.wav',mimeType:'audio/wav',size:raw.length,purpose:'POST_AUDIO'}}));
    const asset={id:string(item.id),uploadUrl:string(item.uploadUrl),cdnUrl:string(item.cdnUrl)};require(new URL(asset.uploadUrl,origin).origin===origin,'Upload escaped the configured origin.');await phase(asset,'allocated',{inputBytes:raw.length});return {asset,raw};
  };
  const upload=async(session:Session,asset:Asset,raw:Buffer,expected:number):Promise<Stored>=>{
    await phase(asset,'sending');const sent=await session.request(asset.uploadUrl,{method:'PUT',raw,contentType:'audio/wav'});await sent.body?.cancel();await phase(asset,'reading-container');
    const response=await session.request(asset.cdnUrl,{range:'bytes=0-77'});const stored=Buffer.from(await response.arrayBuffer());const range=response.headers.get('Content-Range');
    require(response.status===206&&response.headers.get('Content-Type')?.startsWith('audio/wav')&&stored.length===78&&stored.readUInt32LE(4)+8===expected&&range===`bytes 0-77/${expected}`,'Stored WAV physical Content-Range or RIFF size differs.');
    require(stored.toString('ascii',0,4)==='RIFF'&&stored.toString('ascii',8,16)==='WAVEfmt '&&stored.readUInt16LE(20)===1&&stored.readUInt16LE(22)===1&&stored.readUInt16LE(34)===16&&stored.toString('ascii',70,74)==='data'&&stored.readUInt32LE(74)===expected-78,'Stored WAV is not the expected decodable PCM.');
    await phase(asset,'reading-last-byte');const end=await session.request(asset.cdnUrl,{range:`bytes=${expected-1}-${expected-1}`});require(end.status===206&&(await end.arrayBuffer()).byteLength===1,'Stored WAV final physical byte is missing.');
    await phase(asset,'verified',{physicalContentRange:range});return {id:asset.id,url:asset.cdnUrl,inputBytes:raw.length,storedBytes:expected,physicalByteRangeBoundaryVerified:true};
  };
  const remove=async(asset:{id:string;url:string})=>{
    await author.json(`/api/media/${asset.id}`,{method:'DELETE'});const deadline=Date.now()+30000;
    for(;;){try{const response=await author.request(asset.url,{range:'bytes=0-0'});await response.body?.cancel();}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 404\b/.test(error.message),'Unexpected physical deletion response.');return;}require(Date.now()<deadline,'Physical deletion did not complete.');await delay(100);}
  };
  const occupied:Stored[]=[];
  for(const count of [...Array<number>(12).fill(20971520),14680064]){const {asset,raw}=await allocate(author,count);occupied.push(await upload(author,asset,raw,count));await writeRecord(join(evidence,'capacity-progress.json'),{verifiedStoredBytes:occupied.reduce((sum,item)=>sum+item.storedBytes,0),verifiedFiles:occupied.length,localOnly:local});}
  require(occupied.reduce((sum,item)=>sum+item.storedBytes,0)===266338304,'Fixture did not leave exactly 2 MiB free.');
  let failureRecovery:Record<string,unknown>|undefined;
  if(local){
    const pending=await allocate(author,2097152);const target=new URL(pending.asset.uploadUrl,origin);
    const headers={'Content-Length':String(pending.raw.length),'Content-Type':'audio/wav',Origin:origin,'X-Client-Origin':origin,'X-CSRF-Protection':'1','Idempotency-Key':randomUUID(),Cookie:await author.cookies.getCookieString(origin)};
    const connection=http.request(target,{method:'PUT',headers,timeout:10000});connection.on('error',()=>{});connection.on('response',response=>response.resume());connection.on('timeout',()=>connection.destroy());
    try{
      connection.write(pending.raw.subarray(0,-1));await phase(pending.asset,'partial-body-held-open');await delay(1000);
      const competitor=await allocate(reader,2097152);await denied(()=>reader.request(competitor.asset.uploadUrl,{method:'PUT',raw:competitor.raw,contentType:'audio/wav'}),507);
    }finally{connection.destroy();}
    const cancelled=await allocate(author,2097152);const deadline=Date.now()+10000;let restoredCancel:Stored|undefined;
    for(;;){try{restoredCancel=await upload(author,cancelled.asset,cancelled.raw,2097152);break;}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 507\b/.test(error.message)&&Date.now()<deadline,'Interrupted upload did not release its reservation.');await delay(100);}}
    await denied(()=>author.request(pending.asset.cdnUrl),404);await remove(restoredCancel);
    const malformed=await allocate(author,2097152);await denied(()=>author.request(malformed.asset.uploadUrl,{method:'PUT',raw:Buffer.alloc(malformed.raw.length),contentType:'audio/wav'}),422);await denied(()=>author.request(malformed.asset.cdnUrl),404);
    const processed=await allocate(author,2097152);const restoredProcessing=await upload(author,processed.asset,processed.raw,2097152);await remove(restoredProcessing);
    failureRecovery={localActualHttp:true,partialBodyHeldReservationWithCompeting507:true,cancelledUploadUnreadable404:true,afterCancellationSuccessfulUpload:restoredCancel,sanitizationFailed422AndUnreadable404:true,afterProcessingFailureSuccessfulUpload:restoredProcessing};
    await writeRecord(join(evidence,'capacity-failure-recovery.json'),failureRecovery);
  }
  const attempts=[];for(const session of [author,reader])attempts.push({session,...await allocate(session,2097152)});
  const race=await Promise.all(attempts.map(async({session,asset,raw})=>{
    try{return {status:200,...await upload(session,asset,raw,2097152)};}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 507\b/.test(error.message),'Upload race failed for a condition other than capacity.');await denied(()=>session.request(asset.cdnUrl),404);return {status:507,id:asset.id};}
  }));
  require(JSON.stringify(race.map(item=>item.status).sort())==='[200,507]','Exactly one simultaneous valid upload must fit.');
  const firstStored=occupied[0];require(firstStored,'Occupied file is missing.');await remove(firstStored);
  const replacement=await allocate(author,20971520);const restored=await upload(author,replacement.asset,replacement.raw,20971520);
  const proof:Record<string,unknown>={localOnly:local,publicWorker:!local,validWavFiles:true,beforeRaceBytes:266338304,freeBeforeRaceBytes:2097152,race,physicalDeletionRestoredCapacityBySuccessfulUpload:restored,...(failureRecovery?{failureRecovery}:{})};
  await writeRecord(join(evidence,'capacity-validation.json'),proof);
  for(const item of occupied.slice(1))await author.json(`/api/media/${item.id}`,{method:'DELETE'});
  for(const [index,result]of race.entries())if(result.status===200){const attempt=attempts[index];require(attempt,'Race result has no owner.');await attempt.session.json(`/api/media/${result.id}`,{method:'DELETE'});}
  await author.json(`/api/media/${restored.id}`,{method:'DELETE'});proof.exerciseAssetDeletionRequestsCompleted=true;await writeRecord(join(evidence,'capacity-validation.json'),proof);return proof;
}
export async function check(image:string,directoryInput:string):Promise<void>{
  const directory=resolve(directoryInput),journal=journalRecord(await readRecord(join(directory,'journal.json')));
  if(image==='--public'){
    const origin=journal.target.origin,slug=journal.slug;require(origin,'Missing public origin.');const evidence=await privateDir(join(directory,'public-capacity-evidence'));const session=new Session(origin,{slug});
    require(object(await session.json('/__demo/revision')).revision===journal.revision&&object(await session.json('/__demo/runtime')).revision===journal.revision,'Public capacity revision mismatch.');require(object(await session.json('/api/actuator/health/readiness')).status==='UP','Public runtime is not healthy.');
    const credentials=credentialRecord(await session.json('/__demo/access.json'));const file=join(directory,'public-functional-evidence/validation.json');
    if(await exists(file)){
      const flow=object((await readRecord(file)).flows),old=string(object(flow.media).boundaryUploadUrl);const id=/\/(media_[A-Za-z0-9_-]+)\//.exec(old)?.[1];const account=credentials.accounts[0];require(id&&account,'Known acceptance boundary asset is malformed.');
      await session.json('/api/auth/login',{body:{email:account.email,password:account.password}});await session.json(`/api/media/${id}`,{method:'DELETE'});const deadline=Date.now()+30000;
      for(;;){try{const response=await session.request(old);await response.body?.cancel();}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 404\b/.test(error.message),'Unexpected known upload cleanup response.');break;}require(Date.now()<deadline,'Known acceptance upload deletion did not finish.');await delay(250);}
    }
    await exerciseCapacity(origin,credentials,evidence,false,slug);console.log('Public HTTP capacity verified: one of two 2 MiB files fits, and physical deletion permits another 20 MiB.');
  }else{
    await validateLocal(image,journal,await privateDir(join(directory,'capacity-evidence')),(origin,credentials,evidence)=>exerciseCapacity(origin,credentials,evidence));console.log('Local actual HTTP capacity verified, including cancellation, processing failure, concurrent uploads and physical deletion.');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const image=process.argv[2],directory=process.argv[3];require(process.argv.length===4&&image&&directory,'Usage: node dist/scripts/validate-capacity.js IMAGE_OR_--public PRIVATE_OPERATION_DIRECTORY');await check(image,directory);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Capacity verification failed; inspect private evidence.');process.exitCode=1;}}

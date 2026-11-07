import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { credentials as credentialRecord } from '../src/contracts.js';
import { Session } from './validation.js';
import { object, PreviewError, string, writeRecord } from './state.js';

export function require(condition:unknown,message:string):asserts condition{if(!condition)throw new PreviewError(message);}
export async function denied(action:()=>Promise<unknown>,status:number):Promise<void>{
  try{const result=await action();if(result instanceof Response)await result.body?.cancel();}
  catch(error:unknown){const observed=error instanceof PreviewError?/HTTP \d{3}\b/.exec(error.message)?.[0]:undefined;require(observed===`HTTP ${status}`,`Expected HTTP ${status}; observed ${observed??'a transport failure without HTTP status'}.`);return;}
  throw new PreviewError(`Expected HTTP ${status}, but operation succeeded.`);
}
export function png(size?:number):Buffer {
  const chunk=(kind:string,bytes:Buffer):Buffer=>{
    const type=Buffer.from(kind);const raw=Buffer.concat([type,bytes]);let crc=0xffffffff;
    for(const value of raw){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const header=Buffer.alloc(4),checksum=Buffer.alloc(4);header.writeUInt32BE(bytes.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([header,raw,checksum]);
  };
  const dimensions=Buffer.alloc(13);dimensions.writeUInt32BE(16,0);dimensions.writeUInt32BE(16,4);dimensions[8]=8;dimensions[9]=2;
  const header=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',dimensions)]);
  const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(48).fill(Buffer.from([0x44,0x88,0x77]))]);
  let pixels=chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:16},()=>row))));const end=chunk('IEND',Buffer.alloc(0));
  if(size!==undefined){const count=size-header.length-pixels.length-end.length-12;require(Number.isSafeInteger(size)&&count>=8,'Boundary PNG size is too small.');pixels=Buffer.concat([chunk('tEXt',Buffer.concat([Buffer.from('Comment\0'),Buffer.alloc(count-8,120)])),pixels]);}
  const result=Buffer.concat([header,pixels,end]);if(size!==undefined)require(result.length===size,'Boundary fixture byte count differs.');return result;
}

export async function exercise(value:unknown):Promise<Record<string,unknown>>{
  const settings=object(value);const origin=string(settings.origin);const local=settings.local===true;const slug=settings.slug===undefined?undefined:string(settings.slug);
  const credentials=credentialRecord(settings.credentials);const accounts=credentials.accounts;
  require(accounts.every(account=>account.id.startsWith('example_')),'This exercise requires fictional example identities.');
  const first=accounts[0],second=accounts[1];require(first&&second,'Select distinct fictional author and reader accounts.');
  const options={local,...(slug?{slug}:{})};const observer=new Session(origin,options);const runtime=object(await observer.json('/__demo/runtime'));
  require(typeof runtime.revision==='string'&&/^[a-f0-9]{64}$/.test(runtime.revision),'A demo runtime identity is required before functional writes.');
  const fixture=randomUUID().replaceAll('-','');const author=new Session(origin,options),reader=new Session(origin,options);
  for(const [session,account]of [[author,first],[reader,second]] as const)await session.json('/api/auth/login',{body:{email:account.email,password:account.password}});
  const saved=object(await author.json('/api/blogs/me',{method:'PUT',body:{title:'Oficina de ideias',description:'Blog fictício de teste',themeHtml:''}}));const blog=string(saved.slug);
  await reader.json(`/api/blogs/${blog}/subscription`,{method:'POST',body:{}});
  const article=string(object(await author.json('/api/blogs/me/posts',{body:{title:`Uma ideia compartilhada ${fixture.slice(0,8)}`,body:`Aprender e criar em comunidade. Ensaio fictício ${fixture}.`,format:'MARKDOWN'}})).id);
  const ids=async(tab:string):Promise<string[]>=>{const feed=object(await reader.json(`/api/feed?tab=${tab}&limit=20`));require(Array.isArray(feed.items),'Feed items are missing.');return feed.items.map((item:unknown)=>string(object(item).id));};
  require((await ids('FOR_YOU')).includes(article),'Subscriber did not receive the published article.');require(!(await ids('ALL')).includes(article),'Blog article appeared in ALL.');
  require(JSON.stringify(await reader.json('/api/notifications')).includes('NEW_BLOG_POST'),'Internal blog notification missing.');
  await denied(()=>reader.json(`/api/blogs/me/posts/${article}`,{method:'PATCH',body:{title:'Forbidden',body:'Forbidden',format:'MARKDOWN'}}),403);
  await denied(()=>reader.json(`/api/blogs/me/posts/${article}`,{method:'DELETE'}),403);
  await reader.json(`/api/blogs/${blog}/subscription`,{method:'DELETE'});require(!(await ids('FOR_YOU')).includes(article),'Unsubscribe did not remove the article from personalized feed.');
  await denied(()=>author.json('/api/auth/signup',{body:{}}),403);
  const blockedIntegrations=['/api/admin/support/github','/api/admin/support/fictional/reply','/api/identity/verification','/api/me/github/sync','/api/admin/github/pulls/review','/api/admin/contributors/sync','/api/admin/contributors/repositories','/api/me/integrations/linkedin','/api/webhooks/fictional'];
  for(const path of blockedIntegrations)await denied(()=>author.json(path,{body:{}}),403);
  const permissions=object(await author.json('/api/moderation/me'));
  const blogProof={id:article,positivePersonalizedFeed:true,absentFromAll:true,notification:true,ownership:true,unsubscribe:true};
  const evidence=settings.evidence===undefined?undefined:string(settings.evidence);
  if(evidence)await writeRecord(join(evidence,'blog-validation.json'),{origin,publicWorker:!local,...blogProof});
  const allocate=async(raw:Buffer,mime='image/png')=>{const asset=object(await author.json('/api/media/uploads',{body:{fileName:'example.png',mimeType:mime,size:raw.length,purpose:'POST_IMAGE'}}));return {id:string(asset.id),uploadUrl:string(asset.uploadUrl),cdnUrl:string(asset.cdnUrl)};};
  const upload=await allocate(png());const raw=png();
  await denied(()=>reader.request(upload.uploadUrl,{method:'PUT',raw,contentType:'image/png'}),403);await denied(()=>reader.json(`/api/media/${upload.id}`,{method:'DELETE'}),403);
  const uploaded=await author.request(upload.uploadUrl,{method:'PUT',raw,contentType:'image/png'});await uploaded.body?.cancel();
  const read=await author.request(upload.cdnUrl);const stored=Buffer.from(await read.arrayBuffer());require(read.status===200&&read.headers.get('Content-Type')?.startsWith('image/png')&&stored.subarray(0,4).equals(Buffer.from([137,80,78,71])),'Public disposable media read failed.');
  const post=string(object(await author.json('/api/feed/posts',{body:{type:'INSIGHT',content:`Uma imagem para compartilhar. Ensaio fictício ${fixture}.`,topic:'TECNOLOGIA',mediaIds:[upload.id]}})).id);
  const published=object(await author.json(`/api/feed/posts/${post}`));require(published.id===post&&JSON.stringify(published).includes(upload.id),'Uploaded media was not attached to a persisted post.');
  const waitDeleted=async(path:string)=>{const deadline=Date.now()+20000;for(;;){try{const response=await author.request(path);await response.body?.cancel();}catch(error:unknown){require(error instanceof PreviewError&&/HTTP 404\b/.test(error.message),'Unexpected media deletion response.');return;}require(Date.now()<deadline,'Physical media deletion was not observed.');await delay(250);}};
  await author.json(`/api/media/${upload.id}`,{method:'DELETE'});await waitDeleted(upload.cdnUrl);
  const invalid=await allocate(Buffer.from('not-an-image'));await denied(()=>author.request(invalid.uploadUrl,{method:'PUT',raw:Buffer.from('not-an-image'),contentType:'image/png'}),422);await denied(()=>author.request(invalid.cdnUrl),404);
  if(evidence)await writeRecord(join(evidence,'basic-upload-validation.json'),{origin,publicWorker:!local,post,ownerUploadReadAttachDelete:true,foreignWriteDeleteRejected:true,malformedRejected:true});
  const big=png(20971520),boundary=await allocate(big);const sent=await author.request(boundary.uploadUrl,{method:'PUT',raw:big,contentType:'image/png'});await sent.body?.cancel();
  const boundaryRead=await author.request(boundary.cdnUrl);const boundaryBytes=Buffer.from(await boundaryRead.arrayBuffer());require(boundaryRead.status===200&&boundaryBytes.equals(png()),'Exact 20 MiB file did not retain valid pixels and remove text metadata.');
  await denied(()=>author.json('/api/media/uploads',{body:{fileName:'large.png',mimeType:'image/png',size:20971521,purpose:'POST_IMAGE'}}),400);
  await author.json('/api/media/example_media_1',{method:'DELETE'});await waitDeleted('/example.local/post-1.svg');
  return {origin,localOnly:local,blog:blogProof,media:{newUploadUrl:upload.cdnUrl,post,ownerUploadReadAttachDelete:true,foreignWriteDeleteRejected:true,malformedRejected:true,boundaryUploadUrl:boundary.cdnUrl,boundaryInputBytes:big.length,boundaryStoredBytes:boundaryBytes.length,exact20MiBAccepted:true,oneByteLargerRejected:true,seedDeletionObserved:true},signupBlocked:true,externalIntegrationEndpoints:{actorAdmin:permissions.admin===true,refused403:blockedIntegrations}};
}

import { readFileSync } from 'node:fs';
import { chmod,readFile,writeFile } from 'node:fs/promises';
import { basename,join,resolve } from 'node:path';
import { credentials as credentialRecord } from '../src/contracts.js';
import { denied,png,require } from '../preview/exercises.js';
import { journalRecord } from '../preview/publication.js';
import { Session } from '../preview/validation.js';
import { object,PreviewError,privateDir,readRecord,run,string,writeRecord,invokedDirectly } from '../preview/state.js';

function pdf():Buffer{
  const objects=['<</Type /Catalog /Pages 2 0 R>>','<</Type /Pages /Kids [3 0 R] /Count 1>>','<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]>>','<</Author (private-metadata-marker)>>'];let raw='%PDF-1.4\n';const offsets:number[]=[];
  for(const [index,value]of objects.entries()){offsets.push(Buffer.byteLength(raw));raw+=`${index+1} 0 obj\n${value}\nendobj\n`;}
  const start=Buffer.byteLength(raw);raw+='xref\n0 5\n0000000000 65535 f \n';for(const offset of offsets)raw+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  return Buffer.from(raw+`trailer\n<</Size 5 /Root 1 0 R /Info 4 0 R>>\nstartxref\n${start}\n%%EOF\n`);
}
export async function fixtures(image:string,root:string):Promise<void>{
  const ffmpeg=async(name:string,source:string,extra:string[])=>run(['docker','run','--rm','--user',`${process.getuid?.()??1000}:${process.getgid?.()??1000}`,'--cpus=2','--memory=512m','-v',`${root}:/fixtures`,'--entrypoint','ffmpeg',image,'-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',source,...extra,'-metadata','comment=private-metadata-marker',`/fixtures/${name}`],{timeout:120,logPath:join(root,`${name}.generation.log`)});
  for(const [name,extra]of [['jpeg.jpg',[]],['gif.gif',[]],['webp.webp',[]],['avif.avif',['-c:v','libaom-av1','-cpu-used','8']]] as [string,string[]][])await ffmpeg(name,'color=c=green:s=64x64:d=0.1',['-frames:v','1',...extra]);
  for(const [name,extra]of [['mp4.mp4',['-c:v','libx264','-pix_fmt','yuv420p']],['mov.mov',['-c:v','libx264','-pix_fmt','yuv420p']],['video.webm',['-c:v','libvpx-vp9']]] as [string,string[]][])await ffmpeg(name,'color=c=green:s=64x64:r=10:d=0.2',extra);
  for(const [name,extra]of [['mp3.mp3',['-c:a','libmp3lame']],['ogg.ogg',['-c:a','libvorbis']],['wav.wav',['-c:a','pcm_s16le']],['audio.weba',['-c:a','libopus','-f','webm']]] as [string,string[]][])await ffmpeg(name,'sine=frequency=440:duration=0.2',extra);
  await writeFile(join(root,'png.png'),png(),{mode:0o600});await writeFile(join(root,'document.pdf'),pdf(),{mode:0o600});
}
export async function check(value:unknown,local=false):Promise<Record<string,unknown>>{
  const settings=object(value),origin=string(settings.origin),revision=string(settings.revision),image=string(settings.image);
  const slug=settings.slug===undefined?undefined:string(settings.slug),credentials=credentialRecord(settings.credentials);require(credentials.accounts.every(account=>account.id.startsWith('example_')),'Media contract checks require fictional identities.');
  const session=new Session(origin,{local,...(slug?{slug}:{})});require(object(await session.json('/__demo/runtime')).revision===revision,'Media contract runtime revision mismatch.');
  const evidence=await privateDir(resolve(string(settings.evidence)));
  const account=credentials.accounts[0];require(account,'Selected fictional author missing.');await session.json('/api/auth/login',{body:{email:account.email,password:account.password}});
  const generated=await privateDir(join(evidence,'fixtures'));await fixtures(image,generated);
  const types:Record<string,string>={'jpeg.jpg':'image/jpeg','png.png':'image/png','gif.gif':'image/gif','webp.webp':'image/webp','avif.avif':'image/avif','mp4.mp4':'video/mp4','mov.mov':'video/quicktime','video.webm':'video/webm','mp3.mp3':'audio/mpeg','ogg.ogg':'audio/ogg','wav.wav':'audio/wav','audio.weba':'audio/webm','document.pdf':'application/pdf'};
  const results:Record<string,unknown>[]=[];
  for(const [name,mime]of Object.entries(types)){
    const raw=await readFile(join(generated,name));const asset=object(await session.json('/api/media/uploads',{body:{fileName:name,mimeType:mime,size:raw.length,purpose:mime==='application/pdf'?'RESUME':'POST'}}));
    const sent=await session.request(string(asset.uploadUrl),{method:'PUT',raw,contentType:mime});await sent.body?.cancel();
    const response=await session.request(string(asset.cdnUrl)),stored=Buffer.from(await response.arrayBuffer());require(response.status===200&&response.headers.get('Content-Type')?.split(';')[0]===mime&&stored.length>0,'Uploaded MIME is not readable with the declared type.');require(!stored.includes(Buffer.from('private-metadata-marker')),'Private metadata marker survived sanitization.');
    const target=join(evidence,`stored-${name}`);await writeFile(target,stored,{mode:0o600});await chmod(target,0o600);
    if(mime!=='application/pdf')await run(['docker','run','--rm','--user',`${process.getuid?.()??1000}:${process.getgid?.()??1000}`,'-v',`${evidence}:/fixtures`,'--entrypoint','ffmpeg',image,'-nostdin','-hide_banner','-loglevel','error','-xerror','-i',`/fixtures/${basename(target)}`,'-f','null','-'],{timeout:120,logPath:join(evidence,`${name}.decoding.log`)});
    await session.json(`/api/media/${string(asset.id)}`,{method:'DELETE'});results.push({mime,inputBytes:raw.length,storedBytes:stored.length,readable:true,metadataMarkerRemoved:true,decoded:mime!=='application/pdf'});
  }
  const allocate=async(raw:Buffer,mime='image/png')=>object(await session.json('/api/media/uploads',{body:{fileName:'invalid.png',mimeType:mime,size:raw.length,purpose:'POST'}}));
  const raw=png();for(const [body,type]of [[Buffer.concat([raw,Buffer.from('extra')]),'image/png'],[raw.subarray(0,-1),'image/png'],[raw,'image/jpeg']] as const){
    const asset=await allocate(raw);await denied(()=>session.request(string(asset.uploadUrl),{method:'PUT',raw:body,contentType:type}),400);await denied(()=>session.request(string(asset.cdnUrl)),404);
  }
  await denied(()=>session.json('/api/media/uploads',{body:{fileName:'active.svg',mimeType:'image/svg+xml',size:100,purpose:'POST'}}),400);
  await denied(()=>session.json('/api/media/uploads',{body:{fileName:'large.png',mimeType:'image/png',size:20*1024*1024+1,purpose:'POST'}}),400);
  for(const path of ['/api/storage/uploads/%2e%2e/private','/api/storage/%2e%2e/%2e%2e/etc/passwd']){
    let refused=false;try{const response=await session.request(path);await response.body?.cancel();}catch(error:unknown){require(error instanceof PreviewError&&/HTTP (400|403|404)\b/.test(error.message),'Unexpected traversal response.');refused=true;}require(refused,'Traversal returned a readable object.');
  }
  const proof={localOnly:local,publicWorker:!local,revision,formats:results,declaredAndActualSizeMismatchRejected400:true,typeMismatchRejected400:true,activeSvgUploadRejected400:true,demoMediaCapRejected400:true,traversalRefused:true,failedUploadsUnreadable404:true};await writeRecord(join(evidence,'validation.json'),proof);return proof;
}
if(await invokedDirectly(import.meta.url)){try{
  if(process.argv.length===3&&process.argv[2]==='--local'){const value:unknown=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(await check(value,true)));}
  else{const input=process.argv[2];require(process.argv.length===3&&input,'Usage: node dist/scripts/validate-media-contracts.js PRIVATE_OPERATION_DIRECTORY_OR_--local');const directory=resolve(input),journal=journalRecord(await readRecord(join(directory,'journal.json'))),origin=journal.target.origin;require(origin,'Missing public origin.');const credentials=await new Session(origin,{slug:journal.slug}).json('/__demo/access.json');await check({origin,slug:journal.slug,credentials,image:object(journal.checkpoints.registry).image,revision:journal.revision,evidence:join(directory,'media-contract-evidence')});console.log('Public media MIME and metadata matrix verified; malformed body, MIME, SVG and traversal refused.');}
}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Media contract verification failed; inspect private evidence.');process.exitCode=1;}}

import { createReadStream } from 'node:fs';
import { chmod,mkdtemp,rm } from 'node:fs/promises';
import { once } from 'node:events';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Parser } from 'tar';
import type { ReadEntry } from 'tar';
import { object,PreviewError,privateDir,readRecord,run,string,writeRecord } from '../preview/state.js';

async function parse(source:AsyncIterable<Buffer>,visit:(entry:ReadEntry)=>void):Promise<void>{
  const warnings:string[]=[];let entries=0,eof=false;
  const parser=new Parser({strict:false,onwarn:code=>{warnings.push(code);},onReadEntry:entry=>{entries++;visit(entry);}});parser.on('eof',()=>{eof=true;});
  const complete=new Promise<void>((done,reject)=>{parser.once('end',done);parser.on('error',reject);});void complete.catch(()=>{});
  try{
    for await(const chunk of source)if(!parser.write(chunk))await Promise.race([once(parser,'drain'),complete]);parser.end();await complete;
    if(warnings.length&&!(entries===0&&eof&&warnings.every(code=>code==='TAR_BAD_ARCHIVE')))throw new PreviewError('Invalid distributed tar archive; all layers must remain inspectable.');
  }catch(error:unknown){parser.abort(error instanceof Error?error:new Error('Invalid image archive'));throw new PreviewError('Distributed tar archive could not be inspected.');}
}
export async function scan(archive:string,values:unknown):Promise<{layers:number;files:number;scannedBytes:number;controlCategories:string[];matchedCategories:string[];allDistributedLayersScanned:true;deletedFilesIncluded:true;scope:string}>{
  const patterns=new Map<string,Buffer[]>();
  for(const [category,entries]of Object.entries(object(values))){
    if(!Array.isArray(entries)||!entries.length||entries.some((value:unknown)=>typeof value!=='string'||value.length<12))throw new PreviewError('Provide explicit synthetic control categories containing values of at least twelve characters.');
    patterns.set(category,entries.map((value:unknown)=>Buffer.from(string(value))));
  }
  if(!patterns.size)throw new PreviewError('Provide nonempty synthetic control categories.');
  const overlap=Math.max(...[...patterns.values()].flat().map(value=>value.length))-1;
  let manifest:unknown;const manifests:Promise<void>[]=[];
  await parse(createReadStream(archive),entry=>{
    if(entry.path!=='manifest.json'){entry.resume();return;}
    const work=(async()=>{if(entry.size>1048576)throw new PreviewError('Image manifest is too large.');const chunks:Buffer[]=[];for await(const chunk of entry)chunks.push(chunk);manifest=JSON.parse(Buffer.concat(chunks).toString());})();void work.catch(()=>{});manifests.push(work);
  });await Promise.all(manifests);
  if(!Array.isArray(manifest)||manifest.length!==1)throw new PreviewError('Use an archive containing one distributed image.');
  const layers=object(manifest[0]).Layers;
  if(!Array.isArray(layers)||!layers.length||layers.some((entry:unknown)=>typeof entry!=='string')||new Set(layers).size!==layers.length)throw new PreviewError('Invalid distributed image layer inventory.');
  const required=new Set(layers as string[]),seen=new Set<string>(),found=new Set<string>();let files=0,count=0;
  const scans:Promise<void>[]=[];
  await parse(createReadStream(archive),entry=>{
    if(!required.has(entry.path)){entry.resume();return;}if(seen.has(entry.path))throw new PreviewError('Duplicate distributed image layer.');seen.add(entry.path);
    const work=parse(entry,item=>{
      if(!['File','OldFile','ContiguousFile'].includes(item.type)){item.resume();return;}files++;
      const fileScan=(async()=>{let tail:Buffer=Buffer.alloc(0);for await(const raw of item){count+=raw.length;const window=Buffer.concat([tail,raw]);for(const [category,entries]of patterns)if(entries.some(value=>window.includes(value)))found.add(category);tail=overlap?window.subarray(-overlap):Buffer.alloc(0);}})();void fileScan.catch(()=>{});scans.push(fileScan);
    });void work.catch(()=>{});scans.push(work);
  });
  await Promise.all(scans);if(seen.size!==required.size)throw new PreviewError('A distributed image layer is missing.');
  return {layers:required.size,files,scannedBytes:count,controlCategories:[...patterns.keys()].sort(),matchedCategories:[...found].sort(),allDistributedLayersScanned:true,deletedFilesIncluded:true,scope:'literal synthetic control values plus separately verified sanitized database; not a universal secret scan'};
}
export async function check(image:string,values:string,destination:string):Promise<void>{
  const controls=(await readRecord(values)).controls;
  const evidence=await privateDir(resolve(destination)),temporary=await mkdtemp(join(evidence,'.image-'));
  try{
    const archive=join(temporary,'image.tar');await run(['docker','save','--output',archive,image],{timeout:1800});await chmod(archive,0o600);
    const proof=await scan(archive,controls);await writeRecord(join(evidence,'layer-validation.json'),{...proof,image});
    if(proof.matchedCategories.length)throw new PreviewError('An original synthetic authentication control remains in a distributed layer.');
    console.log('All distributed image layers inspected; synthetic original authentication controls absent, including deleted lower-layer files.');
  }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const {values,positionals}=parseArgs({allowPositionals:true,options:{values:{type:'string'},evidence:{type:'string'}}});const image=positionals[0];if(positionals.length!==1||!image||!values.values||!values.evidence)throw new PreviewError('Usage: node dist/scripts/verify-image-secrets.js IMAGE --values PRIVATE_CONTROLS --evidence PRIVATE_DIRECTORY');await check(image,values.values,values.evidence);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Image layer verification failed; inspect private evidence.');process.exitCode=1;}}

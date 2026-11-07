import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dataManifest } from '../preview/publication.js';
import { FORMAT,object,PreviewError,readRecord,run,sha,string,verify } from '../preview/state.js';

export async function check(image:string,manifestPath:string):Promise<Record<string,unknown>>{
  const file=resolve(manifestPath),record=await readRecord(file),manifest=dataManifest(record.inputs===undefined?record:object(record.inputs).dataManifest);
  const directory=await mkdtemp(join(tmpdir(),'enois-image-media-'));let container:string|undefined;
  try{
    container=(await run(['docker','create',image])).toString().trim();
    for(const name of ['seed','media'])await run(['docker','cp',`${container}:/opt/render-demo/${name}`,join(directory,name)]);
    let count=0,total=0;
    for(const mapping of manifest.media){await verify(join(directory,'media',mapping.directory),mapping.inventory);count+=Object.keys(mapping.inventory).length;for(const item of Object.values(mapping.inventory))total+=item.bytes;}
    for(const [path,expected]of Object.entries(manifest.files))if(path.startsWith('seed/')&&await sha(join(directory,path))!==expected.sha256)throw new PreviewError('Image seed differs from the recorded sanitized capture.');
    return {format:FORMAT,image,mediaFiles:count,mediaBytes:total,mediaHashesMatch:true,provenanceSha256:await sha(file)};
  }finally{try{if(container)await run(['docker','rm',container]);}finally{await rm(directory,{recursive:true,force:true});}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const {values,positionals}=parseArgs({allowPositionals:true,options:{manifest:{type:'string'}}});const image=positionals[0];if(positionals.length!==1||!image||!values.manifest)throw new PreviewError('Usage: node dist/scripts/verify-image-media.js IMAGE --manifest NEW_PROVENANCE_OR_JOURNAL');console.log(JSON.stringify(await check(image,values.manifest)));}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Image media verification failed; inspect its new-format provenance and image.');process.exitCode=1;}}

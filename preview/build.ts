import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Journal } from './publication.js';
import { inventory, object, PreviewError, privateDir, run, sha, string, verify, writeRecord } from './state.js';

export interface ImageEvidence { seedMediaVerified: true; licenseNoticesVerified: true; designSystemSha256: string; frontendDependency: string; designSystemVersion: string; frontendResolutionSha256: string }
export async function verifyImage(image: string, journal: Journal, directory: string): Promise<ImageEvidence> {
  const container = (await run(['docker','create',image])).toString().trim();
  let temporary:string|undefined;
  try {
    temporary = await mkdtemp(join(directory,'.image-')); await privateDir(temporary);
    for (const name of ['seed','media','provenance','licenses']) await run(['docker','cp',`${container}:/opt/render-demo/${name}`,join(temporary,name)]);
    for (const project of ['enois-backend','enois-frontend','enois-design-system']) {
      if (await sha(join(temporary,'licenses',`${project}.LICENSE`)) !== await sha(join(directory,'frozen/sources',project,'LICENSE'))) throw new PreviewError('Packaged application license differs from its frozen source notice.');
    }
    const notices = await inventory(join(directory,'frozen/recipe/licenses'));
    for (const [path,expected] of Object.entries(notices)) {
      if (await sha(join(temporary,'licenses',path)) !== expected.sha256) throw new PreviewError('Model license notice missing from image.');
    }
    const expected = journal.inputs.dataManifest;
    for (const mapping of expected.media) await verify(join(temporary,'media',mapping.directory),mapping.inventory);
    for (const [path,file] of Object.entries(expected.files)) {
      if (path.startsWith('seed/') && await sha(join(temporary,path)) !== file.sha256) throw new PreviewError('Image seed mismatch.');
    }
    const ds = join(temporary,'provenance/design-system.tgz');
    if ((await stat(ds)).size === 0) throw new PreviewError('Fresh design system package missing from image.');
    const resolution = object(JSON.parse(await readFile(join(temporary,'provenance/frontend-package-lock.json'),'utf8')));
    const dependency = object(object(resolution.packages)['node_modules/@rede-enois/design-system']);
    const source = object(JSON.parse(await readFile(join(directory,'frozen/sources/enois-design-system/package.json'),'utf8')));
    if (dependency.version !== source.version || dependency.resolved !== 'file:../design-system.tgz') throw new PreviewError('Frontend did not consume the freshly built design system package from the captured commit.');
    const result: ImageEvidence = { seedMediaVerified:true,licenseNoticesVerified:true,designSystemSha256:await sha(ds),frontendDependency:string(dependency.resolved),designSystemVersion:string(dependency.version),frontendResolutionSha256:await sha(join(temporary,'provenance/frontend-package-lock.json')) };
    await writeRecord(join(directory,'image-evidence.json'),result); return result;
  } finally { try { await run(['docker','rm',container]); } finally { if(temporary)await rm(temporary,{recursive:true,force:true}); } }
}

import { cp, chmod } from 'node:fs/promises';
import { basename } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readRecord } from './state.js';
import { validate } from './validation.js';
import type { ValidationResult } from './validation.js';

export async function buildImage(journal:Journal,directory:string):Promise<{id:string;tag:string}&ImageEvidence>{
  const context=join(directory,'build');await rm(context,{recursive:true,force:true});await cp(join(directory,'frozen'),context,{recursive:true});await privateDir(join(context,'data/media'));
  await writeRecord(join(context,'runtime-manifest.json'),{revision:journal.revision,commits:journal.inputs.commits,dataVersion:journal.inputs.data,media:journal.inputs.dataManifest.media});
  await writeFile(join(context,'package-runtime.json'),'{"type":"module"}\n',{mode:0o600});
  await run([process.execPath,join(context,'dist/recipe/prepare.js'),context],{logPath:join(directory,'recipe-prepare.log')});
  await writeRecord(join(directory,'adjusted-sources.json'),{files:await inventory(join(context,'sources'))});
  const tag=`enois-preview:${journal.revision}`;
  await run(['docker','build','--label',`io.enois.preview.revision=${journal.revision}`,'-f',join(context,'recipe/Dockerfile'),'-t',tag,context],{timeout:7200,logPath:join(directory,'build.log')});
  const metadata:unknown=JSON.parse((await run(['docker','image','inspect',tag])).toString());
  if(!Array.isArray(metadata))throw new PreviewError('Docker did not confirm the built image.');
  const id=string(object(metadata[0]).Id);if(!/^sha256:[a-f0-9]{64}$/.test(id))throw new PreviewError('Docker returned an invalid image identity.');
  return {id,tag,...await verifyImage(id,journal,directory)};
}
async function containerState(container:string):Promise<Record<string,unknown>>{
  const data:unknown=JSON.parse((await run(['docker','inspect',container])).toString());
  if(!Array.isArray(data))throw new PreviewError('Docker did not confirm runtime state.');return object(object(data[0]).State);
}
export async function validateLocal(image:string,journal:Journal,directory:string,exercise?:(origin:string,credentials:unknown,directory:string,container:string)=>Promise<unknown>):Promise<ValidationResult&{functionalEvidence?:unknown}>{
  const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const address=socket.address();if(!address||typeof address==='string')throw new PreviewError('Unable to reserve local verification port.');
  const port=address.port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  const origin=`http://localhost:${port}`;
  const container=(await run(['docker','run','-d','--cpus=2','--memory=2g','-p',`127.0.0.1:${port}:3000`,'-e',`DEMO_PUBLIC_ORIGIN=${origin}`,'-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,image])).toString().trim();
  try{
    const file=join(directory,'local-credentials.json');let copied=false;
    for(let attempt=0;attempt<300;attempt++){
      try{await run(['docker','cp',`${container}:/tmp/demo-credentials.json`,file]);await chmod(file,0o600);copied=true;break;}
      catch(error:unknown){if(!(error instanceof PreviewError))throw error;if((await containerState(container)).Running!==true)throw new PreviewError('Disposable runtime exited before generating credentials; inspect private runtime.log.');await delay(1000);}
    }
    if(!copied)throw new PreviewError('Disposable runtime did not generate credentials.');
    const credentials=await readRecord(file);
    const result:ValidationResult&{functionalEvidence?:unknown}=await validate(origin,journal,{credentials,local:true,evidence:directory,alive:async()=>(await containerState(container)).Running===true});
    if(exercise)result.functionalEvidence=await exercise(origin,credentials,directory,container);
    await writeRecord(join(directory,'local-validation.json'),result);return result;
  }finally{
    try{
      const state=await containerState(container);await writeRecord(join(directory,'runtime-exit.json'),{Running:state.Running,ExitCode:state.ExitCode,OOMKilled:state.OOMKilled,Error:state.Error});
      await run(['docker','logs',container],{logPath:join(directory,'runtime.log')});
      for(const line of (await run(['docker','diff',container])).toString().split('\n')){
        const path=line.slice(2);if(/^\/tmp\/hs_err_pid[0-9]+\.log$/.test(path)){const target=join(directory,basename(path));await run(['docker','cp',`${container}:${path}`,target]);await chmod(target,0o600);}
      }
    }finally{await run(['docker','rm','-f',container]);}
  }
}

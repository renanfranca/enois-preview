import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Journal } from './publication.js';
import { inventory, object, PreviewError, privateDir, run, sha, commandRunner, string, verify, writeRecord } from './state.js';
import { warn } from './warnings.js';

export interface ImageEvidence { seedMediaVerified: boolean; licenseNoticesVerified: boolean; designSystemSha256: string | null; frontendDependency: string | null; designSystemVersion: string | null; frontendResolutionSha256: string | null }
async function same(file: string, expected: string): Promise<boolean> { try { return await sha(file) === expected; } catch { return false; } }
/** Inspects the built image. Every difference is reported as a warning; only an image Docker cannot create or copy from stops here. */
export async function verifyImage(image: string, journal: Journal, directory: string, signal?: AbortSignal): Promise<ImageEvidence> {
  signal?.throwIfAborted();
  const command=commandRunner(signal);
  const container=`enois-preview-inspect-${randomUUID()}`;
  let temporary:string|undefined;
  try {
    await command(['docker','create','--name',container,image]);
    temporary = await mkdtemp(join(directory,'.image-')); await privateDir(temporary);
    for (const name of ['seed','media','provenance','licenses']) await command(['docker','cp',`${container}:/opt/render-demo/${name}`,join(temporary,name)]);
    let licenses = true;
    for (const project of ['enois-backend','enois-frontend','enois-design-system']) {
      let expected: string | undefined; try { expected = await sha(join(directory,'frozen/sources',project,'LICENSE')); } catch { expected = undefined; }
      if (expected === undefined || !await same(join(temporary,'licenses',`${project}.LICENSE`),expected)) { licenses = false; warn('image-license-notice', `Packaged ${project} license differs from its frozen source notice.`); }
    }
    for (const [path,expected] of Object.entries(await inventory(join(directory,'frozen/recipe/licenses')))) {
      if (!await same(join(temporary,'licenses',path),expected.sha256)) { licenses = false; warn('image-license-notice', `Model license notice ${path} is missing from the image.`); }
    }
    const expected = journal.inputs.dataManifest; let seedMedia = true;
    for (const mapping of expected.media) { try { await verify(join(temporary,'media',mapping.directory),mapping.inventory); } catch { seedMedia = false; warn('image-media-inventory', `Image media under ${mapping.url} differs from the frozen inventory.`); } }
    for (const [path,file] of Object.entries(expected.files)) {
      if (path.startsWith('seed/') && !await same(join(temporary,path),file.sha256)) { seedMedia = false; warn('image-seed-inventory', `Image ${path} differs from the frozen seed.`); }
    }
    const ds = join(temporary,'provenance/design-system.tgz');
    let designSystemSha256: string | null = null, frontendDependency: string | null = null, designSystemVersion: string | null = null, frontendResolutionSha256: string | null = null;
    try {
      if ((await stat(ds)).size === 0) throw new PreviewError('empty');
      designSystemSha256 = await sha(ds);
      const resolution = object(JSON.parse(await readFile(join(temporary,'provenance/frontend-package-lock.json'),'utf8')));
      const dependency = object(object(resolution.packages)['node_modules/@rede-enois/design-system']);
      const source = object(JSON.parse(await readFile(join(directory,'frozen/sources/enois-design-system/package.json'),'utf8')));
      frontendDependency = typeof dependency.resolved === 'string' ? dependency.resolved : null; designSystemVersion = typeof dependency.version === 'string' ? dependency.version : null;
      frontendResolutionSha256 = await sha(join(temporary,'provenance/frontend-package-lock.json'));
      if (dependency.version !== source.version || dependency.resolved !== 'file:../design-system.tgz') warn('image-design-system', 'Frontend did not resolve the freshly built design system package from the captured commit.');
    } catch { warn('image-design-system', 'Fresh design system package or frontend resolution is missing from the image.'); }
    const result: ImageEvidence = { seedMediaVerified:seedMedia,licenseNoticesVerified:licenses,designSystemSha256,frontendDependency,designSystemVersion,frontendResolutionSha256 };
    await writeRecord(join(directory,'image-evidence.json'),result); return result;
  } finally { try { await run(['docker','rm','-f',container]); } finally { if(temporary)await rm(temporary,{recursive:true,force:true}); } }
}

import { cp, chmod } from 'node:fs/promises';
import { basename } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readRecord } from './state.js';
import { validate } from './validation.js';
import type { ValidationResult } from './validation.js';

export async function buildImage(journal:Journal,directory:string,signal?:AbortSignal):Promise<{id:string;tag:string}&ImageEvidence>{
  signal?.throwIfAborted();
  const command=commandRunner(signal);
  const context=join(directory,'build');await rm(context,{recursive:true,force:true});await cp(join(directory,'frozen'),context,{recursive:true});await privateDir(join(context,'data/media'));
  await writeRecord(join(context,'runtime-manifest.json'),{revision:journal.revision,commits:journal.inputs.commits,dataVersion:journal.inputs.data,media:journal.inputs.dataManifest.media});
  await writeFile(join(context,'package-runtime.json'),'{"type":"module"}\n',{mode:0o600});
  await command([process.execPath,join(context,'dist/recipe/prepare.js'),context],{logPath:join(directory,'recipe-prepare.log')});
  await writeRecord(join(directory,'adjusted-sources.json'),{files:await inventory(join(context,'sources'))});
  const tag=`enois-preview:${journal.revision}`;
  await command(['docker','build','--label',`io.enois.preview.revision=${journal.revision}`,'-f',join(context,'recipe/Dockerfile'),'-t',tag,context],{timeout:7200,logPath:join(directory,'build.log')});
  const metadata:unknown=JSON.parse((await command(['docker','image','inspect',tag])).toString());
  if(!Array.isArray(metadata))throw new PreviewError('Docker did not confirm the built image.');
  const id=string(object(metadata[0]).Id);if(!/^sha256:[a-f0-9]{64}$/.test(id))throw new PreviewError('Docker returned an invalid image identity.');
  return {id,tag,...await verifyImage(id,journal,directory,signal)};
}
async function containerState(container:string,signal?:AbortSignal):Promise<Record<string,unknown>>{
  const data:unknown=JSON.parse((await run(['docker','inspect',container],{signal})).toString());
  if(!Array.isArray(data))throw new PreviewError('Docker did not confirm runtime state.');return object(object(data[0]).State);
}
export async function validateLocal(image:string,journal:Journal,directory:string,exercise?:(origin:string,credentials:unknown,directory:string,container:string)=>Promise<unknown>,signal?:AbortSignal):Promise<ValidationResult&{functionalEvidence?:unknown}>{
  signal?.throwIfAborted();
  const command=commandRunner(signal);
  const socket=createServer();await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const address=socket.address();if(!address||typeof address==='string')throw new PreviewError('Unable to reserve local verification port.');
  const port=address.port;await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  const origin=`http://localhost:${port}`;
  signal?.throwIfAborted();
  const container=`enois-preview-local-${randomUUID()}`;
  try{
    await command(['docker','run','--name',container,'-d','--cpus=2','--memory=2g','-p',`127.0.0.1:${port}:3000`,'-e',`DEMO_PUBLIC_ORIGIN=${origin}`,'-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,image]);
    const file=join(directory,'local-credentials.json');let copied=false;
    for(let attempt=0;attempt<300;attempt++){
      try{await command(['docker','cp',`${container}:/tmp/demo-credentials.json`,file]);await chmod(file,0o600);copied=true;break;}
      catch(error:unknown){signal?.throwIfAborted();if(!(error instanceof PreviewError))throw error;if((await containerState(container,signal)).Running!==true)throw new PreviewError('Disposable runtime exited before generating credentials; inspect private runtime.log.');await delay(1000,undefined,{signal});}
    }
    if(!copied)throw new PreviewError('Disposable runtime did not generate credentials.');
    const credentials=await readRecord(file);
    const result:ValidationResult&{functionalEvidence?:unknown}=await validate(origin,journal,{credentials,local:true,evidence:directory,signal,alive:async()=>(await containerState(container,signal)).Running===true});
    signal?.throwIfAborted();
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

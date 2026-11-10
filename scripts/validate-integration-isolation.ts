import { randomBytes } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { ROOT } from '../preview/project.js';
import { object, PreviewError, privateDir, run, writeRecord, invokedDirectly } from '../preview/state.js';

export async function check(image:string,destination:string):Promise<void>{
  const evidence=await privateDir(resolve(destination));const inspection:unknown=JSON.parse((await run(['docker','image','inspect',image])).toString());
  if(!Array.isArray(inspection)||typeof object(object(object(inspection[0]).Config).Labels)['io.enois.preview.revision']!=='string')throw new PreviewError('Use an identified fictional preview image.');
  const container=(await run(['docker','create','--cpus=2','--memory=2g','-e','DEMO_PUBLIC_ORIGIN=http://localhost:3000','-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,'--entrypoint','java',image,'--enable-native-access=ALL-UNNAMED','-XX:ActiveProcessorCount=1','-Xmx768m','-cp','/tmp/probe:/opt/render-demo/backend/rede.jar:/opt/render-demo/backend/lib/*','IntegrationProbe'])).toString().trim();let temporary:string|undefined;
  try{
    temporary=await mkdtemp(join(evidence,'.probe-'));await run(['docker','cp',`${container}:/opt/render-demo/backend`,join(temporary,'backend')]);
    const classpath=`${join(temporary,'backend/rede.jar')}:${join(temporary,'backend/lib/*')}`;
    await run(['javac','-cp',classpath,'-d',join(temporary,'probe'),join(ROOT,'scripts/IntegrationProbe.java')],{logPath:join(evidence,'probe-compilation.log')});
    await run(['docker','cp',join(temporary,'probe'),`${container}:/tmp/probe`]);
    await run(['docker','start','-a',container],{timeout:300,logPath:join(evidence,'integration-probe.log')});
    const actual:unknown=JSON.parse((await run(['docker','inspect',container])).toString());
    if(!Array.isArray(actual)||object(object(actual[0]).State).ExitCode!==0)throw new PreviewError('Packaged integration probe failed; inspect private log.');
    const line=(await readFile(join(evidence,'integration-probe.log'),'utf8')).split('\n').find(line=>line.startsWith('INTEGRATION_PROOF='));
    if(!line)throw new PreviewError('Packaged integration proof missing; inspect private log.');const proof=object(JSON.parse(line.slice('INTEGRATION_PROOF='.length)));
    if(typeof proof.httpPositiveControlAttempts!=='number'||proof.httpPositiveControlAttempts<=0||proof.demoHttpAttempts!==0||proof.scheduledEntryPointsExercised!==6||proof.eligibleExternalAssetDeletionCompleted!==true||proof.externalStorageAndLazyMigrationAbsent!==true||proof.originalLinkedInUnavailable!==true||proof.supportUnconfigured!==true||proof.pushDisabledAndApacheTransportAbsent!==true)throw new PreviewError('Integration proof failed its positive control or isolation assertions.');
    await writeRecord(join(evidence,'integration-validation.json'),{...proof,image,actualPackagedApplication:true,localOnly:true,transport:'JDK HTTP blocked by recording ProxySelector with positive control; external storage beans absent'});
    console.log('Packaged integration isolation verified: six scheduled entry points, eligible external asset deletion and zero external HTTP attempts.');
  }finally{try{if(temporary)await rm(temporary,{recursive:true,force:true});}finally{await run(['docker','rm','-f',container]);}}
}
if(await invokedDirectly(import.meta.url)){try{const image=process.argv[2],evidence=process.argv[3];if(process.argv.length!==4||!image||!evidence)throw new PreviewError('Usage: node dist/scripts/validate-integration-isolation.js IMAGE PRIVATE_EVIDENCE_DIRECTORY');await check(image,evidence);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Invalid packaged integration proof; inspect private evidence.');process.exitCode=1;}}

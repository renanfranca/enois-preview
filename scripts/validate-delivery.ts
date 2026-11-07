import { mkdtemp,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../preview/project.js';
import { object, PreviewError, privateDir, run, writeRecord } from '../preview/state.js';

export async function check(image:string,destination:string):Promise<void>{
  const evidence=await privateDir(resolve(destination));const container=(await run(['docker','create',image])).toString().trim();let temporary:string|undefined;
  try{
    temporary=await mkdtemp(join(evidence,'.probe-'));await run(['docker','cp',`${container}:/opt/render-demo/backend`,join(temporary,'backend')]);
    const classpath=`${join(temporary,'backend/rede.jar')}:${join(temporary,'backend/lib/*')}`;
    await run(['javac','-cp',classpath,'-d',temporary,join(ROOT,'scripts/DeliveryProbe.java')],{logPath:join(evidence,'probe-compilation.log')});
    const output=(await run(['java','-cp',`${temporary}:${classpath}`,'DeliveryProbe'],{logPath:join(evidence,'delivery-probe.log')})).toString();
    const line=output.split('\n').find(line=>line.startsWith('DELIVERY_PROOF='));if(!line)throw new PreviewError('Packaged delivery proof missing; inspect private log.');
    const proof=object(JSON.parse(line.slice('DELIVERY_PROOF='.length)));
    if(proof.positiveControlCalls!==1||proof.demoTransportCalls!==0||proof.eligibleAsyncNewsletterLocalEffect!==true||proof.directEmailLocalEffect!==true)throw new PreviewError('Packaged delivery proof failed its positive control or local effects.');
    await writeRecord(join(evidence,'delivery-validation.json'),{...proof,image,actualPackagedServices:true,externalTransport:'recording double with positive control; no SMTP delivery',localOnly:true});
    console.log('Packaged demo email verified: positive control observed; local direct and asynchronous effects retained without external sends.');
  }finally{try{if(temporary)await rm(temporary,{recursive:true,force:true});}finally{await run(['docker','rm',container]);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const image=process.argv[2],evidence=process.argv[3];if(process.argv.length!==4||!image||!evidence)throw new PreviewError('Usage: node dist/scripts/validate-delivery.js IMAGE PRIVATE_EVIDENCE_DIRECTORY');await check(image,evidence);}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Invalid packaged delivery proof; inspect private evidence.');process.exitCode=1;}}

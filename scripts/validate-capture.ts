import { chmod, cp, writeFile } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { capture, ROOT } from '../preview/capture.js';
import { captureConfig } from '../preview/config.js';
import type { CaptureConfig } from '../preview/config.js';
import { Session } from '../preview/validation.js';
import { collectWarnings } from '../preview/warnings.js';
import { readPidRecord } from '../preview/service.js';
import { exists, object, PreviewError, privateDir, readRecord, run, string, writeRecord, identity, inventory, invokedDirectly } from '../preview/state.js';

const CAPTURE_BUDGET_SECONDS=600;
function require(condition:unknown,message:string):asserts condition { if(!condition)throw new PreviewError(message); }
async function freePort():Promise<number>{
  const server=createServer();await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const address=server.address();require(address&&typeof address!=='string','No local verification port available.');
  await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return address.port;
}
/** The example's own adapter (preview/service.ts) runs the fictional backend; capture itself never calls it. */
async function command(serviceFile:string,action:'status'|'start'|'stop'):Promise<string>{return (await run([process.execPath,join(ROOT,'dist/preview/service.js'),serviceFile,action],{timeout:120})).toString().trim();}
async function ready(origin:string):Promise<void>{
  const deadline=Date.now()+120_000;
  do{try{if(object(await new Session(origin,{local:true,timeout:5}).json('/api/actuator/health/readiness')).status==='UP')return;}catch{}await delay(250);}while(Date.now()<deadline);
  throw new PreviewError('Actual Spring readiness did not become UP. Inspect private service logs.');
}

export async function check(workspaceInput:string,destinationInput:string):Promise<void>{
  const began=performance.now();const seconds=(from:number)=>Math.round((performance.now()-from)/100)/10;
  const workspace=resolve(workspaceInput);const destination=resolve(destinationInput);
  const manifest=await readRecord(join(workspace,'example-manifest.json'));require(object(manifest.observed).users===4,'Use a prepared fictional workspace.');
  const original=await readRecord(join(workspace,'.preview/config.json'));const originalCapture=captureConfig(original);
  require(originalCapture.database===join(workspace,'.preview/data/rede.mv.db')&&originalCapture.accounts.every(account=>account.id.startsWith('example_')),'Only the fictional example is supported by this verifier.');
  require(await command(join(workspace,'.preview/service.json'),'status')==='stopped','The prepared example must be stopped; its original service will not be changed.');
  require(!await exists(destination),'Choose a new evidence directory; prior evidence is preserved.');
  const evidence=await privateDir(destination);await privateDir(join(evidence,'data'));
  const database=join(evidence,'data/rede.mv.db');await cp(originalCapture.database,database);await chmod(database,0o600);
  const media:CaptureConfig['media']=[];
  for(const [index,mapping]of originalCapture.media.entries()){const root=join(evidence,'media',String(index));await cp(mapping.root,root,{recursive:true});media.push({root,url:mapping.url});}
  const environmentFile=join(evidence,'service-environment.json');await writeRecord(environmentFile,{environment:{REDE_SECURITY_ENCRYPTION_KEY:randomBytes(32).toString('base64')}});
  const sourceAdapter=await readRecord(join(workspace,'.preview/service.json'));
  async function adapter(name:string,db:string):Promise<{config:CaptureConfig;origin:string;serviceFile:string}>{
    const port=await freePort();const file=join(evidence,`${name}-service.json`);
    await writeRecord(file,{...sourceAdapter,database:db,port,environmentFile,pidfile:join(evidence,`${name}.pid`),log:join(evidence,`${name}.log`)});
    return {config:captureConfig({...originalCapture,database:db,state:join(evidence,'state'),media}),origin:`http://localhost:${port}`,serviceFile:file};
  }
  const live=await adapter('live',database);let clean:Awaited<ReturnType<typeof adapter>>|undefined;
  const originals=['lia','rui','maya','davi'].map(name=>({id:`example_${name}`,email:`${name}@enois.invalid`,password:randomBytes(24).toString('base64url')}));
  await writeRecord(join(evidence,'original-fictional-credentials.json'),{accounts:originals});
  const statements=originals.map(account=>{
    const salt=randomBytes(16);const encoded=`120000:${salt.toString('base64')}:${pbkdf2Sync(account.password,salt,120000,32,'sha256').toString('base64')}`;
    return `UPDATE USER_CREDENTIALS SET PASSWORD_HASH='${encoded}', PASSWORD_USABLE=TRUE, RESET_NEEDED=FALSE WHERE USER_ID='${account.id}';`;
  });statements.push("UPDATE USERS SET IS_ADMIN=TRUE WHERE ID='example_lia';");
  const sql=join(evidence,'credentials.sql');await writeFile(sql,statements.join('\n'),{mode:0o600});
  await run(['java','-cp',originalCapture.h2Jar,'org.h2.tools.RunScript','-url',`jdbc:h2:file:${database.replace(/\.mv\.db$/,'')};MODE=MySQL;IFEXISTS=TRUE`,'-user','sa','-script',sql]);
  async function loginAll(origin:string):Promise<void>{for(const account of originals){const login=object(await new Session(origin,{local:true}).json('/api/auth/login',{body:{email:account.email,password:account.password}}));require(object(login.user).id===account.id,'Synthetic original login did not retain its identity.');}}
  try{
    await command(live.serviceFile,'start');await ready(live.origin);await loginAll(live.origin);
    const pid=async()=>(await readPidRecord(join(evidence,'live.pid')))?.pid;const pidBefore=await pid();require(pidBefore,'The fictional backend did not record its process.');

    const {result:frozen,warnings}=await collectWarnings(()=>capture(live.config));

    require(await command(live.serviceFile,'status')==='running','Capture must not stop the running backend.');
    const pidAfter=await pid();require(pidAfter===pidBefore,'Capture must leave the same backend process running.');process.kill(pidBefore,0);
    const inUse=warnings.some(warning=>warning.code==='database-in-use');require(inUse,'Capture of a file held by a running backend must warn that it is in use.');
    await ready(live.origin);await loginAll(live.origin);require(frozen.permissions.example_lia?.admin===true,'Captured administrator permission changed.');
    const cleanDb=join(await privateDir(join(evidence,'clean-data')),'rede.mv.db');
    await cp(join(live.config.state,'data',frozen.id,'package/seed/rede.mv.db'),cleanDb);clean=await adapter('clean',cleanDb);
    await command(clean.serviceFile,'start');await ready(clean.origin);
    for(const account of originals){
      let rejected=false;
      try{await new Session(clean.origin,{local:true}).json('/api/auth/login',{body:{email:account.email,password:account.password}});}
      catch(error:unknown){if(error instanceof PreviewError&&/HTTP 401\b/.test(error.message))rejected=true;else throw error;}
      require(rejected,'Sanitized copy accepted an original synthetic login.');
    }
    const capturePhasesSeconds=seconds(began);require(capturePhasesSeconds<=CAPTURE_BUDGET_SECONDS,`Capture phases exceeded their ${CAPTURE_BUDGET_SECONDS} s budget (${capturePhasesSeconds} s).`);
    const durations={capturePhasesSeconds,budgetsSeconds:{capturePhases:CAPTURE_BUDGET_SECONDS}};
    await writeRecord(join(evidence,'capture-validation.json'),{realSpringAndH2:true,backendRunningDuringCapture:true,backendPidUnchanged:true,inUseWarning:inUse,warningCodes:warnings.map(warning=>warning.code),validOriginalLoginsBeforeCapture:4,originalLoginsStillValidAfterCapture:4,originalLoginsRejectedInSanitizedCopy401:4,capturedAdminPermissionPreserved:true,dataVersion:frozen.id,sanitizerSha256:frozen.sanitizerSha256,localOnly:true,durations});
    console.log('Real Spring/H2 capture verified with the backend running: the same process kept serving, four original logins stayed valid locally and were rejected in the sanitized copy.');
  }finally{try{if(clean)await command(clean.serviceFile,'stop');}finally{await command(live.serviceFile,'stop');}}
}
if(await invokedDirectly(import.meta.url)){
  try{require(process.argv.length===4&&process.argv[2]&&process.argv[3],'Usage: node dist/scripts/validate-capture.js PREPARED_FICTIONAL_WORKSPACE NEW_PRIVATE_EVIDENCE');await check(string(process.argv[2]),string(process.argv[3]));}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Real capture verification failed; inspect private evidence.');process.exitCode=1;}
}

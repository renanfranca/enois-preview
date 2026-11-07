import { chmod, cp, writeFile } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { capture, ROOT } from '../preview/capture.js';
import { captureConfig } from '../preview/config.js';
import type { CaptureConfig } from '../preview/config.js';
import { Session } from '../preview/validation.js';
import { exists, object, PreviewError, privateDir, readRecord, run, string, writeRecord } from '../preview/state.js';

function require(condition:unknown,message:string):asserts condition { if(!condition)throw new PreviewError(message); }
async function freePort():Promise<number>{
  const server=createServer();await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const address=server.address();require(address&&typeof address!=='string','No local verification port available.');
  await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));return address.port;
}
async function command(config:CaptureConfig,action:'status'|'start'|'stop'):Promise<string>{return (await run(config.service[action],{timeout:config.service.timeout})).toString().trim();}
async function ready(origin:string):Promise<void>{
  const deadline=Date.now()+120_000;
  do{try{if(object(await new Session(origin,{local:true,timeout:5}).json('/api/actuator/health/readiness')).status==='UP')return;}catch{}await delay(250);}while(Date.now()<deadline);
  throw new PreviewError('Actual Spring readiness did not become UP. Inspect private service logs.');
}

export async function check(workspaceInput:string,destinationInput:string):Promise<void>{
  const workspace=resolve(workspaceInput);const destination=resolve(destinationInput);
  const manifest=await readRecord(join(workspace,'example-manifest.json'));require(object(manifest.observed).users===4,'Use a prepared fictional workspace.');
  const original=await readRecord(join(workspace,'.preview/config.json'));const originalCapture=captureConfig(original);
  require(originalCapture.database===join(workspace,'.preview/data/rede.mv.db')&&originalCapture.accounts.every(account=>account.id.startsWith('example_')),'Only the fictional example is supported by this verifier.');
  require(await command(originalCapture,'status')==='stopped','The prepared example must be stopped; its original service will not be changed.');
  require(!await exists(destination),'Choose a new evidence directory; prior evidence is preserved.');
  const evidence=await privateDir(destination);await privateDir(join(evidence,'data'));
  const database=join(evidence,'data/rede.mv.db');await cp(originalCapture.database,database);await chmod(database,0o600);
  const media:CaptureConfig['media']=[];
  for(const [index,mapping]of originalCapture.media.entries()){const root=join(evidence,'media',String(index));await cp(mapping.root,root,{recursive:true});media.push({root,url:mapping.url});}
  const environmentFile=join(evidence,'service-environment.json');await writeRecord(environmentFile,{environment:{REDE_SECURITY_ENCRYPTION_KEY:randomBytes(32).toString('base64')}});
  const sourceAdapter=await readRecord(join(workspace,'.preview/service.json'));
  async function adapter(name:string,db:string):Promise<{config:CaptureConfig;origin:string}>{
    const port=await freePort();const file=join(evidence,`${name}-service.json`);
    await writeRecord(file,{...sourceAdapter,database:db,port,environmentFile,pidfile:join(evidence,`${name}.pid`),log:join(evidence,`${name}.log`)});
    const commands=Object.fromEntries(['identity','status','start','stop','released','ready'].map(action=>[action,[process.execPath,join(ROOT,'dist/preview/service.js'),file,action]]));
    return {config:captureConfig({...originalCapture,database:db,state:join(evidence,'state'),media,service:{...commands,expectedIdentity:db,timeout:120}}),origin:`http://localhost:${port}`};
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
    await command(live.config,'start');await ready(live.origin);await loginAll(live.origin);

    const frozen=await capture(live.config);

    require(await command(live.config,'status')==='running','Actual Spring was not running before capture returned.');
    await ready(live.origin);await loginAll(live.origin);require(frozen.permissions.example_lia?.admin===true,'Captured administrator permission changed.');
    const cleanDb=join(await privateDir(join(evidence,'clean-data')),'rede.mv.db');
    await cp(join(live.config.state,'data',frozen.id,'package/seed/rede.mv.db'),cleanDb);clean=await adapter('clean',cleanDb);
    await command(clean.config,'start');await ready(clean.origin);
    for(const account of originals){
      let rejected=false;
      try{await new Session(clean.origin,{local:true}).json('/api/auth/login',{body:{email:account.email,password:account.password}});}
      catch(error:unknown){if(error instanceof PreviewError&&/HTTP 401\b/.test(error.message))rejected=true;else throw error;}
      require(rejected,'Sanitized copy accepted an original synthetic login.');
    }
    await writeRecord(join(evidence,'capture-validation.json'),{realSpringAndH2:true,validOriginalLoginsBeforeCapture:4,backendRestoredHealthyBeforeCaptureReturned:true,originalLoginsStillValidAfterCapture:4,originalLoginsRejectedInSanitizedCopy401:4,capturedAdminPermissionPreserved:true,dataVersion:frozen.id,sanitizerSha256:frozen.sanitizerSha256,localOnly:true});
    console.log('Real Spring/H2 capture verified: four original logins preserved locally and rejected in the sanitized copy; backend restored healthy.');
  }finally{try{if(clean)await command(clean.config,'stop');}finally{await command(live.config,'stop');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{require(process.argv.length===4&&process.argv[2]&&process.argv[3],'Usage: node dist/scripts/validate-capture.js PREPARED_FICTIONAL_WORKSPACE NEW_PRIVATE_EVIDENCE');await check(string(process.argv[2]),string(process.argv[3]));}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Real capture verification failed; inspect private evidence.');process.exitCode=1;}
}

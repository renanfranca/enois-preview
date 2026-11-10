import { readFile, realpath, open, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { exists, object, PreviewError, privateDir, readRecord, string, invokedDirectly } from './state.js';
interface ServiceConfig {database:string;jar:string;cwd:string;port:number;pidfile:string;log:string;environmentFile?:string}
function configRecord(value:unknown):ServiceConfig{
  const data=object(value);const port=data.port;if(typeof port!=='number'||!Number.isInteger(port)||port<1||port>65535)throw new PreviewError('Invalid owned backend port.');
  return {database:string(data.database),jar:string(data.jar),cwd:string(data.cwd),port,pidfile:string(data.pidfile),log:string(data.log),...(data.environmentFile?{environmentFile:string(data.environmentFile)}:{})};
}
interface BackendIdentity {pid:number;starttime:number}
interface PidRecord {pid:number;starttime?:number}
const missing=(error:unknown)=>typeof error==='object'&&error!==null&&['ENOENT','ESRCH'].includes(String((error as {code?:unknown}).code));
async function processStat(pid:number):Promise<{state:string;starttime:number}|undefined>{
  try{const stat=await readFile(`/proc/${pid}/stat`,'utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');return {state:fields[0]!,starttime:Number(fields[19])};}
  catch(error:unknown){if(missing(error))return;throw error;}
}
/** Reads the owned backend pidfile: `{"pid":N,"starttime":T}` (0.3.6+) or the legacy bare PID. */
export async function readPidRecord(pidfile:string):Promise<PidRecord|undefined>{
  if(!await exists(pidfile))return;
  const text=(await readFile(pidfile,'utf8')).trim();if(/^[1-9][0-9]*$/.test(text))return Number.isSafeInteger(Number(text))?{pid:Number(text)}:undefined;
  let record:unknown;try{record=JSON.parse(text);}catch{throw new PreviewError('Ambiguous owned backend PID record.');}
  const {pid,starttime}=(record??{}) as Record<string,unknown>;
  if(typeof record!=='object'||Array.isArray(record)||Object.keys(record as object).sort().join()!=='pid,starttime'||!Number.isSafeInteger(pid)||(pid as number)<1||!Number.isSafeInteger(starttime)||(starttime as number)<0)throw new PreviewError('Ambiguous owned backend PID record.');
  return {pid:pid as number,starttime:starttime as number};
}
async function alive(record:PidRecord):Promise<BackendIdentity|undefined>{
  const stat=await processStat(record.pid);if(!stat||stat.state==='Z'||stat.state==='X'||(record.starttime!==undefined&&stat.starttime!==record.starttime))return;
  return {pid:record.pid,starttime:stat.starttime};
}
async function ownedPid(config:ServiceConfig):Promise<BackendIdentity|undefined>{
  const record=await readPidRecord(config.pidfile);const identity=record&&await alive(record);if(!identity)return;
  const expected=`--spring.datasource.url=jdbc:h2:file:${config.database.replace(/\.mv\.db$/,'')};MODE=MySQL`;
  let owned:boolean;
  try{const command=(await readFile(`/proc/${identity.pid}/cmdline`)).toString().split('\0');owned=command.includes(config.jar)&&command.includes(expected)&&await realpath(`/proc/${identity.pid}/cwd`)===await realpath(config.cwd);}
  catch(error:unknown){if(!missing(error))throw error;owned=false;}
  if(!owned){if(!await alive(identity))return;throw new PreviewError('Backend ownership mismatch; no process was signalled.');}
  return identity;
}
async function writePidRecord(pidfile:string,identity:BackendIdentity):Promise<void>{
  const temporary=join(dirname(pidfile),`.${basename(pidfile)}.${process.pid}.${randomUUID()}.tmp`);
  try{await writeFile(temporary,JSON.stringify(identity),{mode:0o600,flag:'wx'});await rename(temporary,pidfile);}
  finally{await rm(temporary,{force:true});}
}
export async function service(file:string,action:string):Promise<void>{
  const config=configRecord(await readRecord(file));const owned=await ownedPid(config);const pid=owned?.pid;
  if(action==='identity')console.log(config.database);
  else if(action==='status')console.log(pid?'running':'stopped');
  else if(action==='released')console.log(spawnSync('fuser',[config.database],{stdio:'ignore'}).status===1?'released':'locked');
  else if(action==='ready'){
    if(!pid)throw new PreviewError('Owned backend is not running.');
    const response=await fetch(`http://127.0.0.1:${config.port}/api/actuator/health/readiness`,{redirect:'manual',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new PreviewError('Owned backend readiness failed.');
    console.log(object(await response.json()).status==='UP'?'ready':'not-ready');
  }else if(action==='stop'){
    if(!owned)return;process.kill(owned.pid,'SIGTERM');
    for(let attempt=0;attempt<600;attempt++){if(!await alive(owned))return;await delay(100);}
    throw new PreviewError('Owned backend did not stop; no force kill was used.');
  }else if(action==='start'){
    if(pid)return;const env={...process.env};
    if(config.environmentFile){const record=await readRecord(config.environmentFile);for(const [key,value]of Object.entries(object(record.environment))){if(typeof value!=='string')throw new PreviewError('Invalid private service environment.');env[key]=value;}}
    const database=config.database.replace(/\.mv\.db$/,'');
    const args=['-Xmx384m','-jar',config.jar,'--spring.profiles.active=dev','--server.address=127.0.0.1',`--server.port=${config.port}`,'--server.servlet.context-path=/api',`--spring.datasource.url=jdbc:h2:file:${database};MODE=MySQL`,'--spring.mail.host=127.0.0.1','--spring.mail.port=9',`--rede.cors.allowed-origins=http://localhost:${config.port}`,`--rede.origins.trusted=http://localhost:${config.port}`,'--rede.jobs.import.jobradar.enabled=false','--rede.jobs.import.external-listing-enabled=false','--rede.jobs.import.external-refresh-enabled=false','--rede.emotes.refresh-enabled=false','--rede.github.sync-enabled=false','--rede.github.sync-on-link-enabled=false','--rede.linkedin.contact-invites.worker-enabled=false','--rede.moderation.ai.triage-enabled=false','--rede.moderation.ai.auto-penalty-enabled=false','--rede.media.migration.enabled=false'];
    await privateDir(dirname(config.log));const log=await open(config.log,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
    try{
      const child=spawn('java',args,{cwd:config.cwd,env,detached:true,stdio:['ignore',log.fd,log.fd]});
      await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      if(!child.pid)throw new PreviewError('Owned backend did not start.');child.unref();
      const started=await alive({pid:child.pid});if(!started)throw new PreviewError('Owned backend exited; inspect its private log.');await writePidRecord(config.pidfile,started);
    }finally{await log.close();}
    await delay(2000);if(!await ownedPid(config))throw new PreviewError('Owned backend exited; inspect its private log.');
  }else throw new PreviewError('Unknown owned backend action.');
}
if(await invokedDirectly(import.meta.url)){
  try{if(!process.argv[2]||!process.argv[3]||process.argv.length!==4)throw new PreviewError('Usage: node dist/preview/service.js PRIVATE_CONFIG ACTION');await service(process.argv[2],process.argv[3]);}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Owned backend operation failed; inspect private service diagnostics.');process.exitCode=1;}
}

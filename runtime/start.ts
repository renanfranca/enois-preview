import { spawn } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { object } from '../shared/records.js';
import { invokedDirectly } from './entry.js';

const root=fileURLToPath(new URL('../',import.meta.url));
function origin(value:string|undefined):string{
  if(!value)throw new Error('Set DEMO_PUBLIC_ORIGIN');const url=new URL(value);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid public origin');
  return url.origin;
}
export async function start(args:string[]=process.argv.slice(2)):Promise<number>{
  const {values}=parseArgs({args,options:{daemon:{type:'boolean'},slug:{type:'string'},origin:{type:'string'}}});
  const publicOrigin=origin(values.origin??process.env.DEMO_PUBLIC_ORIGIN);
  const slug=values.slug??process.env.DEMO_SLUG;if(slug!==undefined&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid scenario slug');
  if(!process.env.REDE_SECURITY_ENCRYPTION_KEY)throw new Error('Set REDE_SECURITY_ENCRYPTION_KEY');
  const env:NodeJS.ProcessEnv={...process.env,DEMO_PUBLIC_ORIGIN:publicOrigin,DEMO_WORKER_URL:publicOrigin,DEMO_MEDIA_WRITABLE:'true',...(slug?{DEMO_SLUG:slug}:{}),CODESPACE_PORT_FORWARDING_DOMAIN:process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN??process.env.CODESPACE_PORT_FORWARDING_DOMAIN??''};
  if(values.daemon){
    const log=await open('/tmp/enois-demo.log',constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
    try{
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url)],{env,detached:true,stdio:['ignore',log.fd,log.fd]});
      await new Promise<void>((done,reject)=>{child.once('spawn',done);child.once('error',reject);});child.unref();return 0;
    }finally{await log.close();}
  }
  const children:{child:ReturnType<typeof spawn>;done:Promise<number>}[]=[];let stopping=false;
  const stop=()=>{stopping=true;for(const {child}of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
  const hangup=()=>{};process.on('SIGHUP',hangup);process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const launch=(executable:string,arguments_:string[],environment=env)=>{
    const child=spawn(executable,arguments_,{env:environment,stdio:'inherit'});
    const done=new Promise<number>(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
    const owned={child,done};children.push(owned);return owned;
  };
  try{
    await mkdir('/tmp/rede-db',{recursive:true,mode:0o700});
    await copyFile(join(root,'seed/rede.mv.db'),'/tmp/rede-db/rede.mv.db');await chmod('/tmp/rede-db/rede.mv.db',0o600);
    for(const file of ['/tmp/rede-db/rede.trace.db','/tmp/rede-db/rede.lock.db','/tmp/demo-uploads','/tmp/demo-media'])await rm(file,{recursive:true,force:true});
    await mkdir('/tmp/demo-media',{mode:0o700});await cp(join(root,'media'),'/tmp/demo-media',{recursive:true});
    const credentials=launch('java',['-cp',`${join(root,'tools')}:${join(root,'backend/lib/*')}`,'DemoCredentials']);
    if(await credentials.done!==0||stopping)throw new Error('Credential preparation failed');
    const backend=launch('java',['--enable-native-access=ALL-UNNAMED','-XX:ActiveProcessorCount=1','-Xms48m','-Xmx768m','-Xss512k','-XX:MaxMetaspaceSize=160m','-XX:ReservedCodeCacheSize=32m','-XX:MaxDirectMemorySize=16m','-XX:+UseSerialGC','-Denois.preview.demo=true','-jar',join(root,'backend/rede.jar'),'--spring.profiles.active=demo','--server.address=127.0.0.1','--server.port=8081']);
    const deadline=performance.now()+600000;let ready=false;
    while(!stopping&&performance.now()<deadline){
      if(backend.child.exitCode!==null||backend.child.signalCode!==null)throw new Error('Backend exited before readiness');
      try{const response=await fetch('http://127.0.0.1:8081/api/actuator/health/readiness',{redirect:'manual',signal:AbortSignal.timeout(2000)});if(response.ok&&object(await response.json()).status==='UP'){ready=true;break;}}catch{}
      await delay(250);
    }
    if(!ready||stopping)throw new Error('Backend did not become ready');
    const frontend=launch(process.execPath,['--max-old-space-size=256',join(root,'frontend/server/index.mjs')],{...env,HOST:'0.0.0.0',NITRO_HOST:'0.0.0.0',NITRO_PORT:'3001',PORT:'3001',BACKEND_TARGET:'http://127.0.0.1:8081'});
    const gateway=launch(process.execPath,[join(root,'runtime/gateway.js')]);
    const monitored=[backend.done,frontend.done,gateway.done];
    if(env.CODESPACES==='true'){
      const registration=launch(process.execPath,[join(root,'runtime/register-codespace.js')]);
      monitored.push(new Promise<number>(resolve=>{void registration.done.then(code=>{if(code!==0)resolve(code);});}));
    }
    const result=await Promise.race(monitored);return stopping?0:result===0?1:result;
  }finally{
    stop();const timer=setTimeout(()=>{for(const {child}of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},10000);timer.unref();
    await Promise.all(children.map(item=>item.done));clearTimeout(timer);
    process.removeListener('SIGHUP',hangup);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  }
}
if(await invokedDirectly(import.meta.url)){try{process.exitCode=await start();}catch{console.error('Demo startup failed; inspect private runtime diagnostics and configured environment.');process.exitCode=1;}}

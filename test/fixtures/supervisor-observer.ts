import { readFileSync,readdirSync } from 'node:fs';
const owned:{pid:number;role:string}[]=[];let supervisor:number|undefined;
for(const entry of readdirSync('/proc')){
  if(!/^\d+$/.test(entry))continue;
  try{
    const args=readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0');
    const role=args.includes('/opt/render-demo/runtime/start.js')?'supervisor':args.includes('/opt/render-demo/backend/rede.jar')?'backend':args.includes('/opt/render-demo/frontend/server/index.mjs')?'frontend':args.includes('/opt/render-demo/runtime/gateway.js')?'gateway':undefined;
    if(role){owned.push({pid:Number(entry),role});if(role==='supervisor')supervisor=Number(entry);}
  }catch{}
}
let selected:Record<string,string|undefined>={};
if(supervisor){
  const env=Object.fromEntries(readFileSync(`/proc/${supervisor}/environ`,'utf8').split('\0').filter(Boolean).map(pair=>{const at=pair.indexOf('=');return [pair.slice(0,at),pair.slice(at+1)];}));
  selected=Object.fromEntries(['DEMO_SLUG','DEMO_PUBLIC_ORIGIN','DEMO_WORKER_URL','CODESPACE_PORT_FORWARDING_DOMAIN'].map(key=>[key,env[key]]));
  if(process.argv[2]==='hup')process.kill(supervisor,'SIGHUP');else if(process.argv[2]==='stop')process.kill(supervisor,'SIGTERM');
}
console.log(JSON.stringify({owned,selected}));

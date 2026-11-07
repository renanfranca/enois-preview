import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { credentials } from '../src/contracts.js';

export async function register():Promise<void>{
  for(const key of ['DEMO_WORKER_URL','DEMO_CALLBACK_SECRET','CODESPACE_NAME','GITHUB_TOKEN','CODESPACE_PORT_FORWARDING_DOMAIN','DEMO_SLUG'])if(!process.env[key])throw new Error(`Missing ${key}`);
  const origin=new URL(process.env.DEMO_WORKER_URL??'');
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Invalid Worker origin');
  const access=credentials(JSON.parse(await readFile('/tmp/demo-credentials.json','utf8')));
  for(let attempt=0;attempt<30;attempt++){
    try{
      const response=await fetch(new URL('/__demo/register',origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${process.env.DEMO_CALLBACK_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({slug:process.env.DEMO_SLUG,name:process.env.CODESPACE_NAME,domain:process.env.CODESPACE_PORT_FORWARDING_DOMAIN,portToken:process.env.GITHUB_TOKEN,credentials:access})});
      await response.body?.cancel();if(response.ok){console.log('Demo private port registered');return;}if([401,403,404].includes(response.status))break;
    }catch{}
    await delay(5000);
  }
  throw new Error('Private port registration failed');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await register();}catch{console.error('Private port registration failed; inspect configured startup environment.');process.exitCode=1;}}

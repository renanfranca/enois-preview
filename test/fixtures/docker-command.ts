#!/usr/bin/env node
import { appendFileSync, cpSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
const root=process.env.FIXTURE_PLATFORM_ROOT;
if(!root)throw new Error('Missing fixture platform root');
const file=join(root,'platform.json');
const platform: { revision:string; pushes:number; present:boolean }=JSON.parse(readFileSync(file,'utf8'));
const args=process.argv.slice(2);
appendFileSync(join(root,'docker-calls.log'),`${args[0]}\n`);
if(process.env.FIXTURE_DOCKER_HOLD&&['create','run'].includes(args[0]??'')){
  const name=args[args.indexOf('--name')+1]??'fixture-container';
  writeFileSync(join(root,'resource.json'),JSON.stringify({pid:process.pid,name,command:args[0]}));
  await new Promise(()=>{setInterval(()=>{},1000);});
}
if(args[0]==='rm'&&existsSync(join(root,'resource.json'))){
  const resource=JSON.parse(readFileSync(join(root,'resource.json'),'utf8'));
  if(args.at(-1)!==resource.name)throw new Error('Cleanup targeted another resource');
  unlinkSync(join(root,'resource.json'));
}
if(args[0]==='inspect')console.log(JSON.stringify([{State:{Running:false,ExitCode:137,OOMKilled:false,Error:''}}]));
else if(['logs','diff'].includes(args[0]??'')){}
else if(args[0]==='push') {
  platform.present=true;platform.pushes++;writeFileSync(file,JSON.stringify(platform));
  const marker=join(root,'lose-registry-ack');
  if(existsSync(marker)){unlinkSync(marker);process.exit(42);}
} else if(args[0]==='image' && args[1]==='inspect') console.log(JSON.stringify([{Id:`sha256:${'c'.repeat(64)}`,Config:{Labels:{'io.enois.preview.revision':platform.revision}}}]));
else if(args[0]==='create')console.log('fixture-container');
else if(args[0]==='cp') {
  const source=args[1];const destination=args[2];if(!source||!destination)throw new Error('Missing copy operands');
  cpSync(join(root,'image',basename(source)),destination,{recursive:true});
} else if(!['pull','tag','rm'].includes(args[0]??''))throw new Error('Unexpected fixture Docker command');

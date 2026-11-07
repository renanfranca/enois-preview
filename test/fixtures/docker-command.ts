#!/usr/bin/env node
import { appendFileSync, cpSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
const root=process.env.FIXTURE_PLATFORM_ROOT;
if(!root)throw new Error('Missing fixture platform root');
const file=join(root,'platform.json');
const platform: { revision:string; pushes:number; present:boolean }=JSON.parse(readFileSync(file,'utf8'));
const args=process.argv.slice(2);
appendFileSync(join(root,'docker-calls.log'),`${args[0]}\n`);
if(args[0]==='push') {
  platform.present=true;platform.pushes++;writeFileSync(file,JSON.stringify(platform));
  const marker=join(root,'lose-registry-ack');
  if(existsSync(marker)){unlinkSync(marker);process.exit(42);}
} else if(args[0]==='image' && args[1]==='inspect') console.log(JSON.stringify([{Id:`sha256:${'c'.repeat(64)}`,Config:{Labels:{'io.enois.preview.revision':platform.revision}}}]));
else if(args[0]==='create')console.log('fixture-container');
else if(args[0]==='cp') {
  const source=args[1];const destination=args[2];if(!source||!destination)throw new Error('Missing copy operands');
  cpSync(join(root,'image',basename(source)),destination,{recursive:true});
} else if(!['pull','tag','rm'].includes(args[0]??''))throw new Error('Unexpected fixture Docker command');

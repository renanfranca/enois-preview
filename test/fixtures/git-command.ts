#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.some(value => value.startsWith('--force'))) throw new Error('Force pushes are forbidden');
const result = spawnSync('/usr/bin/git', args, { stdio: 'inherit' });
const marker = process.env.FIXTURE_LOST_GIT_ACK;
const cwdIndex=args.indexOf('-C');
const message=args.includes('push')&&cwdIndex>=0?spawnSync('/usr/bin/git',['-C',args[cwdIndex+1]??'', 'log','-1','--format=%s'],{encoding:'utf8'}).stdout:'';
const stage=message.includes('configuration')?'configuration':'catalog';
if(args.includes('push')&&result.status===0&&marker&&existsSync(marker)&&readFileSync(marker,'utf8')===`interrupt-${stage}`){
  writeFileSync(marker+'.accepted',JSON.stringify({stage,pid:process.pid,cli:process.ppid}));
  await new Promise(()=>{setInterval(()=>{},1000);});
}
if (args.includes('push') && result.status === 0 && marker && existsSync(marker) && readFileSync(marker,'utf8')===stage) {
  const log = process.env.FIXTURE_GIT_PUSH_LOG;
  if (log) appendFileSync(log, `${readFileSync(marker,'utf8')}\n`);
  unlinkSync(marker); process.exit(42);
}
process.exit(result.status ?? 1);

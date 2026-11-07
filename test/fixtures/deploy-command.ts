#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
const root=process.env.FIXTURE_PLATFORM_ROOT;if(!root)throw new Error('Missing fixture platform root');
const file=join(root,'platform.json');
const state: {deploys:number;deployed:unknown}=JSON.parse(readFileSync(file,'utf8'));
const args=process.argv.slice(2);
if(basename(process.argv[1]??'')==='npm')process.exit(0);
if(args.includes('deploy')){
  state.deploys++;
  const raw=readFileSync(join(process.cwd(),'catalog/scenarios.json'),'utf8').trim();
  const catalog:{scenarios:Record<string,unknown>}=JSON.parse(raw);
  state.deployed={...(Object.values(catalog.scenarios)[0] as object),catalogSha256:createHash('sha256').update(raw).digest('hex')};
  writeFileSync(file,JSON.stringify(state));
  const marker=join(root,'lose-deploy-ack');if(existsSync(marker)){unlinkSync(marker);process.exit(42);}
}else if(args.includes('deployments')&&args.includes('list'))console.log(JSON.stringify([
  {id:'older',versions:[{version_id:'old-version',percentage:100}],created_on:'2026-11-06T10:00:00.1234567Z'},
  {id:'newer',versions:[{version_id:'new-version',percentage:100}],created_on:'2026-11-06T10:00:00.1234568Z'}
]));
else throw new Error('Unexpected fixture Wrangler command');

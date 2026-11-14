#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const executable = basename(process.argv[1] ?? '');
if (process.env.FIXTURE_PREFLIGHT_LOG) appendFileSync(process.env.FIXTURE_PREFLIGHT_LOG, `${executable} ${process.argv.slice(2).join(' ')}\n`);
if(executable==='fuser'&&process.env.FIXTURE_FUSER_BARRIER){
  // Pauses until BARRIER.release exists, then reports the file as not in use (exit 1, like fuser).
  const barrier=process.env.FIXTURE_FUSER_BARRIER;writeFileSync(barrier,String(process.pid));
  await new Promise<void>(done=>{const timer=setInterval(()=>{if(existsSync(`${barrier}.release`)){clearInterval(timer);done();}},10);});
  process.exit(1);
}
if (executable === 'gh') {
  const endpoint = process.argv[3] ?? '';
  if (endpoint.startsWith('repos/')) console.log(JSON.stringify({ private: true, permissions: { push: true } }));
  else if (endpoint.startsWith('users/') && !endpoint.includes('/packages/')) console.log('{"type":"User"}');
  else console.log('{"visibility":"private"}');
}

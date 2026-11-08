import {spawn} from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2]; const action = process.argv[3];
if (!root || !action) throw new Error('Fixture service arguments missing');
appendFileSync(join(root, 'events'), `${action}\n`);
const flag = join(root, 'status');
if (action === 'status') console.log(readFileSync(flag, 'utf8'));
else if (action === 'identity') {
  if(existsSync(join(root,'paused'))&&existsSync(join(root,'hold-restore'))){
    writeFileSync(join(root,'restore-paused'),String(process.pid));
    const deadline=Date.now()+15000;
    while(existsSync(join(root,'hold-restore'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  }
  console.log('fixture-backend');
}
else if(action==='finish-stop'){
  writeFileSync(join(root,'stop-worker.pid'),String(process.pid));
  while(!existsSync(join(root,'finish-stop')))await new Promise(resolve=>setTimeout(resolve,10));
  writeFileSync(flag,'stopped');unlinkSync(join(root,'stop-pending'));
}
else if(action==='stop'){
  if(existsSync(join(root,'hold-stop'))){
    if(!existsSync(join(root,'stop-pending'))){writeFileSync(join(root,'stop-pending'),'accepted');const child=spawn(process.execPath,[process.argv[1]!,root,'finish-stop'],{detached:true,stdio:'ignore'});child.unref();}
    else writeFileSync(join(root,'stop-draining'),String(process.pid));
    writeFileSync(join(root,'stop-paused'),String(process.pid));
    while(readFileSync(flag,'utf8')!=='stopped')await new Promise(resolve=>setTimeout(resolve,10));
  }else writeFileSync(flag,'stopped');
}
else if (action === 'start') { if (existsSync(join(root, 'fail-start'))) process.exit(1); writeFileSync(flag, 'running'); }
else if (action === 'ready') {
  if(existsSync(join(root,'hold-ready'))){writeFileSync(join(root,'ready-paused'),String(process.pid));const deadline=Date.now()+15000;while(existsSync(join(root,'hold-ready'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));}
  console.log(readFileSync(flag, 'utf8') === 'running' ? 'ready' : 'not-ready');
}
else if (action === 'released') {
  if(existsSync(join(root,'late-release'))){process.on('SIGTERM',()=>{});await new Promise(resolve=>setTimeout(resolve,800));}
  if (existsSync(join(root, 'hold-release'))) {
    writeFileSync(join(root, 'paused'), String(process.pid));
    const deadline = Date.now() + 30_000;
    while (existsSync(join(root, 'hold-release')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  }
  console.log('released');
}

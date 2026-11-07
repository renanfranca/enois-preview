import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2]; const action = process.argv[3];
if (!root || !action) throw new Error('Fixture service arguments missing');
appendFileSync(join(root, 'events'), `${action}\n`);
const flag = join(root, 'status');
if (action === 'status') console.log(readFileSync(flag, 'utf8'));
else if (action === 'identity') console.log('fixture-backend');
else if (action === 'stop') writeFileSync(flag, 'stopped');
else if (action === 'start') { if (existsSync(join(root, 'fail-start'))) process.exit(1); writeFileSync(flag, 'running'); }
else if (action === 'ready') console.log(readFileSync(flag, 'utf8') === 'running' ? 'ready' : 'not-ready');
else if (action === 'released') {
  if(existsSync(join(root,'late-release'))){process.on('SIGTERM',()=>{});await new Promise(resolve=>setTimeout(resolve,800));}
  if (existsSync(join(root, 'hold-release'))) {
    writeFileSync(join(root, 'paused'), String(process.pid));
    const deadline = Date.now() + 30_000;
    while (existsSync(join(root, 'hold-release')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  }
  console.log('released');
}

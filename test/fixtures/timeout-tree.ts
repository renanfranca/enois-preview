import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root=process.argv[2]!, role=process.argv[3]!;
const file=(name:string)=>join(root,name);
if(role==='independent'){
  const server=createServer((_request,response)=>response.end('independent ready'));
  server.listen(0,'127.0.0.1',()=>{
    const address=server.address();
    if(!address||typeof address==='string')throw new Error('Missing fixture address');
    writeFileSync(file('independent.json'),JSON.stringify({pid:process.pid,port:address.port}));
  });
}else if(role==='child'||role==='grandchild'){
  writeFileSync(file(role+'.pid'),String(process.pid));
  if(role==='child')spawn(process.execPath,[process.argv[1]!,root,'grandchild'],{stdio:'inherit'});
  await delay(2500);
  writeFileSync(file(role+'.effect'),'late effect');
}else{
  if(role==='stop')writeFileSync(file('status'),'stopped');
  const independent=spawn(process.execPath,[process.argv[1]!,root,'independent'],{detached:true,stdio:'ignore'});
  independent.unref();
  spawn(process.execPath,[process.argv[1]!,root,'child'],{stdio:'inherit'});
  const deadline=Date.now()+5000;
  while(!['child.pid','grandchild.pid','independent.json'].every(name=>existsSync(file(name)))){
    if(Date.now()>deadline)throw new Error('Descendants did not start');
    await delay(10);
  }
  const pids=['child','grandchild'].map(name=>Number(readFileSync(file(name+'.pid'),'utf8')));
  for(const pid of pids)process.kill(pid,0);
  writeFileSync(file('observed.json'),JSON.stringify({parent:process.pid,child:pids[0],grandchild:pids[1],bothAlive:true}));
  console.log('descendants confirmed active');
  while(!['child.effect','grandchild.effect'].every(name=>existsSync(file(name))))await delay(10);
}

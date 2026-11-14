import { workspace, git } from './fixtures/workspace.js';
import { fixture as h2Fixture } from './fixtures/h2.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

test('installed CLI explains setup, frozen publication and resume through Node without Python', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-cli-'));
  try {
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', directory, '--json'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const archive: unknown = JSON.parse(packed.stdout);
    assert.ok(Array.isArray(archive) && archive[0] && typeof archive[0].filename === 'string');
    const files=archive[0].files as {path:string}[];
    assert.ok(files.some(file=>file.path==='dist/preview/cli.js'));
    assert.ok(files.some(file=>file.path==='preview/cli.ts'));
    assert.ok(files.some(file=>file.path==='.nvmrc'));
    assert.deepEqual(files.filter(file=>file.path==='EXECPLAN.md'||file.path.startsWith('.agent/')||/\.(?:py|mjs|sh)$/.test(file.path)),[],'Distribute TypeScript and generated JavaScript without historical automation or private execution documents');
    const install = spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefix', directory, join(directory, archive[0].filename)], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    const installed=join(directory,'node_modules/enois-preview');
    assert.deepEqual(JSON.parse(readFileSync(join(installed,'package.json'),'utf8')).engines,{node:'>=24 <25'});
    assert.equal(readFileSync(join(installed,'.nvmrc'),'utf8'),'24\n');
    mkdirSync(join(directory, 'bin'));
    symlinkSync(process.execPath, join(directory, 'bin/node'));

    const result = spawnSync(join(directory,'node_modules/.bin/enois-preview'), ['--help'], { encoding: 'utf8', env: { ...process.env, PATH: join(directory, 'bin') } });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /enois-preview/);
    assert.match(result.stdout, /setup/);
    assert.match(result.stdout, /publish/);
    assert.match(result.stdout, /--refresh-data/);
    assert.match(result.stdout, /--accounts ID\[,ID\.\.\.\]/);
    assert.match(result.stdout, /--force-lease/);
    assert.match(result.stdout, /warnings: \[\{code, message\}\]/);
    assert.match(result.stdout, /resume/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the declared CLI executable remains usable through a launcher symlink after an explicit build',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-rebuilt-bin-'));
  try{
    const pkg=JSON.parse(readFileSync('package.json','utf8')),binary=resolve(pkg.bin['enois-preview']);
    const link=join(directory,'enois-preview');symlinkSync(binary,link);mkdirSync(join(directory,'bin'));symlinkSync(process.execPath,join(directory,'bin/node'));

    const result=spawnSync(link,['--help'],{encoding:'utf8',env:{...process.env,PATH:join(directory,'bin')}});

    assert.equal(result.status,0,result.error?.message??result.stderr);assert.match(result.stdout,/enois-preview/);assert.match(result.stdout,/setup/);assert.match(result.stdout,/resume/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('legacy installation is refused before any mutation with fresh installation guidance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-legacy-'));
  try {
    const bytes = '{"schema":1,"secret":"private-sentinel"}\n';
    writeFileSync(join(directory, 'config.json'), bytes);

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', directory, 'setup'], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /enois-preview-ts-v1/);
    assert.match(result.stderr, /fresh installation/i);
    assert.doesNotMatch(result.stderr, /private-sentinel/);
    assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), bytes);
    assert.deepEqual(readdirSync(directory), ['config.json']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function controlledInfrastructure(directory:string):string{
  const bin=join(directory,'bin');mkdirSync(bin,{recursive:true});
  for(const executable of ['gh','docker','npx'])if(!existsSync(join(bin,executable)))symlinkSync(resolve('dist/test/fixtures/infrastructure.js'),join(bin,executable));
  chmodSync(resolve('dist/test/fixtures/infrastructure.js'),0o755);return bin;
}
/** A PATH whose `docker` runs the timeout tree fixture in ROOT, so setup preflight has live descendants to interrupt. */
function slowDocker(directory:string,root:string):string{
  const bin=join(root,'slow-bin');mkdirSync(bin,{recursive:true});
  for(const executable of ['gh','npx'])symlinkSync(resolve('dist/test/fixtures/infrastructure.js'),join(bin,executable));chmodSync(resolve('dist/test/fixtures/infrastructure.js'),0o755);
  writeFileSync(join(bin,'docker'),`#!/bin/sh\nexec '${process.execPath}' '${resolve('dist/test/fixtures/timeout-tree.js')}' '${root}' identity\n`,{mode:0o755});
  return `${bin}:${join(directory,'bin')}:${process.env.PATH??''}`;
}

test('noninteractive setup prints the free plan warning, preserves private values and writes no installation record', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-repeat-'));
  try {
    const config = { ...workspace(directory), privateCredentialStore: 'fixture-reference-only' };
    writeFileSync(config.database, 'fictional'); writeFileSync(config.h2Jar, 'fixture');
    const home = join(directory, 'home'); mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    const input = join(directory, 'input.json'); writeFileSync(input, JSON.stringify({ format: 'enois-preview-ts-v1', repository: 'fixture/launcher' }));
    const bin = controlledInfrastructure(directory);
    const log = join(directory, 'preflight.log');

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'setup', '--config', input], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FIXTURE_PREFLIGHT_LOG: log } });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'configured');
    assert.deepEqual(report.warnings.map((warning: { code: string }) => warning.code), ['ignored-config-fields', 'free-plan']);
    assert.equal(report.warnings[0].message, 'Configuration fields no longer used are ignored and preserved: privateCredentialStore.');
    assert.match(result.stderr, /^warning: Keep GitHub Free and Cloudflare Workers Free/m);
    const stored = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    assert.deepEqual(stored, config); assert.equal(Object.hasOwn(stored, 'installation'), false);
    const commands = readFileSync(log, 'utf8');
    assert.match(commands, /docker info/);
    assert.match(commands, /gh api repos\/fixture\/launcher/);
    assert.match(commands, /npx --no-install wrangler whoami/);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-reference-only/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('setup refuses private state reached through an application directory alias before preflight or writes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-state-location-'));
  try{
    const base=workspace(directory);const backend=base.repositories['enois-backend'];assert.ok(backend);
    const alias=join(directory,'alias');symlinkSync(backend,alias,'dir');
    const config={...base,state:join(alias,'private-state')};const input=join(directory,'input.json');writeFileSync(input,JSON.stringify(config));
    const home=join(directory,'home');mkdirSync(home);const file=join(home,'config.json');const before=JSON.stringify(base);writeFileSync(file,before);

    const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,'setup','--config',input],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/Private state must be outside application repositories/);
    assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(config.state),false);assert.deepEqual(readdirSync(home),['config.json']);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('install refuses anything but a full public commit before downloading or reading private configuration',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-install-command-'));
  try{
    for(const commit of ['main','v0.3.8','a'.repeat(39),'A'.repeat(40)]){
      const result=spawnSync(process.execPath,['dist/preview/cli.js','install',commit],{encoding:'utf8',env:{...process.env,HOME:directory,ENOIS_PREVIEW_HOME:join(directory,'absent')}});

      assert.equal(result.status,1,commit);assert.equal(result.stderr,'Installation incomplete: Install requires the full 40 character public tool commit.\n');assert.equal(result.stdout,'');
      assert.deepEqual(readdirSync(directory),[]);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('publish and resume before setup name the missing configuration and create nothing',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-before-setup-'));
  try{
    for(const args of [['publish','fixture'],['publish','fixture','--refresh-data'],['resume','a'.repeat(64)]]){
      const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',join(directory,'home'),...args],{encoding:'utf8'});

      assert.equal(result.status,1,args.join(' '));assert.equal(result.stderr,'Publication incomplete: Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.\n');assert.equal(result.stdout,'');
      assert.deepEqual(readdirSync(directory),[]);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('invalid command arguments are refused before service recovery or publication writes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-arguments-'));
  try{
    const config=workspace(directory);const home=join(directory,'home');mkdirSync(home);
    const file=join(home,'config.json');const before=JSON.stringify(config);writeFileSync(file,before);
    for(const args of [['setup','extra'],['setup','--refresh-data'],['setup','--accounts','author'],['setup','--force-lease'],['resume','a'.repeat(64),'--accounts','author'],['source-digest','--force-lease'],['install','a'.repeat(40),'--accounts','author'],['publish'],['publish','fixture','extra'],['publish','fixture','--config',file],['resume'],['resume','a'.repeat(64),'extra'],['resume','a'.repeat(64),'--refresh-data'],['install'],['install','a'.repeat(40),'extra'],['install','a'.repeat(40),'--refresh-data'],['install','a'.repeat(40),'--config',file]]){
      const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,...args],{encoding:'utf8'});

      assert.equal(result.status,1);assert.match(result.stderr,/Invalid command arguments.*--help/,args.join(' '));
      assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(config.state),false);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('historical scenario pointers and operation journals are refused by the CLI before creating locks or changing records',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-historical-state-'));
  try{
    const config=workspace(directory);const home=join(directory,'home');mkdirSync(home);writeFileSync(join(home,'config.json'),JSON.stringify(config));
    const revision='a'.repeat(64);mkdirSync(join(config.state,'scenarios'),{recursive:true});mkdirSync(join(config.state,'operations',revision),{recursive:true});
    const pointer=join(config.state,'scenarios/fixture.json');const journal=join(config.state,'operations',revision,'journal.json');
    const original='{"schema":3,"data":"historical-private-fixture"}\n';writeFileSync(pointer,original);writeFileSync(journal,original);
    const before=readdirSync(config.state,{recursive:true}).sort();
    for(const args of [['publish','fixture'],['resume',revision]]){

      const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,...args],{encoding:'utf8'});

      assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
      assert.doesNotMatch(result.stderr,/historical-private-fixture/);assert.equal(readFileSync(pointer,'utf8'),original);assert.equal(readFileSync(journal,'utf8'),original);
      assert.deepEqual(readdirSync(config.state,{recursive:true}).sort(),before);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});


test('setup interruption terminates active descendants and prevents later installation writes',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-interrupted-setup-'));
  const roots:string[]=[];
  try{
    const base=workspace(directory);writeFileSync(base.database,'fictional');writeFileSync(base.h2Jar,'fixture');
    for(const signal of [undefined,'SIGINT','SIGTERM'] as const){
      const root=join(directory,signal??'control');mkdirSync(root);roots.push(root);
      const home=join(root,'home'),input=join(root,'input.json');
      writeFileSync(input,JSON.stringify(base));
      const args=[process.execPath,resolve('dist/preview/cli.js'),'--home',home,'setup','--config',input];
      const command='exec '+args.map(value=>"'"+value.replaceAll("'","'\\''")+"'").join(' ');
      const child=spawn('script',['--return','--quiet','--command',command,'/dev/null'],{env:{...process.env,PATH:slowDocker(directory,root)},stdio:['pipe','pipe','pipe']});
      let output='';const receive=(data:Buffer)=>{output+=String(data);};child.stdout.on('data',receive);child.stderr.on('data',receive);
      const completed=new Promise<number|null>((done,reject)=>{child.on('error',reject);child.on('close',done);});
      const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
      try{
        const deadline=Date.now()+10000;
        while(!existsSync(join(root,'observed.json'))&&Date.now()<deadline)await delay(10);
        assert.ok(existsSync(join(root,'observed.json')),output);
        const observed=JSON.parse(readFileSync(join(root,'observed.json'),'utf8'));
        assert.equal(observed.bothAlive,true);process.kill(observed.child,0);process.kill(observed.grandchild,0);
        if(signal==='SIGINT')child.stdin.write('\x03');
        else if(signal)process.kill(observed.cli,signal);

        const code=await completed;
        await delay(2800);

        assert.equal(code,signal==='SIGINT'?130:signal==='SIGTERM'?143:0,output);
        if(signal)for(const pid of [observed.parent,observed.child,observed.grandchild]){
          const stat=`/proc/${pid}/stat`;if(existsSync(stat))assert.match(readFileSync(stat,'utf8'),/^\d+ \(.*\) [ZX] /s,'owned command and descendants must have terminated');
        }
        assert.equal(existsSync(join(root,'child.effect')),!signal,'child delayed effect');
        assert.equal(existsSync(join(root,'grandchild.effect')),!signal,'grandchild delayed effect');
        assert.equal(existsSync(join(home,'config.json')),!signal,'installation must not be written after interruption');
        if(signal){assert.match(output,/interrupt/i);assert.doesNotMatch(output,/"configured"/);}
        const independent=JSON.parse(readFileSync(join(root,'independent.json'),'utf8'));
        assert.equal(await(await fetch(`http://127.0.0.1:${independent.port}`)).text(),'independent ready');
        if(process.env.ENOIS_PREVIEW_EVIDENCE)writeFileSync(join(process.env.ENOIS_PREVIEW_EVIDENCE,`setup-${signal??'control'}.json`),JSON.stringify({signal:signal??null,code,observed,childEffect:existsSync(join(root,'child.effect')),grandchildEffect:existsSync(join(root,'grandchild.effect')),installationWritten:existsSync(join(home,'config.json')),independentReady:true,output})+'\n');
      }finally{clearTimeout(timer);child.kill('SIGKILL');}
    }
  }finally{
    for(const root of roots){
      if(existsSync(join(root,'observed.json'))){const observed=JSON.parse(readFileSync(join(root,'observed.json'),'utf8'));try{process.kill(-observed.parent,'SIGKILL');}catch{}}
      if(existsSync(join(root,'independent.json'))){try{process.kill(JSON.parse(readFileSync(join(root,'independent.json'),'utf8')).pid,'SIGKILL');}catch{}}
    }
    rmSync(directory,{recursive:true,force:true});
  }
});


test('a cancelled main invocation preserves unrelated signal handlers and does not cancel the next setup in the same process',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-repeated-main-')),oldPath=process.env.PATH;
  const outsider=()=>{};process.on('SIGTERM',outsider);const handlers=process.listenerCount('SIGTERM');const interrupts=process.listenerCount('SIGINT');
  try{
    const base=workspace(directory);writeFileSync(base.database,'fictional');writeFileSync(base.h2Jar,'fixture');
    const home=join(directory,'home');mkdirSync(home);const file=join(home,'config.json');
    writeFileSync(file,JSON.stringify(base));
    controlledInfrastructure(directory);process.env.PATH=slowDocker(directory,directory);
    const {main}=await import('../preview/cli.js');const cancelled=main(['--home',home,'setup']);
    const deadline=Date.now()+5000;while(!existsSync(join(directory,'observed.json'))&&Date.now()<deadline)await delay(10);assert.ok(existsSync(join(directory,'observed.json')));
    process.emit('SIGTERM');assert.equal(await cancelled,143);
    assert.equal(process.listenerCount('SIGTERM'),handlers);assert.equal(process.listenerCount('SIGINT'),interrupts);assert.ok(process.listeners('SIGTERM').includes(outsider));
    process.env.PATH=`${join(directory,'bin')}:${oldPath??''}`;

    assert.equal(await main(['--home',home,'setup']),0);

    assert.equal(process.listenerCount('SIGTERM'),handlers);assert.equal(process.listenerCount('SIGINT'),interrupts);assert.ok(process.listeners('SIGTERM').includes(outsider));
  }finally{process.removeListener('SIGTERM',outsider);if(oldPath===undefined)delete process.env.PATH;else process.env.PATH=oldPath;if(existsSync(join(directory,'independent.json'))){try{process.kill(JSON.parse(readFileSync(join(directory,'independent.json'),'utf8')).pid,'SIGKILL');}catch{}}rmSync(directory,{recursive:true,force:true});}
});


type InstallProxy={address:string;tunnels:string[];tunnelled:Promise<void>;close:()=>Promise<void>};
async function installProxy(answer:'refuse'|'hold'):Promise<InstallProxy>{
  const tunnels:string[]=[],held:Socket[]=[];let tunnelled=()=>{};const first=new Promise<void>(done=>{tunnelled=done;});
  const proxy=createServer((_request,response)=>{response.writeHead(405).end();});
  proxy.on('connect',(request,socket:Socket)=>{tunnels.push(request.url??'');if(answer==='refuse')socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');else{held.push(socket);socket.on('error',()=>{});}tunnelled();});
  proxy.listen(0,'127.0.0.1');await new Promise(done=>proxy.once('listening',done));
  return {address:`http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,tunnels,tunnelled:first,close:async()=>{for(const socket of held)socket.destroy();await new Promise(done=>proxy.close(done));}};
}
function proxied(home:string,proxy:string):NodeJS.ProcessEnv{return {...process.env,HOME:home,NODE_USE_ENV_PROXY:'1',HTTPS_PROXY:proxy,https_proxy:proxy,NO_PROXY:'',no_proxy:''};}
type Finished={code:number|null;stdout:string;stderr:string};
function installing(commit:string,env:NodeJS.ProcessEnv):{child:ReturnType<typeof spawn>;finished:Promise<Finished>}{
  const child=spawn(process.execPath,[resolve('dist/preview/cli.js'),'install',commit],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});
  return {child,finished:new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));})};
}
function leftovers(home:string,commit:string):string[]{
  const prefix=join(home,'.local/share/enois-preview');
  return existsSync(prefix)?readdirSync(prefix).filter(name=>name===commit||name==='current'||name.startsWith('.staging-')):[];
}

test('enois-preview install without network explains that the download failed and installs nothing',async()=>{
  const home=mkdtempSync(join(tmpdir(),'enois-install-offline-'));const commit='b'.repeat(40);const proxy=await installProxy('refuse');
  try{
    const result=await installing(commit,proxied(home,proxy.address)).finished;

    assert.equal(result.code,1,result.stderr);
    assert.equal(result.stdout,'');
    assert.equal(result.stderr,`Installation incomplete: Download of https://codeload.github.com/renanfranca/enois-preview/tar.gz/${commit} failed; check the network connection and retry.\n`);
    assert.deepEqual(proxy.tunnels,['codeload.github.com:443']);
    assert.deepEqual(leftovers(home,commit),[]);
  }finally{await proxy.close();rmSync(home,{recursive:true,force:true});}
});

test('interrupting enois-preview install while the download is pending returns promptly with the signal code and leaves no partial installation',async()=>{
  const commit='b'.repeat(40);
  for(const signal of ['SIGINT','SIGTERM'] as const){
    const home=mkdtempSync(join(tmpdir(),'enois-install-interrupted-'));const proxy=await installProxy('hold');
    const {child,finished}=installing(commit,proxied(home,proxy.address));const timer=setTimeout(()=>child.kill('SIGKILL'),15_000);
    try{
      await proxy.tunnelled;
      child.kill(signal);

      const result=await Promise.race([finished,delay(10_000).then(()=>{child.kill('SIGKILL');return undefined;})]);

      assert.ok(result,`${signal} did not end the installation within 10 s`);
      assert.equal(result.code,signal==='SIGINT'?130:143,result.stderr);
      assert.equal(result.stdout,'');
      assert.equal(result.stderr,`Interrupted by ${signal}; cancelling active work and completing required restoration.\nInstallation incomplete: Interrupted by ${signal}.\n`);
      assert.deepEqual(leftovers(home,commit),[]);
    }finally{clearTimeout(timer);child.kill('SIGKILL');await proxy.close();rmSync(home,{recursive:true,force:true});}
  }
});

test('an unexpected installation failure points at the installation logs instead of private input',async()=>{
  const home=mkdtempSync(join(tmpdir(),'enois-install-unexpected-'));
  try{
    writeFileSync(join(home,'.local'),'not a directory');

    const result=await installing('b'.repeat(40),{...process.env,HOME:home}).finished;

    assert.equal(result.code,1,result.stderr);
    assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Installation incomplete: Installation failed; inspect the logs under the installation prefix.\n');
  }finally{rmSync(home,{recursive:true,force:true});}
});


test('a command with nothing to observe reports an empty warnings array in its final JSON',()=>{
  const f=h2Fixture();
  try{
    const config=f.config;const home=join(f.root,'home');mkdirSync(home);writeFileSync(join(home,'config.json'),JSON.stringify(config));

    const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,'source-digest'],{encoding:'utf8',timeout:120_000});

    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).warnings,[]);
    assert.doesNotMatch(result.stderr,/^warning:/m);
  }finally{f.cleanup();}
});

import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture as h2Fixture, command as h2Command } from './fixtures/h2.js';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, chmodSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inventory } from '../preview/state.js';
import { createServer } from 'node:http';
import { git, workspace } from './fixtures/workspace.js';

function recordEvidence(name:string,value:unknown):void{
  if(process.env.ENOIS_PREVIEW_EVIDENCE)writeFileSync(join(process.env.ENOIS_PREVIEW_EVIDENCE,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600});
}

function prepared(existingRoot?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), 'enois-publication-'));
  const config = workspace(root);
  const tool = join(root, 'tool'); mkdirSync(tool);
  for (const name of ['dist','preview','recipe','runtime','src','scripts','package.json','package-lock.json']) cpSync(resolve(name), join(tool, name), { recursive: true });
  writeFileSync(join(tool,'.gitignore'),'node_modules/\ndist/\n');
  mkdirSync(join(tool,'node_modules'));
  for(const name of ['tar','tough-cookie']){
    let dependency=dirname(fileURLToPath(import.meta.resolve(name)));
    while(!existsSync(join(dependency,'package.json'))||JSON.parse(readFileSync(join(dependency,'package.json'),'utf8')).name!==name){const parent=dirname(dependency);assert.notEqual(parent,dependency,`Resolve real ${name} dependency`);dependency=parent;}
    symlinkSync(dependency,join(tool,'node_modules',name),'dir');
  }
  git(tool, 'init', '-q'); git(tool, 'add', '.'); git(tool, '-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture tool');
  config.toolCommit = git(tool, 'rev-parse','HEAD').trim();
  const bytes = Buffer.from('explicitly simulated sanitized data');
  const files = { 'seed/rede.mv.db': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const content = { accounts: [{ email: 'author@enois.invalid', id: 'author', label: 'Author' }], externalReads: [], files, format: 'enois-preview-ts-v1', logicalSeedSha256: 'a'.repeat(64), media: [], permissions: { author: { admin: false, moderator: false } }, sanitizerSha256: 'f'.repeat(64) };
  const id = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const data = join(config.state, 'data', id); mkdirSync(join(data, 'package/seed'), { recursive: true });
  writeFileSync(join(data, 'package/seed/rede.mv.db'), bytes);
  writeFileSync(join(data, 'manifest.json'), JSON.stringify({ ...content, id }));
  mkdirSync(join(config.state, 'scenarios')); writeFileSync(join(config.state, 'scenarios/fixture.json'), JSON.stringify({ format: 'enois-preview-ts-v1', data: id }));
  const home = join(root, 'home'); mkdirSync(home); writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  return { root, config, tool, home, data: id, invoke: (...args: string[]) => spawnSync(process.execPath, [join(tool, 'dist/preview/cli.js'), '--home', home, ...args], { encoding: 'utf8', timeout: 10_000 }) };
}

test('code-only publication freezes new commits with D1 while live data and service remain unavailable', () => {
  const f = prepared();
  try {
    assert.equal(existsSync(f.config.database), false);

    const first = f.invoke('publish', 'fixture');

    assert.equal(first.status, 1, 'partial build must not claim validated publication');
    const operations = join(f.config.state, 'operations');
    assert.equal(existsSync(operations), true, first.stderr);
    const firstRevision = readdirSync(operations).find(name => !name.startsWith('.')); assert.ok(firstRevision);
    const firstJournal = JSON.parse(readFileSync(join(operations, firstRevision, 'journal.json'), 'utf8'));
    assert.equal(firstJournal.inputs.data, f.data);
    assert.match(first.stderr, new RegExp(`resume ${firstRevision}`));
    const frontend = f.config.repositories['enois-frontend']; assert.ok(frontend);
    writeFileSync(join(frontend, 'source'), 'new code'); git(frontend, 'add','.'); git(frontend, '-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','new code');

    const second = f.invoke('publish', 'fixture');

    assert.equal(second.status, 1);
    const revisions = readdirSync(operations).filter(name => !name.startsWith('.'));
    assert.equal(revisions.length, 2, second.stderr);
    const secondRevision = revisions.find(name => name !== firstRevision); assert.ok(secondRevision);
    const secondJournal = JSON.parse(readFileSync(join(operations, secondRevision, 'journal.json'), 'utf8'));
    assert.equal(secondJournal.inputs.data, f.data);
    assert.equal(secondJournal.inputs.commits['enois-frontend'], git(frontend, 'rev-parse','HEAD').trim());
    assert.equal(readFileSync(join(operations, secondRevision, 'frozen/sources/enois-frontend/source'), 'utf8'), 'new code');
    assert.equal(existsSync(join(f.config.state, 'restoration.json')), false);
    assert.deepEqual(readdirSync(join(f.config.state, 'data')), [f.data]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a refresh with a missing selected identity preserves D1 and gives correction guidance after restoration', () => {
  const h2 = h2Fixture(); const f = prepared(h2.root);
  try {
    const config = { ...f.config, ...h2.config };
    writeFileSync(join(f.home, 'config.json'), JSON.stringify(config));
    const first = f.invoke('publish', 'refresh-fixture');
    assert.equal(first.status, 1);
    const pointer = join(config.state, 'scenarios/refresh-fixture.json');
    assert.equal(existsSync(pointer), true, first.stderr);
    const before = readFileSync(pointer);
    h2Command('java','-cp',config.h2Jar,'org.h2.tools.Shell','-url',`jdbc:h2:file:${join(f.root,'live')};IFEXISTS=TRUE`,'-user','sa','-sql',"DELETE FROM USER_CREDENTIALS WHERE USER_ID='reader'; DELETE FROM USERS WHERE ID='reader'");

    const refresh = f.invoke('publish', 'refresh-fixture', '--refresh-data');

    assert.equal(refresh.status, 1);
    assert.match(refresh.stderr, /Selected identity missing/);
    assert.match(refresh.stderr, /Correct private account IDs/);
    assert.deepEqual(readFileSync(pointer), before);
    assert.equal(readFileSync(join(f.root, 'status'),'utf8'), 'running');
    assert.equal(existsSync(join(config.state,'restoration.json')), false);
    assert.equal(readdirSync(join(config.state,'data')).length, 1);
    assert.doesNotMatch(refresh.stderr, /original@example|reader@example/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

function remoteConsumer(f:ReturnType<typeof prepared>):void{
  const bare=join(f.root,'remote.git');mkdirSync(bare);git(bare,'init','--bare','-q');
  const seed=join(f.root,'launcher');mkdirSync(seed);git(seed,'init','-q','-b','preview');mkdirSync(join(seed,'catalog'));
  writeFileSync(join(seed,'catalog/scenarios.json'),'{"format":"enois-preview-ts-v1","scenarios":{}}');
  writeFileSync(join(seed,'wrangler.jsonc'),JSON.stringify({main:'launcher.ts',vars:{GITHUB_REPOSITORY:f.config.repository,GITHUB_OWNER:'fixture'}}));
  writeFileSync(join(seed,'tool.lock.json'),JSON.stringify({format:'enois-preview-ts-v1',repository:'renanfranca/enois-preview',commit:f.config.toolCommit}));
  writeFileSync(join(seed,'package.json'),JSON.stringify({devDependencies:{'enois-preview':`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${f.config.toolCommit}`}}));
  git(seed,'add','.');git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');git(seed,'remote','add','origin',bare);git(seed,'push','-q','origin','preview');
  const bin=join(f.root,'bin');mkdirSync(bin);const executable=join(f.tool,'dist/test/fixtures/git-command.js');chmodSync(executable,0o755);symlinkSync(executable,join(bin,'git'));
  writeFileSync(join(f.root,'platform.json'),JSON.stringify({builds:{},images:{},deployments:{},validations:{}}));
}
function publishProcess(f:ReturnType<typeof prepared>,...args:string[]):Promise<{code:number|null;stdout:string;stderr:string}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,...args],{stdio:['ignore','pipe','pipe']});
    let stdout='';let stderr='';child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('CLI fixture timed out'));},20_000);
    child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});
  });
}

test('simultaneous identical CLI publications converge on one revision, image and catalog entry',async()=>{
  const f=prepared();
  try{
    remoteConsumer(f);

    const results=await Promise.all([publishProcess(f,'publish','fixture'),publishProcess(f,'publish','fixture')]);

    for(const result of results)assert.equal(result.code,0,result.stderr);
    const reports=results.map(result=>JSON.parse(result.stdout));
    assert.equal(reports[0].revision,reports[1].revision);assert.equal(reports[0].url,reports[1].url);
    const platform=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));
    assert.deepEqual(Object.values(platform.builds),[1]);assert.equal(Object.keys(platform.images).length,1);assert.deepEqual(Object.values(platform.validations),[2]);
    const catalog=JSON.parse(git(join(f.root,'remote.git'),'show','preview:catalog/scenarios.json'));
    assert.equal(Object.keys(catalog.scenarios).length,1);assert.equal(git(join(f.root,'remote.git'),'rev-list','--count','preview').trim(),'3');
    assert.match(reports[0].validation.transport,/controlled/);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('CLI resume reconciles each lost acknowledgement from frozen artifacts after live sources and data are removed',async()=>{
  for(const stage of ['registry','configuration','catalog','deployment','beforePublicValidation','publicValidation']){
    const f=prepared();
    try{
      remoteConsumer(f);writeFileSync(join(f.root,'fail-once'),stage);

      const first=await publishProcess(f,'publish','fixture');

      assert.equal(first.code,1,`${stage}: ${first.stdout}`);
      const operations=join(f.config.state,'operations');const revision=readdirSync(operations).find(name=>!name.startsWith('.'));assert.ok(revision);
      const file=join(operations,revision,'journal.json');const original=JSON.parse(readFileSync(file,'utf8'));
      assert.match(first.stderr,new RegExp(`resume ${revision}`));assert.equal(first.stdout,'');
      const failure=JSON.parse(readFileSync(join(operations,revision,'failure.json'),'utf8'));
      const released=['beforePublicValidation','publicValidation'].includes(stage);
      assert.equal(failure.publicationLeaseReleased,released);
      const lease=spawnSync('git',['-C',join(f.root,'remote.git'),'show-ref','--verify','--quiet','refs/heads/enois-preview-publication-lease']);assert.equal(lease.status,released?1:0);
      for(const path of Object.values(f.config.repositories))rmSync(path,{recursive:true});rmSync(join(f.config.state,'data'),{recursive:true});

      const resumed=await publishProcess(f,'resume',revision);

      assert.equal(resumed.code,0,`${stage}: ${resumed.stderr}`);
      const report=JSON.parse(resumed.stdout);const final=JSON.parse(readFileSync(file,'utf8'));
      assert.equal(report.revision,revision);assert.deepEqual(final.inputs,original.inputs);
      const platform=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));
      assert.equal(platform.builds[revision],1);assert.equal(Object.keys(platform.images).length,1);assert.equal(Object.keys(platform.deployments).length,1);
      assert.equal(platform.validations[revision],stage==='publicValidation'?2:1);
      const catalog=JSON.parse(git(join(f.root,'remote.git'),'show','preview:catalog/scenarios.json'));
      assert.equal(Object.keys(catalog.scenarios).length,1);assert.equal(git(join(f.root,'remote.git'),'rev-list','--count','preview').trim(),'3');
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});

test('simultaneous CLI resumes reread confirmed checkpoints after acquiring the process lock',async()=>{
  const f=prepared();let owner:ReturnType<typeof spawn>|undefined;const children:ReturnType<typeof spawn>[]=[];
  try{
    const first=f.invoke('publish','fixture');assert.equal(first.status,1);
    const revision=readdirSync(join(f.config.state,'operations')).find(name=>!name.startsWith('.'));assert.ok(revision);remoteConsumer(f);
    owner=spawn('flock',['-x',join(f.config.state,'publication.lock'),process.execPath,join(f.tool,'dist/test/fixtures/lease-owner.js')],{stdio:['pipe','pipe','pipe']});
    assert.ok(owner.stdout);await once(owner.stdout,'data');
    const results=Array.from({length:2},()=>new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{
      const child=spawn(process.execPath,[join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,'resume',revision],{stdio:['ignore','pipe','pipe']});children.push(child);
      let stderr='';child.stdout.resume();child.stderr.on('data',chunk=>{stderr+=String(chunk);});child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
    }));
    let waiting=false;
    for(let attempt=0;attempt<200;attempt++){
      waiting=children.every(child=>{
        if(!child.pid)return false;
        try{return readFileSync(`/proc/${child.pid}/task/${child.pid}/children`,'utf8').trim().split(/\s+/).some(pid=>readFileSync(`/proc/${pid}/cmdline`,'utf8').startsWith('flock\0'));}catch{return false;}
      });
      if(waiting)break;await delay(20);
    }
    assert.equal(waiting,true,'both resume processes must be waiting for the held flock');

    assert.ok(owner.stdin);owner.stdin.end('release');
    const completed=await Promise.all(results);

    for(const result of completed)assert.equal(result.code,0,result.stderr);
    const platform=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));
    assert.equal(platform.builds[revision],1,'the second resume must observe the first confirmed build');
    assert.equal(Object.keys(platform.images).length,1);assert.equal(platform.validations[revision],2);
  }finally{
    owner?.stdin?.end();for(const child of children)child.kill('SIGKILL');owner?.kill('SIGTERM');rmSync(f.root,{recursive:true,force:true});
  }
});

test('interactive CLI selects captured identities only after backend restoration',async()=>{
  const h2=h2Fixture();const f=prepared(h2.root);
  try{
    const {accounts:_selection,...captureConfiguration}=h2.config;
    writeFileSync(join(f.home,'config.json'),JSON.stringify({...f.config,...captureConfiguration}));remoteConsumer(f);
    const command=[process.execPath,join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,'publish','interactive'].map(value=>"'"+value.replaceAll("'","'\\''")+"'").join(' ');
    let restoredAtPrompt=false;let answered=false;
    const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
      const child=spawn('script',['--return','--quiet','--command',command,'/dev/null'],{stdio:['pipe','pipe','pipe']});let output='';
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Interactive CLI fixture timed out'));},20_000);
      child.stdin.on('error',()=>{});
      const receive=(chunk:Buffer):void=>{output+=chunk.toString();if(!answered&&output.includes('Stable IDs to make available')){answered=true;restoredAtPrompt=readFileSync(join(f.root,'status'),'utf8')==='running';child.stdin.write('author,reader\n');}};
      child.stdout.on('data',receive);child.stderr.on('data',receive);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
    });

    assert.equal(result.code,0,result.output);assert.equal(answered,true);assert.equal(restoredAtPrompt,true);
    const pointer=JSON.parse(readFileSync(join(h2.config.state,'scenarios/interactive.json'),'utf8'));
    const manifest=JSON.parse(readFileSync(join(h2.config.state,'data',pointer.data,'manifest.json'),'utf8'));
    assert.deepEqual(manifest.accounts.map((account:{id:string;email:string})=>({id:account.id,email:account.email})),[{id:'author',email:'account1@enois.invalid'},{id:'reader',email:'account2@enois.invalid'}]);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(existsSync(join(h2.config.state,'restoration.json')),false);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('ordinary CLI publication retains real captured D1 with live inputs unavailable and only explicit refresh adopts D2',async()=>{
  const h2=h2Fixture();const f=prepared(h2.root);
  try{
    const config={...f.config,...h2.config};writeFileSync(join(f.home,'config.json'),JSON.stringify(config));remoteConsumer(f);
    const initial=await publishProcess(f,'publish','data-reuse');assert.equal(initial.code,0,initial.stderr);const first=JSON.parse(initial.stdout);
    const frontend=config.repositories['enois-frontend'];assert.ok(frontend);writeFileSync(join(frontend,'source'),'changed committed code');
    git(frontend,'add','.');git(frontend,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','new code');
    h2Command('java','-cp',config.h2Jar,'org.h2.tools.Shell','-url',`jdbc:h2:file:${join(f.root,'live')};IFEXISTS=TRUE`,'-user','sa','-sql',"UPDATE POSTS SET CONTENT='changed live data D2'");
    writeFileSync(join(f.root,'media/image.bin'),'changed media D2');
    const events=readFileSync(join(f.root,'events'),'utf8');renameSync(config.database,`${config.database}.unavailable`);renameSync(join(f.root,'media'),join(f.root,'media-unavailable'));

    const ordinary=await publishProcess(f,'publish','data-reuse');assert.equal(ordinary.code,0,ordinary.stderr);const second=JSON.parse(ordinary.stdout);

    assert.equal(second.dataVersion,first.dataVersion);assert.equal(second.dataReused,true);assert.notEqual(second.revision,first.revision);
    assert.equal(readFileSync(join(f.root,'events'),'utf8'),events);
    const frozen=join(config.state,'operations',second.revision,'frozen');
    assert.equal(readFileSync(join(frozen,'sources/enois-frontend/source'),'utf8'),'changed committed code');
    assert.equal(readFileSync(join(frozen,'data/media/0/image.bin'),'utf8'),'fictional');
    assert.equal(readFileSync(join(frozen,'data/seed/rede.mv.db')).includes(Buffer.from('changed live data D2')),false);
    renameSync(`${config.database}.unavailable`,config.database);renameSync(join(f.root,'media-unavailable'),join(f.root,'media'));

    const refreshed=await publishProcess(f,'publish','data-reuse','--refresh-data');assert.equal(refreshed.code,0,refreshed.stderr);const third=JSON.parse(refreshed.stdout);

    assert.notEqual(third.dataVersion,first.dataVersion);assert.equal(third.dataReused,false);assert.notEqual(third.revision,second.revision);
    assert.deepEqual(third.commits,second.commits);assert.equal(readFileSync(join(config.state,'operations',third.revision,'frozen/data/media/0/image.bin'),'utf8'),'changed media D2');
    assert.equal(readFileSync(join(config.state,'operations',third.revision,'frozen/data/seed/rede.mv.db')).includes(Buffer.from('changed live data D2')),true);
    const catalog=JSON.parse(git(join(f.root,'remote.git'),'show','preview:catalog/scenarios.json'));assert.equal(Object.keys(catalog.scenarios).length,3);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(existsSync(join(config.state,'restoration.json')),false);
  }finally{h2.cleanup();}
});

test('CLI resume refuses tampered frozen inputs even when the mutable journal inventory is edited and live sources are gone',()=>{
  for(const corruption of ['same-size-seed','source-and-journal-inventory','extra-file','symlink','data-manifest']){
    const f=prepared();
    try{
      assert.equal(f.invoke('publish','fixture').status,1);
      const operations=join(f.config.state,'operations');const revision=readdirSync(operations).find(name=>!name.startsWith('.'));assert.ok(revision);
      const directory=join(operations,revision);const file=join(directory,'journal.json');const journal=JSON.parse(readFileSync(file,'utf8'));
      const frozen=join(directory,'frozen');
      if(corruption==='same-size-seed'){const seed=join(frozen,'data/seed/rede.mv.db');writeFileSync(seed,Buffer.alloc(readFileSync(seed).length,65));}
      else if(corruption==='source-and-journal-inventory'){
        const path='sources/enois-frontend/source';const bytes=Buffer.alloc(readFileSync(join(frozen,path)).length,66);writeFileSync(join(frozen,path),bytes);
        journal.frozenFiles[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};writeFileSync(file,JSON.stringify(journal));
      }else if(corruption==='extra-file')writeFileSync(join(frozen,'runtime/unexpected'),'');
      else if(corruption==='symlink')symlinkSync('rede.mv.db',join(frozen,'data/seed/alias'));
      else{journal.inputs.dataManifest.accounts[0].label='tampered label';writeFileSync(file,JSON.stringify(journal));}
      for(const path of Object.values(f.config.repositories))rmSync(path,{recursive:true});
      const before=readFileSync(file);const pointer=readFileSync(join(f.config.state,'scenarios/fixture.json'));

      const resumed=f.invoke('resume',revision);

      assert.equal(resumed.status,1,corruption);assert.equal(resumed.stdout,'');
      assert.match(resumed.stderr,/Frozen input integrity failure|Symlinks are not allowed|Frozen data manifest identity mismatch/,corruption);
      assert.deepEqual(readFileSync(file),before);assert.deepEqual(readFileSync(join(f.config.state,'scenarios/fixture.json')),pointer);
      assert.deepEqual(readdirSync(join(f.config.state,'data')),[f.data]);assert.equal(existsSync(join(f.config.state,'restoration.json')),false);
    }finally{rmSync(f.root,{recursive:true,force:true});}
  }
});

test('simultaneous different CLI publications preserve both immutable catalog entries',async()=>{
  const f=prepared();
  try{
    remoteConsumer(f);cpSync(join(f.config.state,'scenarios/fixture.json'),join(f.config.state,'scenarios/other.json'));

    const results=await Promise.all([publishProcess(f,'publish','fixture'),publishProcess(f,'publish','other')]);

    for(const result of results)assert.equal(result.code,0,result.stderr);
    const reports=results.map(result=>JSON.parse(result.stdout));assert.notEqual(reports[0].revision,reports[1].revision);assert.notEqual(reports[0].url,reports[1].url);
    assert.equal(reports[0].dataVersion,reports[1].dataVersion);
    const catalog=JSON.parse(git(join(f.root,'remote.git'),'show','preview:catalog/scenarios.json'));
    assert.deepEqual(Object.values(catalog.scenarios).map((entry:unknown)=>(entry as {revision:string}).revision).sort(),reports.map(report=>report.revision).sort());
    assert.equal(git(join(f.root,'remote.git'),'rev-list','--count','preview').trim(),'5');
    const platform=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));assert.equal(Object.keys(platform.images).length,2);assert.deepEqual(Object.values(platform.builds),[1,1]);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});


test('CLI interruption restores prior backend state despite further signals and preserves H2 and complete data',async()=>{
  for(const [initial,failStart] of [['running',false],['stopped',false],['running',true]] as const){
    const h2=h2Fixture(),f=prepared(h2.root);
    const config={...f.config,...h2.config,state:f.config.state,service:{...h2.config.service,timeout:20}};
    writeFileSync(join(f.home,'config.json'),JSON.stringify(config));writeFileSync(join(f.root,'status'),initial);
    writeFileSync(join(f.root,'hold-release'),'');writeFileSync(join(f.root,'hold-restore'),'');
    if(failStart)writeFileSync(join(f.root,'fail-start'),'');
    const preserved=await inventory(join(config.state,'data'));
    const independent=createServer((_request,response)=>response.end('independent ready'));independent.listen(0,'127.0.0.1');await once(independent,'listening');
    const address=independent.address();assert.ok(address&&typeof address==='object');
    const before=readFileSync(config.database),complete=readFileSync(join(config.state,'data',f.data,'manifest.json'));
    const child=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture','--refresh-data'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>stdout+=String(data));child.stderr.on('data',data=>stderr+=String(data));
    const completed=once(child,'close');
    async function phase(name:string){const deadline=Date.now()+5000;while(!existsSync(join(f.root,name))&&Date.now()<deadline)await delay(10);assert.ok(existsSync(join(f.root,name)),`${name}: ${stderr}`);}
    try{
      await phase('paused');assert.equal(readFileSync(join(f.root,'status'),'utf8'),'stopped');
      child.kill('SIGTERM');
      await phase('restore-paused');
      assert.equal(existsSync(join(config.state,'restoration.json')),true);
      child.kill('SIGINT');child.kill('SIGTERM');
      assert.equal(child.exitCode,null);
      rmSync(join(f.root,'hold-restore'));

      assert.deepEqual(await completed,[143,null],stderr);
      assert.equal(stdout,'');assert.match(stderr,/interrupt/i);assert.match(stderr,failStart?/restoration pending/i:/restored to its prior state/i);
      assert.equal(readFileSync(join(f.root,'status'),'utf8'),failStart?'stopped':initial);
      assert.equal(await(await fetch(`http://127.0.0.1:${address.port}`)).text(),'independent ready');
      assert.deepEqual(await inventory(join(config.state,'data')),preserved);
      assert.deepEqual(readFileSync(config.database),before);assert.deepEqual(readFileSync(join(config.state,'data',f.data,'manifest.json')),complete);
      assert.deepEqual(readdirSync(join(config.state,'data')),[f.data]);assert.equal(existsSync(join(config.state,'operations')),false);
      assert.equal(existsSync(join(config.state,'restoration.json')),failStart);
      if(failStart){
        rmSync(join(f.root,'fail-start'));writeFileSync(join(config.repositories['enois-frontend']!,'source'),'dirty after interruption');
        writeFileSync(join(f.root,'hold-ready'),'');
        const recovering=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture'],{stdio:['ignore','ignore','pipe']});
        let recoveryError='';recovering.stderr.on('data',data=>recoveryError+=String(data));const recoveryComplete=once(recovering,'close');
        try{await phase('ready-paused');assert.equal(existsSync(join(config.state,'restoration.json')),true,'record must survive until readiness confirms');rmSync(join(f.root,'hold-ready'));assert.deepEqual(await recoveryComplete,[1,null],recoveryError);assert.match(recoveryError,/source changes.*No service was stopped/);}finally{recovering.kill('SIGKILL');}
        assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(existsSync(join(config.state,'restoration.json')),false);
        assert.deepEqual(await inventory(join(config.state,'data')),preserved);assert.deepEqual(readFileSync(config.database),before);
      }
      recordEvidence(`capture-${initial}${failStart?'-failed-start':''}`,{transport:'CLI OS signals; controlled service adapter; real H2 fixture',initial,firstSignal:'SIGTERM',furtherSignals:['SIGINT','SIGTERM'],exitCode:143,restorationPendingAtExit:failStart,recoveryReadinessBarrierExercised:failStart,pendingAfterRecovery:existsSync(join(config.state,'restoration.json')),priorH2Sha256:createHash('sha256').update(before).digest('hex'),finalH2Sha256:createHash('sha256').update(readFileSync(config.database)).digest('hex'),previousCompleteDataPreserved:true,independentServiceReady:true,incompleteDataPromoted:false});
    }finally{independent.closeAllConnections();await new Promise<void>(done=>independent.close(()=>done()));child.kill('SIGKILL');for(const name of ['paused','restore-paused','ready-paused'])if(existsSync(join(f.root,name))){try{process.kill(Number(readFileSync(join(f.root,name),'utf8')),'SIGKILL');}catch{}}rmSync(f.root,{recursive:true,force:true});}
  }
});


test('CLI interruption stops waiting for another process publication lease without releasing its owner',async()=>{
  const f=prepared();const file=join(f.config.state,'publication.lock');
  const owner=spawn('flock',['--exclusive',file,process.execPath,resolve('dist/test/fixtures/lease-owner.js')],{stdio:['pipe','pipe','pipe']});
  let waiter:ReturnType<typeof spawn>|undefined;
  try{
    const [ready]=await once(owner.stdout!,'data');assert.match(String(ready),/locked/);
    waiter=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';waiter.stdout!.on('data',data=>stdout+=String(data));waiter.stderr!.on('data',data=>stderr+=String(data));
    const completed=once(waiter,'close');const deadline=Date.now()+5000;let waiting=false;
    while(Date.now()<deadline){
      const children=readFileSync(`/proc/${waiter.pid}/task/${waiter.pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean);
      waiting=children.some(pid=>{try{return readFileSync(`/proc/${pid}/comm`,'utf8').trim()==='flock';}catch{return false;}});
      if(waiting)break;await delay(10);
    }
    assert.equal(waiting,true,stderr);waiter.kill('SIGTERM');
    const timer=setTimeout(()=>waiter?.kill('SIGKILL'),2000);
    try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
    assert.equal(stdout,'');assert.match(stderr,/interrupt/i);assert.equal(existsSync(join(f.config.state,'operations')),false);
    process.kill(owner.pid!,0);assert.equal(spawnSync('flock',['--nonblock',file,'true']).status,1,'original owner still holds its lease');
    recordEvidence('lease-interruption',{transport:'real Linux flock and separate owner process',signal:'SIGTERM',exitCode:143,ownerAlive:true,ownerLeaseHeld:true,laterOperationStarted:false});
    const released=once(owner,'close');owner.stdin!.end('release');assert.deepEqual(await released,[0,null]);
    assert.equal(spawnSync('flock',['--nonblock',file,'true']).status,0);
  }finally{waiter?.kill('SIGKILL');owner.stdin?.end();owner.kill('SIGKILL');rmSync(f.root,{recursive:true,force:true});}
});


test('CLI resume reconciles an accepted Git push interrupted before local confirmation without repeating remote effects',async()=>{
  const f=prepared();let child:ReturnType<typeof spawn>|undefined;
  try{
    remoteConsumer(f);const marker=join(f.root,'fail-once');writeFileSync(marker,'interrupt-configuration');
    child=spawn(process.execPath,[join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,'publish','fixture'],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout!.on('data',data=>stdout+=String(data));child.stderr!.on('data',data=>stderr+=String(data));
    const completed=once(child,'close'),deadline=Date.now()+10000;
    while(!existsSync(marker+'.accepted')&&Date.now()<deadline)await delay(10);
    assert.ok(existsSync(marker+'.accepted'),stderr);const accepted=JSON.parse(readFileSync(marker+'.accepted','utf8'));assert.equal(accepted.stage,'configuration');process.kill(accepted.pid,0);
    const operations=join(f.config.state,'operations'),revision=readdirSync(operations).find(name=>!name.startsWith('.'));assert.ok(revision);
    const file=join(operations,revision,'journal.json'),before=JSON.parse(readFileSync(file,'utf8'));
    assert.ok(before.intents.configuration.commit);assert.equal(before.checkpoints.configuration,undefined);
    const acceptedCommit=git(join(f.root,'remote.git'),'rev-parse','preview').trim();assert.equal(acceptedCommit,before.intents.configuration.commit);
    child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),2000);
    try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
    assert.equal(stdout,'');assert.match(stderr,new RegExp(`resume ${revision}`));assert.doesNotMatch(stderr,/rollback/i);
    assert.equal(git(join(f.root,'remote.git'),'rev-list','--count','preview').trim(),'2');
    const platformBefore=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));assert.equal(Object.keys(platformBefore.deployments).length,0);
    const interrupted=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(interrupted.intents.configuration,before.intents.configuration);assert.equal(interrupted.checkpoints.configuration,undefined);
    rmSync(marker);for(const path of Object.values(f.config.repositories))rmSync(path,{recursive:true});rmSync(join(f.config.state,'data'),{recursive:true});

    const resumed=await publishProcess(f,'resume',revision);

    assert.equal(resumed.code,0,resumed.stderr);const report=JSON.parse(resumed.stdout);assert.equal(report.revision,revision);assert.equal(report.configurationCommit,acceptedCommit);
    assert.equal(git(join(f.root,'remote.git'),'rev-list','--count','preview').trim(),'3');
    const platform=JSON.parse(readFileSync(join(f.root,'platform.json'),'utf8'));assert.equal(platform.builds[revision],1);assert.equal(Object.keys(platform.images).length,1);assert.equal(Object.keys(platform.deployments).length,1);
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).inputs,before.inputs);
    recordEvidence('accepted-push-interruption',{transport:'real local Git; controlled build, registry and deployment',signal:'SIGTERM',exitCode:143,revision,acceptedCommit,resumedConfigurationCommit:report.configurationCommit,remoteCommitCount:3,builds:platform.builds[revision],images:Object.keys(platform.images).length,deployments:Object.keys(platform.deployments).length,frozenInputsPreserved:true});
  }finally{child?.kill('SIGKILL');if(existsSync(join(f.root,'fail-once.accepted'))){try{process.kill(JSON.parse(readFileSync(join(f.root,'fail-once.accepted'),'utf8')).pid,'SIGKILL');}catch{}}rmSync(f.root,{recursive:true,force:true});}
});


test('CLI interruption cancels HTTP headers and body waits before another request and releases only its confirmed lease',async()=>{
  for(const phase of ['headers','body']){
    const f=prepared();let child:ReturnType<typeof spawn>|undefined;const calls:string[]=[];
    let reached!:()=>void;const observed=new Promise<void>(done=>reached=done);let disconnected=false;
    const server=createServer((request,response)=>{
      const path=request.url!;if(path==='/alive'){response.end('independent ready');return;}calls.push(path);
      if((phase==='headers'&&path.startsWith('/preview/'))||(phase==='body'&&path==='/__demo/revision')){
        response.on('close',()=>disconnected=true);if(phase==='body'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{');}reached();return;
      }
      response.end('ready');
    });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
    const origin=`http://127.0.0.1:${address.port}`;
    try{
      remoteConsumer(f);writeFileSync(join(f.root,'http-url'),origin);
      child=spawn(process.execPath,[join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,'publish','fixture'],{stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout!.on('data',data=>stdout+=String(data));child.stderr!.on('data',data=>stderr+=String(data));
      const completed=once(child,'close');const phaseTimer=setTimeout(()=>child?.kill('SIGKILL'),15000);
      try{await Promise.race([observed,completed.then(()=>{throw new Error(`HTTP phase not reached: ${stderr}`);})]);}finally{clearTimeout(phaseTimer);}
      child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),2000);
      try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
      assert.equal(stdout,'');assert.match(stderr,/resume [a-f0-9]{64}/);assert.equal(disconnected,true);
      assert.equal(calls.length,phase==='headers'?1:2);assert.equal(await(await fetch(origin+'/alive')).text(),'independent ready');
      assert.equal(spawnSync('git',['-C',join(f.root,'remote.git'),'show-ref','--verify','--quiet','refs/heads/enois-preview-publication-lease']).status,1);
      const operations=join(f.config.state,'operations'),revision=readdirSync(operations).find(name=>!name.startsWith('.'));assert.ok(revision);
      const journal=JSON.parse(readFileSync(join(operations,revision,'journal.json'),'utf8'));assert.equal(journal.checkpoints.publicValidation,undefined);assert.equal(journal.checkpoints.releaseLease.released,true);
      rmSync(join(f.root,'http-url'));
      const resumed=await publishProcess(f,'resume',revision);assert.equal(resumed.code,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).revision,revision);
      recordEvidence(`http-${phase}-interruption`,{transport:'production HTTP validation redirected to local recording server; controlled remote providers',phase,signal:'SIGTERM',exitCode:143,revision,calls,connectionClosed:disconnected,independentServiceReady:true,ownedLeaseReleased:journal.checkpoints.releaseLease.released,publicValidationCheckpoint:false,resumeValidated:true});
    }finally{child?.kill('SIGKILL');server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));rmSync(f.root,{recursive:true,force:true});}
  }
});


test('CLI interruption cancels the H2 ownership probe and restores the stopped backend before exit',async()=>{
  const h2=h2Fixture(),f=prepared(h2.root);const config={...f.config,...h2.config,state:f.config.state};
  writeFileSync(join(f.home,'config.json'),JSON.stringify(config));const bin=join(f.root,'bin');mkdirSync(bin);const executable=resolve('dist/test/fixtures/infrastructure.js');chmodSync(executable,0o755);symlinkSync(executable,join(bin,'fuser'));
  const barrier=join(f.root,'fuser-paused'),before=readFileSync(config.database);
  const child=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture','--refresh-data'],{env:{...process.env,PATH:`${bin}:${process.env.PATH??''}`,FIXTURE_FUSER_BARRIER:barrier},stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';child.stdout.on('data',data=>stdout+=String(data));child.stderr.on('data',data=>stderr+=String(data));const completed=once(child,'close');
  try{
    const deadline=Date.now()+5000;while(!existsSync(barrier)&&Date.now()<deadline)await delay(10);assert.ok(existsSync(barrier),stderr);process.kill(Number(readFileSync(barrier,'utf8')),0);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'stopped');child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
    assert.equal(stdout,'');assert.match(stderr,/restored to its prior state/);assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(existsSync(join(config.state,'restoration.json')),false);assert.deepEqual(readFileSync(config.database),before);
  }finally{child.kill('SIGKILL');if(existsSync(barrier)){try{process.kill(Number(readFileSync(barrier,'utf8')),'SIGKILL');}catch{}}rmSync(f.root,{recursive:true,force:true});}
});


test('interruption during permitted lease cleanup completes release and records its outcome without reporting publication success',async()=>{
  const f=prepared();let child:ReturnType<typeof spawn>|undefined;
  try{
    remoteConsumer(f);writeFileSync(join(f.root,'hold-delete'),'');
    child=spawn(process.execPath,[join(f.tool,'dist/test/fixtures/publication-driver.js'),f.root,'--home',f.home,'publish','fixture'],{stdio:['ignore','pipe','pipe']});
    let stderr='',stdout='';child.stdout!.on('data',data=>stdout+=String(data));child.stderr!.on('data',data=>stderr+=String(data));const completed=once(child,'close');
    const deadline=Date.now()+10000;while(!existsSync(join(f.root,'delete-paused'))&&Date.now()<deadline)await delay(10);assert.ok(existsSync(join(f.root,'delete-paused')),stderr);
    child.kill('SIGTERM');const signalled=Date.now()+1000;while(!stderr.includes('Interrupted by SIGTERM')&&Date.now()<signalled)await delay(10);assert.match(stderr,/Interrupted by SIGTERM/);assert.equal(child.exitCode,null);
    rmSync(join(f.root,'hold-delete'));const timer=setTimeout(()=>child?.kill('SIGKILL'),2000);try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
    assert.equal(stdout,'');const operations=join(f.config.state,'operations'),revision=readdirSync(operations).find(name=>!name.startsWith('.'));assert.ok(revision);
    const journal=JSON.parse(readFileSync(join(operations,revision,'journal.json'),'utf8'));const failure=JSON.parse(readFileSync(join(operations,revision,'failure.json'),'utf8'));
    assert.equal(journal.checkpoints.releaseLease.released,true);assert.equal(failure.publicationLeaseReleased,true);
    recordEvidence('release-interruption',{transport:'real local Git with controlled GitHub lease transport',signal:'SIGTERM',exitCode:143,revision,releaseCheckpoint:journal.checkpoints.releaseLease,reportedRelease:failure.publicationLeaseReleased,validatedReportEmitted:false});assert.match(stderr,new RegExp(`resume ${revision}`));
    assert.equal(spawnSync('git',['-C',join(f.root,'remote.git'),'show-ref','--verify','--quiet','refs/heads/enois-preview-publication-lease']).status,1);
  }finally{child?.kill('SIGKILL');rmSync(f.root,{recursive:true,force:true});}
});


test('interruption during an accepted backend stop settles shutdown before trusting readiness or removing restoration',async()=>{
  const h2=h2Fixture(),f=prepared(h2.root);const config={...f.config,...h2.config,state:f.config.state,service:{...h2.config.service,timeout:15}};
  writeFileSync(join(f.home,'config.json'),JSON.stringify(config));writeFileSync(join(f.root,'hold-stop'),'');
  const before=readFileSync(config.database),preserved=await inventory(join(config.state,'data'));
  const child=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture','--refresh-data'],{stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';child.stdout.on('data',data=>stdout+=String(data));child.stderr.on('data',data=>stderr+=String(data));const completed=once(child,'close');
  async function phase(name:string,timeout=5000){const deadline=Date.now()+timeout;while(!existsSync(join(f.root,name))&&Date.now()<deadline)await delay(10);return existsSync(join(f.root,name));}
  try{
    assert.equal(await phase('stop-worker.pid'),true,stderr);assert.equal(await phase('stop-paused'),true);process.kill(Number(readFileSync(join(f.root,'stop-worker.pid'),'utf8')),0);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(spawnSync(process.execPath,[resolve('dist/test/fixtures/service.js'),f.root,'ready'],{encoding:'utf8'}).stdout.trim(),'ready');
    child.kill('SIGTERM');
    const draining=await phase('stop-draining',2000);
    if(!draining){writeFileSync(join(f.root,'finish-stop'),'');const deadline=Date.now()+1000;while(readFileSync(join(f.root,'status'),'utf8')!=='stopped'&&Date.now()<deadline)await delay(10);}
    assert.equal(draining,true,`accepted stop left backend=${readFileSync(join(f.root,'status'),'utf8')}, restoration=${existsSync(join(config.state,'restoration.json'))}: ${stderr}`);
    assert.equal(existsSync(join(config.state,'restoration.json')),true);assert.equal(child.exitCode,null);child.kill('SIGINT');
    writeFileSync(join(f.root,'finish-stop'),'');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{assert.deepEqual(await completed,[143,null],stderr);}finally{clearTimeout(timer);}
    assert.equal(stdout,'');assert.match(stderr,/restored to its prior state/);assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');assert.equal(existsSync(join(config.state,'restoration.json')),false);
    assert.deepEqual(readFileSync(config.database),before);assert.deepEqual(await inventory(join(config.state,'data')),preserved);assert.equal(existsSync(join(config.state,'operations')),false);
    recordEvidence('stop-transition-interruption',{transport:'CLI OS signals; controlled adapter with independent accepted shutdown worker',firstSignal:'SIGTERM',furtherSignal:'SIGINT',exitCode:143,healthyBeforePendingShutdown:true,shutdownSettledBeforeRestoration:true,backendRestored:true,restorationRecordRetainedUntilSettled:true,completeDataPreserved:true});
  }finally{child.kill('SIGKILL');for(const name of ['stop-worker.pid','stop-paused','stop-draining'])if(existsSync(join(f.root,name))){try{process.kill(Number(readFileSync(join(f.root,name),'utf8')),'SIGKILL');}catch{}}rmSync(f.root,{recursive:true,force:true});}
});


for(const variant of ['timeout','sigkill'] as const)test(`a restoration interrupted during an accepted stop stays pending across processes until shutdown settles and readiness returns (${variant})`,async()=>{
  const h2=h2Fixture(),f=prepared(h2.root);const config={...f.config,...h2.config,state:f.config.state,service:{...h2.config.service,timeout:3}};
  writeFileSync(join(f.home,'config.json'),JSON.stringify(config));writeFileSync(join(f.root,'hold-stop'),'');
  const record=join(config.state,'restoration.json'),marker=(name:string)=>join(f.root,name),status=()=>readFileSync(marker('status'),'utf8');
  const before=readFileSync(config.database),preserved=await inventory(join(config.state,'data')),complete=readFileSync(join(config.state,'data',f.data,'manifest.json'));
  const independent=createServer((_request,response)=>response.end('independent ready'));independent.listen(0,'127.0.0.1');await once(independent,'listening');
  const address=independent.address();assert.ok(address&&typeof address==='object');
  const orphans:number[]=[];const remember=(name:string)=>{if(existsSync(marker(name)))orphans.push(Number(readFileSync(marker(name),'utf8')));};
  async function phase(name:string,timeout=5000){const deadline=Date.now()+timeout;while(!existsSync(marker(name))&&Date.now()<deadline)await delay(10);return existsSync(marker(name));}
  const child=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture','--refresh-data'],{stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';child.stdout.on('data',data=>stdout+=String(data));child.stderr.on('data',data=>stderr+=String(data));const completed=once(child,'close');
  let recovering:ReturnType<typeof spawn>|undefined;
  try{
    assert.equal(await phase('stop-worker.pid'),true,stderr);assert.equal(await phase('stop-paused'),true,stderr);
    assert.equal(status(),'running');assert.equal(spawnSync(process.execPath,[resolve('dist/test/fixtures/service.js'),f.root,'ready'],{encoding:'utf8'}).stdout.trim(),'ready');
    if(variant==='timeout'){
      child.kill('SIGINT');
      assert.equal(await phase('stop-draining',3000),true,`restoration must settle the accepted stop: ${stderr}`);
      assert.equal(child.exitCode,null);child.kill('SIGTERM');
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000);try{assert.deepEqual(await completed,[130,null],stderr);}finally{clearTimeout(timer);}
      assert.equal(stdout,'');assert.match(stderr,/restoration pending/);
    }else{
      remember('stop-paused');child.kill('SIGKILL');assert.deepEqual(await completed,[null,'SIGKILL']);
    }
    assert.equal(existsSync(record),true,'restoration record retained after the first process');assert.equal(status(),'running');assert.equal(existsSync(marker('stop-pending')),true);
    remember('stop-paused');remember('stop-draining');
    for(const name of ['stop-draining','stop-paused','ready-paused'])rmSync(marker(name),{force:true});
    const eventsBefore=readFileSync(marker('events'),'utf8').length;const newEvents=()=>readFileSync(marker('events'),'utf8').slice(eventsBefore).trim().split('\n').filter(Boolean);
    writeFileSync(join(config.repositories['enois-frontend']!,'source'),'dirty after interruption');writeFileSync(marker('hold-ready'),'');
    recovering=spawn(process.execPath,[join(f.tool,'dist/preview/cli.js'),'--home',f.home,'publish','fixture'],{stdio:['ignore','ignore','pipe']});
    let recoveryError='';recovering.stderr!.on('data',data=>recoveryError+=String(data));const recoveryComplete=once(recovering,'close');
    const window=Date.now()+1500;
    while(Date.now()<window&&!existsSync(marker('stop-draining'))&&!existsSync(marker('ready-paused'))&&recovering.exitCode===null)await delay(10);
    assert.equal(existsSync(marker('stop-pending')),true,'accepted shutdown still pending during observation');
    assert.equal(recovering.exitCode,null,recoveryError);assert.equal(existsSync(record),true,'record kept while shutdown is pending');
    assert.equal(existsSync(marker('ready-paused')),false,`readiness trusted while the accepted stop is pending: ${newEvents().join(',')}`);
    assert.deepEqual(newEvents().filter(event=>event==='ready'||event==='start'),[]);assert.doesNotMatch(recoveryError,/source changes/);
    writeFileSync(marker('finish-stop'),'');
    assert.equal(await phase('ready-paused'),true,recoveryError);
    assert.equal(status(),'running');assert.equal(existsSync(record),true,'record must survive until readiness confirms');
    const events=newEvents();assert.ok(events.includes('start'),events.join(','));assert.ok(events.indexOf('start')<events.lastIndexOf('ready'),events.join(','));
    const firstEffect=events.findIndex(event=>event==='stop'||event==='start');assert.ok(events.indexOf('identity')!==-1&&events.indexOf('identity')<firstEffect,events.join(','));
    rmSync(marker('hold-ready'));
    assert.deepEqual(await recoveryComplete,[1,null],recoveryError);assert.match(recoveryError,/source changes.*No service was stopped/);
    assert.equal(status(),'running');assert.equal(existsSync(record),false);
    assert.deepEqual(readFileSync(config.database),before);assert.deepEqual(await inventory(join(config.state,'data')),preserved);
    assert.deepEqual(readFileSync(join(config.state,'data',f.data,'manifest.json')),complete);assert.equal(existsSync(join(config.state,'operations')),false);
    assert.equal(await(await fetch(`http://127.0.0.1:${address.port}`)).text(),'independent ready');
    recordEvidence(`cross-process-shutdown-${variant}`,{transport:'two CLI processes; controlled adapter with independent accepted shutdown worker; real H2 fixture',firstProcess:variant==='timeout'?{firstSignal:'SIGINT',furtherSignal:'SIGTERM',exitCode:130,restorationTimedOut:true}:{signal:'SIGKILL',finallyRan:false},restorationPendingAfterFirstProcess:true,shutdownPendingAtSecondProcess:true,readinessQueriedWhileShutdownPending:false,recordRetainedWhileShutdownPending:true,secondProcessEvents:events,identityBeforeEffects:true,startBeforeReady:true,dirtySourceRefusalAfterRecovery:true,recordAfterRecovery:false,finalStatus:'running',priorH2Sha256:createHash('sha256').update(before).digest('hex'),finalH2Sha256:createHash('sha256').update(readFileSync(config.database)).digest('hex'),completeDataPreserved:true,independentServiceReady:true,operationsCreated:false});
  }finally{
    child.kill('SIGKILL');recovering?.kill('SIGKILL');if(existsSync(f.root))writeFileSync(marker('finish-stop'),'');
    for(const name of ['stop-worker.pid','stop-paused','stop-draining','ready-paused'])remember(name);
    for(const pid of orphans){try{process.kill(pid,'SIGKILL');}catch{}}
    independent.closeAllConnections();await new Promise<void>(done=>independent.close(()=>done()));rmSync(f.root,{recursive:true,force:true});
  }
});

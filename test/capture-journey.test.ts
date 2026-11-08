import { fixture, command } from './fixtures/h2.js';
import { workspace } from './fixtures/workspace.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, symlinkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import * as captures from '../preview/capture.js';
import { captureConfig } from '../preview/config.js';
import { run, inventory, identity, PreviewError } from '../preview/state.js';

test('capture timeout prevents late child and grandchild effects while restoring prior state and preserving an independent service',async()=>{
  const f=fixture();
  const tree=resolve('dist/test/fixtures/timeout-tree.js');
  const roots:string[]=[];
  try{
    const previous=await captures.capture(f.config);
    const preserved=await inventory(join(f.config.state,'data'));
    const database=createHash('sha256').update(readFileSync(f.config.database)).digest('hex');
    const control=join(f.root,'control');mkdirSync(control);roots.push(control);

    const output=await run([process.execPath,tree,control,'control'],{timeout:10});

    assert.match(output.toString(),/descendants confirmed active/);
    assert.equal(existsSync(join(control,'child.effect')),true);
    assert.equal(existsSync(join(control,'grandchild.effect')),true);
    for(const initial of ['running','stopped']){
      const root=join(f.root,initial);mkdirSync(root);roots.push(root);
      writeFileSync(join(f.root,'status'),initial);
      const config={...f.config,service:{...f.config.service,timeout:1,
        [initial==='running'?'stop':'released']:[process.execPath,tree,root,initial==='running'?'stop':'released']}};
      // The stop command writes its own fixture status; the service adapter reads the shared state.
      if(initial==='running')symlinkSync(join(f.root,'status'),join(root,'status'));

      await assert.rejects(captures.capture(config,previous),initial==='running'?/node timed out/:/Backend released did not confirm released/);

      const observed=JSON.parse(readFileSync(join(root,'observed.json'),'utf8'));
      assert.equal(observed.bothAlive,true);
      assert.ok(observed.child>0&&observed.grandchild>0);
      await delay(2800);
      assert.equal(existsSync(join(root,'child.effect')),false,'timed out child must not perform its delayed effect');
      assert.equal(existsSync(join(root,'grandchild.effect')),false,'timed out grandchild must not perform its delayed effect');
      const independent=JSON.parse(readFileSync(join(root,'independent.json'),'utf8'));
      assert.equal(await (await fetch(`http://127.0.0.1:${independent.port}`,{signal:AbortSignal.timeout(2000)})).text(),'independent ready');
      assert.equal(readFileSync(join(f.root,'status'),'utf8'),initial);
      assert.equal(createHash('sha256').update(readFileSync(f.config.database)).digest('hex'),database);
      assert.deepEqual(await inventory(join(f.config.state,'data')),preserved);
      assert.equal(existsSync(join(f.config.state,'restoration.json')),false);
      if(process.env.ENOIS_PREVIEW_EVIDENCE)writeFileSync(join(process.env.ENOIS_PREVIEW_EVIDENCE,`timeout-${initial}.json`),JSON.stringify({initial,restored:readFileSync(join(f.root,'status'),'utf8'),observed,independentResponded:true,controlEffects:true,lateEffects:false,databaseBeforeSha256:database,databaseAfterSha256:createHash('sha256').update(readFileSync(f.config.database)).digest('hex'),completeDataBeforeSha256:identity(preserved),completeDataAfterSha256:identity(await inventory(join(f.config.state,'data'))),completeDataPreserved:true,restorationPending:false})+'\n',{mode:0o600});
    }
  }finally{
    for(const root of roots){
      for(const role of ['child','grandchild'])if(existsSync(join(root,role+'.pid'))){try{process.kill(Number(readFileSync(join(root,role+'.pid'),'utf8')),'SIGKILL');}catch{}}
      if(existsSync(join(root,'independent.json'))){try{process.kill(JSON.parse(readFileSync(join(root,'independent.json'),'utf8')).pid,'SIGKILL');}catch{}}
    }
    f.cleanup();
  }
});

test('capture restores running backend and sanitizes a real H2 copy while preserving content and relationships', async () => {
  const f = fixture();
  try {
    const before = createHash('sha256').update(readFileSync(f.config.database)).digest('hex');
    const api = captures as unknown as { capture(config: unknown): Promise<{ id: string; sanitizerSha256: string }> };

    const data = await api.capture(f.config);

    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'running');
    assert.equal(createHash('sha256').update(readFileSync(f.config.database)).digest('hex'), before);
    const packageRoot = join(f.config.state, 'data', data.id, 'package');
    const answer = command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${packageRoot}/seed/rede;IFEXISTS=TRUE`, '-user', 'sa', '-sql', 'SELECT ID, IS_ADMIN FROM USERS ORDER BY ID; SELECT * FROM POSTS; SELECT COUNT(*) FROM AUTH_SESSIONS; SELECT COUNT(*) FROM LINKEDIN_CONNECTIONS; SELECT PASSWORD_USABLE FROM USER_CREDENTIALS; SELECT * FROM PARENTAL_LINKS');
    assert.match(answer, /fictional preserved content/); assert.match(answer, /author/); assert.match(answer, /FALSE/); assert.match(answer, /ACCEPTED/);
    assert.doesNotMatch(answer, /parental-invitation-marker/);
    const seed = readFileSync(join(packageRoot, 'seed/rede.mv.db'));
    for (const marker of ['original-credential-marker', 'original-session', 'refresh-marker', 'integration-marker', 'original@example.invalid', 'parental-invitation-marker']) assert.equal(seed.includes(Buffer.from(marker)), false, marker);
    assert.equal(data.sanitizerSha256, createHash('sha256').update(readFileSync('recipe/SeedTool.java')).digest('hex'));
    assert.equal(existsSync(join(f.config.state, 'restoration.json')), false);
  } finally { f.cleanup(); }
});

test('a new CLI invocation restores a backend after SIGKILL before inspecting dirty sources', async () => {
  const f = fixture(); let helper: number | undefined;
  const base = workspace(f.root);
  const config = { ...base, ...f.config };
  const home = join(f.root, 'home'); mkdirSync(home); writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  const file = join(f.root, 'config.json'); writeFileSync(file, JSON.stringify(config));
  writeFileSync(join(f.root, 'hold-release'), '');
  const child = spawn(process.execPath, ['dist/test/fixtures/capture-process.js', file], { stdio: 'ignore' });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(f.root, 'paused')) && Date.now() < deadline) await delay(25);
    assert.equal(existsSync(join(f.root, 'paused')), true);
    helper = Number(readFileSync(join(f.root, 'paused'), 'utf8'));
    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'stopped');
    const closed = once(child, 'exit'); child.kill('SIGKILL'); await closed;
    assert.equal(existsSync(join(f.config.state, 'restoration.json')), true);
    writeFileSync(join(f.root, 'enois-frontend/source'), 'pending');

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'publish', 'fixture'], { encoding: 'utf8', timeout: 5000 });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /No service was stopped/);
    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'running');
    assert.equal(existsSync(join(f.config.state, 'restoration.json')), false);
    assert.equal(existsSync(join(f.config.state, 'data')), false);
  } finally {
    child.kill('SIGKILL'); if (helper) { try { process.kill(helper, 'SIGTERM'); } catch {} }
    f.cleanup();
  }
});

test('an initially stopped backend remains stopped during capture', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'status'), 'stopped');

    await captures.capture(f.config);

    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'stopped');
    const events = readFileSync(join(f.root, 'events'), 'utf8').trim().split('\n');
    assert.equal(events.includes('start'), false);
    assert.equal(events.includes('stop'), false);
  } finally { f.cleanup(); }
});

test('captures of the same database through directory aliases cannot overlap across processes', async () => {
  const f = fixture();
  const alias = `${f.root}-alias`;
  symlinkSync(f.root, alias, 'dir');
  const alternate = { ...f.config, state: join(f.root, 'other-private'), database: join(alias, 'live.mv.db') };
  const firstConfig = join(f.root, 'first.json'); const secondConfig = join(f.root, 'second.json');
  writeFileSync(firstConfig, JSON.stringify(f.config)); writeFileSync(secondConfig, JSON.stringify(alternate));
  writeFileSync(join(f.root, 'hold-release'), '');
  const first = spawn(process.execPath, ['dist/test/fixtures/capture-process.js', firstConfig], { stdio: 'ignore' });
  let second: ReturnType<typeof spawn> | undefined;
  let helper: number | undefined;
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(f.root, 'paused')) && Date.now() < deadline) await delay(25);
    assert.equal(existsSync(join(f.root, 'paused')), true);
    helper = Number(readFileSync(join(f.root, 'paused'), 'utf8'));
    const before = readFileSync(join(f.root, 'events'), 'utf8');
    second = spawn(process.execPath, ['dist/test/fixtures/capture-process.js', secondConfig], { stdio: 'ignore' });

    await delay(500);

    assert.equal(readFileSync(join(f.root, 'events'), 'utf8'), before, 'second capture must wait before any service access');
    const firstClosed = once(first, 'exit'); const secondClosed = once(second, 'exit');
    rmSync(join(f.root, 'hold-release'));
    assert.deepEqual(await firstClosed, [0, null]);
    assert.deepEqual(await secondClosed, [0, null]);
    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'running');
  } finally {
    first.kill('SIGKILL'); second?.kill('SIGKILL');
    if (helper) { try { process.kill(helper, 'SIGTERM'); } catch {} }
    rmSync(alias); f.cleanup();
  }
});

test('headless capture without selected accounts gives the interactive command after restoring the backend',async()=>{
  const f=fixture();
  try{
    const {accounts:_selection,...config}=f.config;

    await assert.rejects(captures.capture(config),/Select stable account IDs.*enois-preview publish.*interactive.*configure accounts/);

    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(existsSync(join(f.config.state,'restoration.json')),false);
    assert.equal(existsSync(join(f.config.state,'data')),false);
  }finally{f.cleanup();}
});

test('an explicit refresh reuses the recorded account selection when configuration omits accounts',async()=>{
  const f=fixture();
  try{
    const previous=await captures.capture(f.config);const {accounts:_selection,...config}=f.config;

    const refreshed=await captures.capture(captureConfig(config),previous);

    assert.equal(refreshed.id,previous.id);assert.deepEqual(refreshed.accounts,previous.accounts);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(readdirSync(join(f.config.state,'data')).length,1);
  }finally{f.cleanup();}
});

test('a service answer arriving after its timeout cannot promote a capture',async()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.root,'late-release'),'');const config={...f.config,service:{...f.config.service,timeout:0.3}};

    await assert.rejects(captures.capture(config),/Backend released did not confirm released/);

    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(existsSync(join(f.config.state,'restoration.json')),false);assert.equal(existsSync(join(f.config.state,'data')),false);
  }finally{f.cleanup();}
});

test('failed copy and failed restart retain restoration until a subsequent CLI can restore before dirty source refusal',async()=>{
  const f=fixture();
  try{
    const base=workspace(f.root);const config={...base,...f.config,media:[{root:join(f.root,'missing-media'),url:'/fixture/'}]};
    writeFileSync(join(f.root,'fail-start'),'');

    await assert.rejects(captures.capture(config),/Capture incomplete; backend restoration pending/);

    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'stopped');
    assert.equal(existsSync(join(config.state,'restoration.json')),true);assert.equal(existsSync(join(config.state,'data')),false);
    rmSync(join(f.root,'fail-start'));const home=join(f.root,'home');mkdirSync(home);writeFileSync(join(home,'config.json'),JSON.stringify(config));
    writeFileSync(join(f.root,'enois-frontend/source'),'dirty after failed capture');

    const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,'publish','fixture'],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/source changes.*No service was stopped/);
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(existsSync(join(config.state,'restoration.json')),false);assert.equal(existsSync(join(config.state,'data')),false);
  }finally{f.cleanup();}
});

test('SIGTERM during the paused capture restores the backend and never promotes incomplete data',async()=>{
  const f=fixture();let helper:number|undefined;
  const file=join(f.root,'config.json');writeFileSync(file,JSON.stringify({...f.config,service:{...f.config.service,timeout:10}}));
  writeFileSync(join(f.root,'hold-release'),'');
  const child=spawn(process.execPath,['dist/test/fixtures/capture-process.js',file],{stdio:'ignore'});
  try{
    const deadline=Date.now()+5000;while(!existsSync(join(f.root,'paused'))&&Date.now()<deadline)await delay(25);
    assert.equal(existsSync(join(f.root,'paused')),true);helper=Number(readFileSync(join(f.root,'paused'),'utf8'));
    assert.equal(readFileSync(join(f.root,'status'),'utf8'),'stopped');const closed=once(child,'exit');

    child.kill('SIGTERM');rmSync(join(f.root,'hold-release'));

    assert.deepEqual(await closed,[1,null]);assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(existsSync(join(f.config.state,'restoration.json')),false);assert.equal(existsSync(join(f.config.state,'data')),false);
  }finally{child.kill('SIGKILL');if(helper){try{process.kill(helper,'SIGTERM');}catch{}}f.cleanup();}
});

test('an actual open H2 connection refuses capture even when the service adapter claims release',async()=>{
  const f=fixture();let child:ReturnType<typeof spawn>|undefined;
  try{
    const source=join(f.root,'Hold.java');writeFileSync(source,'import java.sql.*; public class Hold { public static void main(String[] args) throws Exception { try(Connection db=DriverManager.getConnection("jdbc:h2:file:"+args[0]+";IFEXISTS=TRUE","sa","")) { System.out.println("holding H2"); System.out.flush(); System.in.read(); } } }');
    command('javac','-d',f.root,source);
    child=spawn('java',['-cp',`${f.root}:${f.config.h2Jar}`,'Hold',join(f.root,'live')],{stdio:['pipe','pipe','pipe']});
    const [first]=await once(child.stdout!,'data');assert.equal(String(first).trim(),'holding H2');

    await assert.rejects(captures.capture(f.config),/H2 is in use.*No lock file was removed/);

    assert.equal(child.exitCode,null);assert.equal(readFileSync(join(f.root,'status'),'utf8'),'running');
    assert.equal(existsSync(join(f.config.state,'restoration.json')),false);assert.equal(existsSync(join(f.config.state,'data')),false);
    const closed=once(child,'exit');child.stdin!.end('\n');assert.deepEqual(await closed,[0,null]);
  }finally{child?.kill('SIGKILL');f.cleanup();}
});


test('command cancellation handles output, private logs, an already cancelled call and an exited group without contaminating later commands',async()=>{
  const root=mkdtempSync(join(tmpdir(),'enois-cancelled-command-'));
  const controllers:AbortController[]=[];
  try{
    for(const logging of [false,true]){
      const marker=join(root,logging?'logged':'streamed'),logPath=join(root,'private.log'),controller=new AbortController();controllers.push(controller);
      const code="import {writeFileSync} from 'node:fs';process.stdout.write('active output',()=>writeFileSync(process.argv[1],String(process.pid)));setInterval(()=>process.stdout.write('more output'),10);";
      const command=run([process.execPath,'--input-type=module','-e',code,marker],{signal:controller.signal,...(logging?{logPath}:{})});void command.catch(()=>{});
      const deadline=Date.now()+5000;while(!existsSync(marker)&&Date.now()<deadline)await delay(10);assert.ok(existsSync(marker));
      controller.abort(new PreviewError('command cancelled'));

      await assert.rejects(command,/command cancelled/);
      assert.match((await run([process.execPath,'-e','console.log("next command complete")'])).toString(),/next command complete/);
      if(logging)assert.match(readFileSync(logPath,'utf8'),/active output/);
      const already=join(root,'must-not-start');await assert.rejects(run([process.execPath,'-e','require("node:fs").writeFileSync(process.argv[1],"late")',already],{signal:controller.signal,logPath:join(root,'must-not-open.log')}),/command cancelled/);
      assert.equal(existsSync(already),false);assert.equal(existsSync(join(root,'must-not-open.log')),false);
    }
    const controller=new AbortController();controllers.push(controller);
    const independent="import {writeFileSync,existsSync} from 'node:fs';const root=process.argv[1];writeFileSync(root+'/independent.pid',String(process.pid));setInterval(()=>{if(existsSync(root+'/release')){writeFileSync(root+'/independent.effect','preserved');process.exit(0);}},10);";
    const parent=`import {spawn} from 'node:child_process';import {writeFileSync,existsSync} from 'node:fs';const root=process.argv[1];writeFileSync(root+'/parent.pid',String(process.pid));spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(independent)},root],{detached:true,stdio:'inherit'});setInterval(()=>{if(existsSync(root+'/independent.pid'))process.exit(0);},10);`;
    const command=run([process.execPath,'--input-type=module','-e',parent,root],{signal:controller.signal});void command.catch(()=>{});
    const deadline=Date.now()+5000;let exited=false;
    while(Date.now()<deadline){if(existsSync(join(root,'parent.pid'))&&existsSync(join(root,'independent.pid'))){const pid=Number(readFileSync(join(root,'parent.pid'),'utf8'));exited=!existsSync(`/proc/${pid}`);if(exited)break;}await delay(10);}
    assert.equal(exited,true);process.kill(Number(readFileSync(join(root,'independent.pid'),'utf8')),0);
    controller.abort(new PreviewError('exited command cancelled'));writeFileSync(join(root,'release'),'');

    await assert.rejects(command,/exited command cancelled/);
    assert.equal(readFileSync(join(root,'independent.effect'),'utf8'),'preserved');
  }finally{for(const controller of controllers)controller.abort();if(existsSync(join(root,'independent.pid'))){try{process.kill(Number(readFileSync(join(root,'independent.pid'),'utf8')),'SIGKILL');}catch{}}rmSync(root,{recursive:true,force:true});}
});

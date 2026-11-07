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

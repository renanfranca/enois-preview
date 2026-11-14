import { fixture, command, pausingFuser } from './fixtures/h2.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, symlinkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as captures from '../preview/capture.js';
import { captureConfig } from '../preview/config.js';
import { collectWarnings } from '../preview/warnings.js';
import { run, PreviewError } from '../preview/state.js';

async function waitFor(file:string,timeout=10_000):Promise<void>{const deadline=Date.now()+timeout;while(!existsSync(file)&&Date.now()<deadline)await delay(10);assert.ok(existsSync(file),`${file} not reached`);}
function captureProcess(config:unknown,root:string,name:string,env:NodeJS.ProcessEnv){
  const file=join(root,`${name}.json`);writeFileSync(file,JSON.stringify(config));
  const child=spawn(process.execPath,['dist/test/fixtures/capture-process.js',file],{stdio:['ignore','ignore','pipe'],env});let stderr='';child.stderr!.on('data',data=>stderr+=String(data));
  return {child,stderr:()=>stderr};
}

test('capture sanitizes a real H2 copy while preserving content and relationships', async () => {
  const f = fixture();
  try {
    const before = createHash('sha256').update(readFileSync(f.config.database)).digest('hex');
    const api = captures as unknown as { capture(config: unknown): Promise<{ id: string; sanitizerSha256: string }> };

    const data = await api.capture(f.config);

    assert.equal(createHash('sha256').update(readFileSync(f.config.database)).digest('hex'), before);
    const packageRoot = join(f.config.state, 'data', data.id, 'package');
    const answer = command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${packageRoot}/seed/rede;IFEXISTS=TRUE`, '-user', 'sa', '-sql', 'SELECT ID, IS_ADMIN FROM USERS ORDER BY ID; SELECT * FROM POSTS; SELECT COUNT(*) FROM AUTH_SESSIONS; SELECT COUNT(*) FROM LINKEDIN_CONNECTIONS; SELECT PASSWORD_USABLE FROM USER_CREDENTIALS; SELECT * FROM PARENTAL_LINKS');
    assert.match(answer, /fictional preserved content/); assert.match(answer, /author/); assert.match(answer, /FALSE/); assert.match(answer, /ACCEPTED/);
    assert.doesNotMatch(answer, /parental-invitation-marker/);
    const seed = readFileSync(join(packageRoot, 'seed/rede.mv.db'));
    for (const marker of ['original-credential-marker', 'original-session', 'refresh-marker', 'integration-marker', 'original@example.invalid', 'parental-invitation-marker']) assert.equal(seed.includes(Buffer.from(marker)), false, marker);
    assert.equal(data.sanitizerSha256, createHash('sha256').update(readFileSync('recipe/SeedTool.java')).digest('hex'));
  } finally { f.cleanup(); }
});

test('capture empties private calendar subscriptions so their link tokens never reach the sanitized copy', async () => {
  const marker = 'calendar-subscription-marker-7f3c9a1e52d4b860';
  const f = fixture(`CREATE TABLE CALENDAR_SUBSCRIPTIONS(ID VARCHAR PRIMARY KEY, USER_ID VARCHAR, SCOPE VARCHAR, TOKEN_HASH VARCHAR(64) NOT NULL UNIQUE, CREATED_AT TIMESTAMP, REVOKED_AT TIMESTAMP);
INSERT INTO CALENDAR_SUBSCRIPTIONS VALUES('subscription','author','PERSONAL','${marker}',CURRENT_TIMESTAMP,NULL);`);
  try {
    const before = createHash('sha256').update(readFileSync(f.config.database)).digest('hex');

    const data = await captures.capture(f.config as never) as { id: string };

    assert.equal(createHash('sha256').update(readFileSync(f.config.database)).digest('hex'), before);
    const packageRoot = join(f.config.state, 'data', data.id, 'package');
    const answer = command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${packageRoot}/seed/rede;IFEXISTS=TRUE`, '-user', 'sa', '-sql', 'SELECT COUNT(*) AS SUBSCRIPTIONS FROM CALENDAR_SUBSCRIPTIONS');
    assert.match(answer, /SUBSCRIPTIONS\s+0\b/);
    assert.equal(readFileSync(join(packageRoot, 'seed/rede.mv.db')).includes(Buffer.from(marker)), false);
  } finally { f.cleanup(); }
});

test('capture keeps messages readable while clearing their per-message encrypted keys', async () => {
  const marker = 'per-message-keys-marker-b41d6e2093ca57f8';
  const f = fixture(`CREATE TABLE MESSAGES(ID VARCHAR PRIMARY KEY, SENDER_ID VARCHAR, CONTENT VARCHAR, ENCRYPTED_KEYS VARCHAR);
INSERT INTO MESSAGES VALUES('keyed','author','fictional keyed message','${marker}'),('legacy','reader','fictional legacy message',NULL);`);
  try {
    const data = await captures.capture(f.config as never) as { id: string };

    const packageRoot = join(f.config.state, 'data', data.id, 'package');
    const answer = command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${packageRoot}/seed/rede;IFEXISTS=TRUE`, '-user', 'sa', '-sql', "SELECT ID, CONTENT FROM MESSAGES ORDER BY ID; SELECT COUNT(*) AS KEYED FROM MESSAGES WHERE ENCRYPTED_KEYS IS NOT NULL");
    assert.match(answer, /keyed\s*\|\s*fictional keyed message/);
    assert.match(answer, /legacy\s*\|\s*fictional legacy message/);
    assert.match(answer, /KEYED\s+0\b/);
    assert.equal(readFileSync(join(packageRoot, 'seed/rede.mv.db')).includes(Buffer.from(marker)), false);
  } finally { f.cleanup(); }
});

test('an unreviewed credential column is reported by TABLE.COLUMN and the capture is still promoted', async () => {
  const f = fixture(`CREATE TABLE CALENDAR_FEEDS(ID VARCHAR PRIMARY KEY, FEED_TOKEN VARCHAR);
INSERT INTO CALENDAR_FEEDS VALUES('feed','calendar-feed-marker-0d8e61b4a7f2');`);
  try {

    const { result: data, warnings } = await collectWarnings(() => captures.capture(f.config));

    assert.deepEqual(warnings.filter(warning => warning.code === 'credential-column').map(warning => warning.message), ['Unrecognized credential-like column CALENDAR_FEEDS.FEED_TOKEN was kept in the captured data.']);
    assert.deepEqual(readdirSync(join(f.config.state, 'data')), [data.id]);
    assert.equal(existsSync(join(f.config.state, 'data', data.id, 'package/seed/rede.mv.db')), true);
  } finally { f.cleanup(); }
});

test('an H2 file held open by another process is copied with an in use warning and the holder is never signalled',async()=>{
  const f=fixture();let child:ReturnType<typeof spawn>|undefined;
  try{
    const source=join(f.root,'Hold.java');writeFileSync(source,'import java.sql.*; public class Hold { public static void main(String[] args) throws Exception { try(Connection db=DriverManager.getConnection("jdbc:h2:file:"+args[0]+";IFEXISTS=TRUE","sa","")) { System.out.println("holding H2"); System.out.flush(); System.in.read(); } } }');
    command('javac','-d',f.root,source);
    child=spawn('java',['-cp',`${f.root}:${f.config.h2Jar}`,'Hold',join(f.root,'live')],{stdio:['pipe','pipe','pipe']});
    let signalled=false;child.on('exit',(_code,signal)=>{signalled=signal!==null;});
    const [first]=await once(child.stdout!,'data');assert.equal(String(first).trim(),'holding H2');

    const {result:data,warnings}=await collectWarnings(()=>captures.capture(f.config));

    assert.ok(warnings.some(warning=>warning.code==='database-in-use'),JSON.stringify(warnings));
    assert.equal(child.exitCode,null);assert.equal(signalled,false);process.kill(child.pid!,0);
    assert.deepEqual(readdirSync(join(f.config.state,'data')),[data.id]);
    const closed=once(child,'exit');child.stdin!.end('\n');assert.deepEqual(await closed,[0,null]);
  }finally{child?.kill('SIGKILL');f.cleanup();}
});

test('captures of the same database through directory aliases cannot overlap across processes', async () => {
  const f = fixture();
  const alias = `${f.root}-alias`;
  symlinkSync(f.root, alias, 'dir');
  const alternate = { ...f.config, state: join(f.root, 'other-private'), database: join(alias, 'live.mv.db') };
  const firstBarrier = join(f.root, 'first-paused'); const secondBarrier = join(f.root, 'second-paused');
  const first = captureProcess(f.config, f.root, 'first', pausingFuser(f.root, firstBarrier));
  let second: ReturnType<typeof captureProcess> | undefined;
  try {
    await waitFor(firstBarrier);
    second = captureProcess(alternate, f.root, 'second', pausingFuser(f.root, secondBarrier));

    await delay(500);

    assert.equal(existsSync(secondBarrier), false, 'second capture must wait for the lease before inspecting the database');
    const firstClosed = once(first.child, 'exit');
    writeFileSync(`${firstBarrier}.release`, '');
    assert.deepEqual(await firstClosed, [0, null], first.stderr());
    await waitFor(secondBarrier);
    const secondClosed = once(second.child, 'exit');writeFileSync(`${secondBarrier}.release`, '');
    assert.deepEqual(await secondClosed, [0, null], second.stderr());
  } finally {
    first.child.kill('SIGKILL'); second?.child.kill('SIGKILL');
    for (const barrier of [firstBarrier, secondBarrier]) if (existsSync(barrier)) { try { process.kill(Number(readFileSync(barrier, 'utf8')), 'SIGKILL'); } catch {} }
    rmSync(alias); f.cleanup();
  }
});

test('headless capture without selected accounts names --accounts and promotes nothing',async()=>{
  const f=fixture();
  try{
    const {accounts:_selection,...config}=f.config;

    await assert.rejects(captures.capture(config),/--accounts ID\[,ID\.\.\.\]/);

    assert.equal(existsSync(join(f.config.state,'data')),false);
  }finally{f.cleanup();}
});

test('explicit account IDs take their labels from the captured listing and receive distinct generated logins',async()=>{
  const f=fixture();
  try{
    const {accounts:_selection,...config}=f.config;

    const data=await captures.capture(config,undefined,undefined,undefined,['reader','author']);

    assert.deepEqual(data.accounts,[{id:'reader',email:'account1@enois.invalid',label:'Fictional reader'},{id:'author',email:'account2@enois.invalid',label:'Fictional author'}]);
    await assert.rejects(captures.capture(config,undefined,undefined,undefined,['missing']),/Unknown account ID missing/);
  }finally{f.cleanup();}
});

test('an explicit refresh reuses the recorded account selection when configuration omits accounts',async()=>{
  const f=fixture();
  try{
    const previous=await captures.capture(f.config);const {accounts:_selection,...config}=f.config;

    const refreshed=await captures.capture(captureConfig(config),previous);

    assert.equal(refreshed.id,previous.id);assert.deepEqual(refreshed.accounts,previous.accounts);
    assert.equal(readdirSync(join(f.config.state,'data')).length,1);
  }finally{f.cleanup();}
});

test('configured accounts accept any valid unique email, generate missing logins and keep at least one account',()=>{
  const f=fixture();
  try{
    const withAccounts=(accounts:unknown[])=>captureConfig({...f.config,accounts});
    const many=Array.from({length:25},(_,index)=>({id:`user${index}`,label:`User ${index}`}));

    const accepted=withAccounts([{id:'author',email:'Author@Example.com',label:'Author'},{id:'reader',label:'Reader'}]);
    const twentyFive=withAccounts(many);

    assert.deepEqual(accepted.accounts,[{id:'author',email:'Author@Example.com',label:'Author'},{id:'reader',email:'account1@enois.invalid',label:'Reader'}]);
    assert.equal(twentyFive.accounts.length,25);assert.equal(new Set(twentyFive.accounts.map(account=>account.email)).size,25);
    assert.deepEqual(withAccounts([{id:'a',email:'account1@enois.invalid',label:'A'},{id:'b',label:'B'}]).accounts.map(account=>account.email),['account1@enois.invalid','account2@enois.invalid']);
    assert.throws(()=>withAccounts([{id:'author',email:'not an email',label:'Author'}]),(error:unknown)=>error instanceof PreviewError&&/valid addresses/.test(error.message));
    assert.throws(()=>withAccounts([{id:'a',email:'same@example.com',label:'A'},{id:'b',email:'same@example.com',label:'B'}]),/distinct/);
    assert.deepEqual(captureConfig({...f.config,accounts:[]}).accounts,[]);
  }finally{f.cleanup();}
});

test('SIGTERM during capture ends the process and never promotes incomplete data',async()=>{
  const f=fixture();const barrier=join(f.root,'paused');
  const capture=captureProcess(f.config,f.root,'interrupted',pausingFuser(f.root,barrier));
  try{
    await waitFor(barrier);const closed=once(capture.child,'exit');

    capture.child.kill('SIGTERM');

    assert.deepEqual(await closed,[1,null],capture.stderr());
    assert.equal(existsSync(join(f.config.state,'data')),false);
    assert.deepEqual(existsSync(join(f.config.state,'staging'))?readdirSync(join(f.config.state,'staging')):[],[]);
  }finally{capture.child.kill('SIGKILL');if(existsSync(barrier)){try{process.kill(Number(readFileSync(barrier,'utf8')),'SIGKILL');}catch{}}f.cleanup();}
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

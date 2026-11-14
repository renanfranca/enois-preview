import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { command, fixture } from './fixtures/h2.js';

type Digest = { format: string; databaseSha256: string; logicalSha256: string; tables: Record<string, number> };
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
function sourceDigest(home: string, ...extra: string[]) {
  const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'source-digest', ...extra], { encoding: 'utf8', timeout: 120_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
function setup() {
  const f = fixture();
  const home = join(f.root, 'home'); mkdirSync(home); writeFileSync(join(home, 'config.json'), JSON.stringify(f.config));
  const sql = (statement: string) => command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${f.root}/live;MODE=MySQL;IFEXISTS=TRUE`, '-user', 'sa', '-password', '', '-sql', statement);
  const leftovers = () => existsSync(join(f.config.state, 'digest')) ? readdirSync(join(f.config.state, 'digest')) : [];
  return { f, home, sql, leftovers };
}

test('source-digest reports a logical digest of the configured source that survives physical rewrites and follows data changes, without touching the source', () => {
  const { f, home, sql, leftovers } = setup();
  try {
    const original = readFileSync(f.config.database);
    const first = sourceDigest(home);
    assert.equal(first.code, 0, first.stderr);
    const report = JSON.parse(first.stdout) as Digest;
    assert.equal(report.format, 'enois-preview-ts-v1');
    assert.equal(report.databaseSha256, sha(f.config.database));
    assert.match(report.logicalSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.tables, { AUTH_SESSIONS: 1, LINKEDIN_CONNECTIONS: 1, PARENTAL_LINKS: 1, POSTS: 1, USERS: 2, USER_CREDENTIALS: 2 });
    assert.deepEqual(readFileSync(f.config.database), original, 'the source database must stay byte for byte identical');
    assert.deepEqual((JSON.parse(first.stdout) as { warnings: unknown[] }).warnings, []);
    assert.deepEqual(leftovers(), [], 'the private copy is removed');

    sql('SHUTDOWN COMPACT');
    assert.notEqual(sha(f.config.database), report.databaseSha256, 'the fixture was physically rewritten');
    const rewritten = JSON.parse(sourceDigest(home).stdout) as Digest;
    assert.equal(rewritten.logicalSha256, report.logicalSha256);
    assert.notEqual(rewritten.databaseSha256, report.databaseSha256);

    sql("UPDATE POSTS SET CONTENT='changed fictional content' WHERE ID='post'");
    const changed = JSON.parse(sourceDigest(home).stdout) as Digest;
    assert.notEqual(changed.logicalSha256, report.logicalSha256);
    assert.deepEqual(changed.tables, report.tables);
  } finally { f.cleanup(); }
});

test('source-digest works while another process holds the H2 file, warns that it is in use and refuses extra arguments', async () => {
  const { f, home, leftovers } = setup(); let child: ReturnType<typeof spawn> | undefined;
  try {
    const source=join(f.root,'Hold.java');writeFileSync(source,'import java.sql.*; public class Hold { public static void main(String[] args) throws Exception { try(Connection db=DriverManager.getConnection("jdbc:h2:file:"+args[0]+";IFEXISTS=TRUE","sa","")) { System.out.println("holding H2"); System.out.flush(); System.in.read(); } } }');
    command('javac','-d',f.root,source);
    child=spawn('java',['-cp',`${f.root}:${f.config.h2Jar}`,'Hold',join(f.root,'live')],{stdio:['pipe','pipe','pipe']});
    const [first]=await once(child.stdout!,'data');assert.equal(String(first).trim(),'holding H2');

    const running = await new Promise<{code:number|null;stdout:string;stderr:string}>(done=>{const digest=spawn(process.execPath,['dist/preview/cli.js','--home',home,'source-digest'],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';digest.stdout.on('data',data=>stdout+=String(data));digest.stderr.on('data',data=>stderr+=String(data));digest.on('close',code=>done({code,stdout,stderr}));});
    const extra = sourceDigest(home, 'unexpected');

    assert.equal(running.code, 0, running.stderr);
    const report = JSON.parse(running.stdout) as Digest & { warnings: { code: string; message: string }[] };
    assert.match(report.logicalSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.warnings.map(warning => warning.code), ['database-in-use']);
    assert.match(running.stderr, /^warning: The configured H2 file appears in use/m);
    assert.equal(child.exitCode, null); process.kill(child.pid!, 0);
    assert.notEqual(extra.code, 0); assert.equal(extra.stdout, '');
    assert.deepEqual(leftovers(), []);
    const closed=once(child,'exit');child.stdin!.end('\n');assert.deepEqual(await closed,[0,null]);
  } finally { child?.kill('SIGKILL'); f.cleanup(); }
});

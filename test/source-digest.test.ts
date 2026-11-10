import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  const f = fixture(); writeFileSync(join(f.root, 'status'), 'stopped');
  const home = join(f.root, 'home'); mkdirSync(home); writeFileSync(join(home, 'config.json'), JSON.stringify(f.config));
  const sql = (statement: string) => command('java', '-cp', f.config.h2Jar, 'org.h2.tools.Shell', '-url', `jdbc:h2:file:${f.root}/live;MODE=MySQL;IFEXISTS=TRUE`, '-user', 'sa', '-password', '', '-sql', statement);
  const events = () => existsSync(join(f.root, 'events')) ? readFileSync(join(f.root, 'events'), 'utf8').trim().split('\n') : [];
  const leftovers = () => existsSync(join(f.config.state, 'digest')) ? readdirSync(join(f.config.state, 'digest')) : [];
  return { f, home, sql, events, leftovers };
}

test('source-digest reports a logical digest of a stopped source that survives physical rewrites and follows data changes, without touching the source', () => {
  const { f, home, sql, events, leftovers } = setup();
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
    assert.equal(events().some(action => action === 'start' || action === 'stop'), false, 'source-digest never starts or stops the backend');
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

test('source-digest refuses a running backend, a pending restoration and extra arguments without side effects', () => {
  const { f, home, events, leftovers } = setup();
  try {
    const original = readFileSync(f.config.database);
    writeFileSync(join(f.root, 'status'), 'running');
    const running = sourceDigest(home);
    assert.notEqual(running.code, 0); assert.equal(running.stdout, ''); assert.match(running.stderr, /stopped/);
    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'running');

    writeFileSync(join(f.root, 'status'), 'stopped');
    mkdirSync(f.config.state, { recursive: true });
    const restoration = join(f.config.state, 'restoration.json'); const record = JSON.stringify({ format: 'enois-preview-ts-v1', service: f.config.service, database: f.config.database, running: true });
    writeFileSync(restoration, record);
    const pending = sourceDigest(home);
    assert.notEqual(pending.code, 0); assert.equal(pending.stdout, ''); assert.match(pending.stderr, /restoration/i);
    assert.equal(readFileSync(restoration, 'utf8'), record, 'the pending restoration record is preserved');
    assert.equal(readFileSync(join(f.root, 'status'), 'utf8'), 'stopped');

    const extra = sourceDigest(home, 'unexpected');
    assert.notEqual(extra.code, 0); assert.equal(extra.stdout, '');

    assert.deepEqual(readFileSync(f.config.database), original);
    assert.equal(events().some(action => action === 'start' || action === 'stop'), false);
    assert.deepEqual(leftovers(), []);
  } finally { f.cleanup(); }
});

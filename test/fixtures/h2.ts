import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function command(...args: string[]): string {
  const result = spawnSync(args[0]!, args.slice(1), { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'enois-capture-'));
  const h2Jar = process.env.ENOIS_H2_JAR ?? join(homedir(), '.m2/repository/com/h2database/h2/2.5.252/h2-2.5.252.jar');
  const sql = join(root, 'init.sql');
  writeFileSync(sql, `CREATE TABLE USERS(ID VARCHAR PRIMARY KEY, NAME VARCHAR, EMAIL VARCHAR UNIQUE, IS_ADMIN BOOLEAN, TOTP_ENABLED_AT TIMESTAMP);
CREATE TABLE USER_CREDENTIALS(USER_ID VARCHAR PRIMARY KEY, EMAIL VARCHAR UNIQUE, PASSWORD_HASH VARCHAR, PASSWORD_USABLE BOOLEAN, RESET_NEEDED BOOLEAN);
CREATE TABLE AUTH_SESSIONS(ID VARCHAR, REFRESH_TOKEN VARCHAR);
CREATE TABLE LINKEDIN_CONNECTIONS(USER_ID VARCHAR, ACCESS_TOKEN_ENC VARCHAR);
CREATE TABLE POSTS(ID VARCHAR, AUTHOR_ID VARCHAR, CONTENT VARCHAR);
CREATE TABLE PARENTAL_LINKS(ID VARCHAR, MINOR_USER_ID VARCHAR, GUARDIAN_USER_ID VARCHAR, STATUS VARCHAR, TOKEN_HASH VARCHAR);
INSERT INTO PARENTAL_LINKS VALUES('link','reader','author','ACCEPTED','parental-invitation-marker');
INSERT INTO USERS VALUES('author','Fictional author','original@example.invalid',TRUE,CURRENT_TIMESTAMP),('reader','Fictional reader','reader@example.invalid',FALSE,NULL);
INSERT INTO USER_CREDENTIALS VALUES('author','original@example.invalid','original-credential-marker',TRUE,FALSE),('reader','reader@example.invalid','reader-credential-marker',TRUE,FALSE);
INSERT INTO AUTH_SESSIONS VALUES('original-session','refresh-marker');
INSERT INTO LINKEDIN_CONNECTIONS VALUES('author','integration-marker');
INSERT INTO POSTS VALUES('post','author','fictional preserved content');`);
  command('java', '-cp', h2Jar, 'org.h2.tools.RunScript', '-url', `jdbc:h2:file:${root}/live;MODE=MySQL`, '-user', 'sa', '-script', sql);
  writeFileSync(join(root, 'status'), 'running');
  const media = join(root, 'media'); mkdirSync(media); writeFileSync(join(media, 'image.bin'), 'fictional');
  const config = { format: 'enois-preview-ts-v1', state: join(root, 'private'), database: join(root, 'live.mv.db'), h2Jar,
    accounts: [{ id: 'author', email: 'author@enois.invalid', label: 'Author' }, { id: 'reader', email: 'reader@enois.invalid', label: 'Reader' }],
    media: [{ root: media, url: '/fixture/' }],
    service: { ...Object.fromEntries(['status','identity','stop','start','ready','released'].map(action => [action, [process.execPath, resolve('dist/test/fixtures/service.js'), root, action]])), expectedIdentity: 'fixture-backend', timeout: 2 } };
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

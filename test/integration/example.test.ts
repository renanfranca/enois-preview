import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Public source downloads and a real Maven/H2 preparation; run with npm run test:example.
test('Node prepares the pinned fictional workspace with versioned configuration and a usable Node service adapter',async()=>{
  const evidence=process.env.ENOIS_PREVIEW_EVIDENCE??mkdtempSync(join(tmpdir(),'enois-example-proof-'));mkdirSync(evidence,{recursive:true});
  const destination=join(evidence,'example-01');
  const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolvePromise,reject)=>{
    const child=spawn(process.execPath,[resolve('dist/example/prepare.js'),destination],{stdio:['ignore','pipe','pipe']});let stdout='';let stderr='';
    child.stdout.on('data',chunk=>{stdout+=String(chunk);});child.stderr.on('data',chunk=>{stderr+=String(chunk);});child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Example preparation timed out'));},1_800_000);
    child.on('close',code=>{clearTimeout(timer);resolvePromise({code,stdout,stderr});});
  });

  assert.equal(result.code,0,result.stderr);
  const manifest=JSON.parse(readFileSync(join(destination,'example-manifest.json'),'utf8'));
  assert.equal(manifest.format,'enois-preview-ts-v1');
  assert.deepEqual(manifest.observed,{users:4,posts:8,comments:6,replies:2,reactions:8,postsWithImages:3});
  assert.equal(manifest.canonicalDataSha256,'8e66e081f49ac81fb86d341c060bf1de641bd13f540b105b2d6ca84c51425b66');
  assert.equal(Object.keys(manifest.media).length,9);
  const config=JSON.parse(readFileSync(join(destination,'.preview/config.json'),'utf8'));
  assert.equal(config.format,'enois-preview-ts-v1');assert.equal(config.accounts.length,2);
  assert.equal(config.service.identity[0],process.execPath);assert.match(config.service.identity[1],/service\.js$/);
  const identity=spawnSync(config.service.identity[0],config.service.identity.slice(1),{encoding:'utf8'});
  assert.equal(identity.status,0,identity.stderr);assert.equal(identity.stdout.trim(),join(destination,'.preview/data/rede.mv.db'));
  const status=spawnSync(config.service.status[0],config.service.status.slice(1),{encoding:'utf8'});
  assert.equal(status.status,0,status.stderr);assert.equal(status.stdout.trim(),'stopped');
  assert.equal(statSync(join(destination,'.preview/service-environment.json')).mode&0o777,0o600);
  assert.doesNotMatch(result.stdout+result.stderr,/REDE_SECURITY_ENCRYPTION_KEY=/);
});

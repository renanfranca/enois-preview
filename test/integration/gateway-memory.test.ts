import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the real gateway streams 256 MiB under 128 MiB while bounding HEAD reads and releasing aborted responses',async()=>{
  const directory=await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE??tmpdir(),'enois-gateway-memory-'));const file=join(directory,'proof.json');
  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-gateway-memory.js',file],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>output+=String(chunk));child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Gateway memory verification timed out'));},180_000);
    child.on('close',code=>{clearTimeout(timer);done({code,output});});
  });
  assert.equal(result.code,0,result.output);const proof=JSON.parse(await readFile(file,'utf8'));
  assert.equal(proof.passed,true);assert.deepEqual(proof.containerLimits,{Memory:134217728,MemorySwap:134217728});
  assert.equal(proof.headReadBytes,4096);assert.deepEqual(proof.get,{bytes:268435456,sha256:'a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484'});
  assert.equal(proof.concurrentHeadCount,64);assert.equal(proof.concurrentHeadReadBytes,262144);assert.equal(proof.slowClientAdditionalBytes,0);
  assert.ok(proof.slowClientStreamedBytes<268435456);assert.ok(proof.afterAborts.descriptors<=proof.before.descriptors+2);
  assert.equal(proof.containerState.OOMKilled,false);assert.deepEqual(proof.finalHead,{status:200,contentLength:268435456,bodyBytes:0});
});

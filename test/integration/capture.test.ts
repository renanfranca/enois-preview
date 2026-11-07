import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { readRecord, sha, string } from '../../preview/state.js';

test('capture restores actual Spring readiness and preserves original synthetic logins while sanitizing only a private copy',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input,'Set ENOIS_PREVIEW_EXAMPLE_WORKSPACE to a prepared fictional workspace');
  const workspace=resolve(input);const config=await readRecord(join(workspace,'.preview/config.json'));
  const before=await sha(string(config.database));const evidence=join(workspace,'.preview',`host-capture-${randomUUID()}`);

  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-capture.js',workspace,evidence],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Real Spring capture verification timed out'));},600_000);
    child.on('close',code=>{clearTimeout(timer);done({code,output});});
  });

  assert.equal(result.code,0,result.output);const proof=await readRecord(join(evidence,'capture-validation.json'));
  assert.equal(proof.realSpringAndH2,true);assert.equal(proof.validOriginalLoginsBeforeCapture,4);
  assert.equal(proof.backendRestoredHealthyBeforeCaptureReturned,true);assert.equal(proof.originalLoginsStillValidAfterCapture,4);
  assert.equal(proof.originalLoginsRejectedInSanitizedCopy401,4);assert.equal(proof.capturedAdminPermissionPreserved,true);
  assert.equal(proof.localOnly,true);assert.equal(await sha(string(config.database)),before);
  assert.doesNotMatch(result.output,/120000:|password|REDE_SECURITY_ENCRYPTION_KEY=/i);
});

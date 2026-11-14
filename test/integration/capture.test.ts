import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { object, readRecord, sha, string } from '../../preview/state.js';

test('capture copies the H2 file of a running Spring backend without stopping it and warns that the file is in use',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input,'Set ENOIS_PREVIEW_EXAMPLE_WORKSPACE to a prepared fictional workspace');
  const workspace=resolve(input);const config=await readRecord(join(workspace,'.preview/config.json'));
  const before=await sha(string(config.database));const evidence=join(process.env.ENOIS_PREVIEW_EVIDENCE??tmpdir(),`host-capture-${randomUUID()}`);
  const stateBefore=(await readdir(join(workspace,'.preview'))).sort();

  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-capture.js',workspace,evidence],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});child.on('error',reject);
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Real Spring capture verification timed out'));},900_000);
    child.on('close',code=>{clearTimeout(timer);done({code,output});});
  });

  assert.equal(result.code,0,result.output);const proof=await readRecord(join(evidence,'capture-validation.json'));
  assert.equal(proof.realSpringAndH2,true);assert.equal(proof.backendRunningDuringCapture,true);assert.equal(proof.backendPidUnchanged,true);
  assert.equal(proof.inUseWarning,true);assert.ok((proof.warningCodes as string[]).includes('database-in-use'));assert.equal(proof.validOriginalLoginsBeforeCapture,4);
  assert.equal(proof.originalLoginsStillValidAfterCapture,4);
  assert.equal(proof.originalLoginsRejectedInSanitizedCopy401,4);assert.equal(proof.capturedAdminPermissionPreserved,true);
  assert.equal(proof.localOnly,true);assert.equal(await sha(string(config.database)),before);
  assert.deepEqual((await readdir(join(workspace,'.preview'))).sort(),stateBefore,'test:capture must not leave evidence in the example workspace');
  const durations=object(proof.durations);
  assert.deepEqual(durations.budgetsSeconds,{capturePhases:600});
  assert.ok(typeof durations.capturePhasesSeconds==='number'&&durations.capturePhasesSeconds>0&&durations.capturePhasesSeconds<=600,`capture phases took ${durations.capturePhasesSeconds} s`);
  assert.doesNotMatch(result.output,/120000:|password|REDE_SECURITY_ENCRYPTION_KEY=/i);
});

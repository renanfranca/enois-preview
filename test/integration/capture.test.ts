import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { object, readRecord, sha, string } from '../../preview/state.js';

test('capture restores actual Spring readiness and preserves original synthetic logins while sanitizing only a private copy',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input,'Set ENOIS_PREVIEW_EXAMPLE_WORKSPACE to a prepared fictional workspace');
  const workspace=resolve(input);const config=await readRecord(join(workspace,'.preview/config.json'));
  const before=await sha(string(config.database));const evidence=join(workspace,'.preview',`host-capture-${randomUUID()}`);

  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-capture.js',workspace,evidence],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});child.on('error',reject);
    // 600 s for the in-process capture phases plus 1200 s of its own for the cross-process restoration phase.
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Real Spring capture verification timed out'));},600_000+1_200_000);
    child.on('close',code=>{clearTimeout(timer);done({code,output});});
  });

  assert.equal(result.code,0,result.output);const proof=await readRecord(join(evidence,'capture-validation.json'));
  assert.equal(proof.realSpringAndH2,true);assert.equal(proof.interruptionAfterActualBackendStopped,true);assert.equal(proof.interruptedCaptureRestoredHealthy,true);assert.equal(proof.completeDataPreservedAfterInterruption,true);assert.equal(proof.validOriginalLoginsBeforeCapture,4);
  assert.equal(proof.backendRestoredHealthyBeforeCaptureReturned,true);assert.equal(proof.originalLoginsStillValidAfterCapture,4);
  assert.equal(proof.originalLoginsRejectedInSanitizedCopy401,4);assert.equal(proof.capturedAdminPermissionPreserved,true);
  assert.equal(proof.localOnly,true);assert.equal(await sha(string(config.database)),before);

  const crossProcess=object(proof.crossProcessI3);
  assert.equal(crossProcess.realSpringAndH2,true);assert.equal(crossProcess.logicalContentUnchanged,true);assert.equal(crossProcess.logicalSha256After,crossProcess.logicalSha256Before);
  assert.equal(crossProcess.originalLoginsValidAfterCrossProcess,4);assert.equal(crossProcess.independentServiceReady,true);
  for(const name of ['sigkill','timeout']){
    const variant=object(object(crossProcess.variants)[name]);const first=object(variant.firstProcess);
    if(name==='sigkill'){assert.deepEqual(first.exit,[null,'SIGKILL']);assert.equal(first.finallyRan,false);}
    else{assert.deepEqual(first.exit,[130,null]);assert.equal(first.stdoutEmpty,true);assert.equal(first.restorationPendingReported,true);}
    assert.deepEqual(variant.acceptedStopPendingAtFirstProcess,{recordShutdown:'requested',statusWhilePaused:'running',sigtermPending:true});
    assert.equal(variant.restorationPendingAfterFirstProcess,true);
    const window=object(variant.secondProcessWindow);
    assert.equal(window.secondProcessAlive,true);assert.equal(window.readyOrStartWhilePending,false);assert.equal(window.recordRetainedWithShutdown,true);assert.equal(window.sourceRefusalBeforeSettlement,false);
    assert.equal((window.events as string[])[0],'identity');assert.ok(!(window.events as string[]).some(action=>action==='ready'||action==='start'));
    for(const field of ['stoppedBeforeStart','startWithRecordWithoutShutdown','readyWithRecordPresent','dirtySourceRefusalAfterRecovery','newPid','pidfilePointsToLiveJvm','completeDataPreserved','independentServiceReady'])assert.equal(variant[field],true,`${name}.${field}`);
    assert.equal(variant.recordAfterRecovery,false);assert.equal(variant.finalStatus,'running');assert.equal(variant.operationsCreated,false);
  }
  assert.doesNotMatch(result.output,/120000:|password|REDE_SECURITY_ENCRYPTION_KEY=/i);
});

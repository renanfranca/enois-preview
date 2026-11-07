import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { readRecord, string } from '../../preview/state.js';

test('packaged demo email retains direct and asynchronous local effects while a positive observer sees zero external sends',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const evidence=await mkdtemp(join(workspace,'.preview/delivery-node-'));
  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-delivery.js',string(receipt.image),evidence],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>output+=String(chunk));child.on('error',reject);child.on('close',code=>done({code,output}));
  });

  assert.equal(result.code,0,result.output);const proof=await readRecord(join(evidence,'delivery-validation.json'));
  assert.equal(proof.positiveControlCalls,1);assert.equal(proof.demoTransportCalls,0);
  assert.equal(proof.eligibleAsyncNewsletterLocalEffect,true);assert.equal(proof.directEmailLocalEffect,true);
  assert.equal(proof.actualPackagedServices,true);assert.equal(proof.localOnly,true);
});

test('packaged scheduled services retain local effects while positive recording controls prove external HTTP writes are disabled',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const evidence=await mkdtemp(join(workspace,'.preview/integration-node-'));
  const result=await new Promise<{code:number|null;output:string}>((done,reject)=>{
    const child=spawn(process.execPath,['dist/scripts/validate-integration-isolation.js',string(receipt.image),evidence],{stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>output+=String(chunk));child.on('error',reject);child.on('close',code=>done({code,output}));
  });

  assert.equal(result.code,0,result.output);const proof=await readRecord(join(evidence,'integration-validation.json'));
  assert.ok(typeof proof.httpPositiveControlAttempts==='number'&&proof.httpPositiveControlAttempts>0);assert.equal(proof.demoHttpAttempts,0);
  assert.equal(proof.scheduledEntryPointsExercised,6);assert.equal(proof.eligibleExternalAssetDeletionCompleted,true);
  assert.equal(proof.externalStorageAndLazyMigrationAbsent,true);assert.equal(proof.pushDisabledAndApacheTransportAbsent,true);
  assert.equal(proof.actualPackagedApplication,true);assert.equal(proof.localOnly,true);
});

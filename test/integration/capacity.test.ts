import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { test } from 'node:test';
import { object,readRecord,run,string,writeRecord } from '../../preview/state.js';

test('actual HTTP reserves in-progress uploads and permits exactly one of two 2 MiB files when 254 MiB is occupied',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const record=await readRecord(join(string(receipt.directory),'journal.json'));
  const evidence=await mkdtemp(join(workspace,'.preview/capacity-node-'));
  await writeRecord(join(evidence,'journal.json'),{...record,target:{repository:'local/fixture',registry:'ghcr.io/local/fixture',branch:'local',origin:'https://local.invalid',cloudflareAccountId:'0'.repeat(32)}});

  await run([process.execPath,'dist/scripts/validate-capacity.js',string(receipt.image),evidence],{timeout:600,logPath:join(evidence,'capacity.log')});

  const proof=await readRecord(join(evidence,'capacity-evidence/capacity-validation.json'));const failures=object(proof.failureRecovery);
  assert.equal(proof.beforeRaceBytes,266338304);assert.equal(proof.freeBeforeRaceBytes,2097152);assert.equal(proof.validWavFiles,true);
  assert.ok(Array.isArray(proof.race));assert.deepEqual(proof.race.map(value=>object(value).status).sort(),[200,507]);
  assert.equal(failures.localActualHttp,true);assert.equal(failures.partialBodyHeldReservationWithCompeting507,true);assert.equal(failures.cancelledUploadUnreadable404,true);
  assert.equal(object(failures.afterCancellationSuccessfulUpload).storedBytes,2097152);assert.equal(failures.sanitizationFailed422AndUnreadable404,true);
  assert.equal(object(failures.afterProcessingFailureSuccessfulUpload).storedBytes,2097152);
  assert.equal(object(proof.physicalDeletionRestoredCapacityBySuccessfulUpload).storedBytes,20971520);assert.equal(proof.exerciseAssetDeletionRequestsCompleted,true);
});

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { test } from 'node:test';
import { validateLocal } from '../../preview/build.js';
import { journalRecord } from '../../preview/publication.js';
import { object,readRecord,run,string } from '../../preview/state.js';

test('the actual application accepts its supported media formats and a 50 MB audio upload, and refuses active SVG and path traversal',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const record=await readRecord(join(string(receipt.directory),'journal.json'));
  const journal=journalRecord({...record,target:{repository:'local/fixture',registry:'ghcr.io/local/fixture',branch:'local',origin:'https://local.invalid',cloudflareAccountId:'0'.repeat(32)}});
  const evidence=await mkdtemp(join(workspace,'.preview/mime-node-'));

  const result=await validateLocal(string(receipt.image),journal,evidence,async(origin,credentials,directory)=>{
    const output=await run([process.execPath,'dist/scripts/validate-media-contracts.js','--local'],{input:JSON.stringify({origin,credentials,evidence:directory,image:receipt.image,revision:journal.revision}),logPath:join(directory,'mime.log'),timeout:600});return JSON.parse(output.toString()) as unknown;
  });

  const proof=object(result.functionalEvidence);assert.ok(Array.isArray(proof.formats));assert.equal(proof.formats.length,13);
  assert.deepEqual(proof.formats.map(item=>object(item).mime).sort(),['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/quicktime','video/webm','audio/mpeg','audio/ogg','audio/wav','audio/webm','application/pdf'].sort());
  for(const value of proof.formats){const format=object(value);assert.equal(format.readable,true);assert.equal(format.metadataMarkerRemoved,true);assert.equal(format.decoded,format.mime!=='application/pdf');}
  for(const key of ['activeSvgUploadRejected400','traversalRefused'])assert.equal(proof[key],true,key);
  const large=object(proof.largeUpload);assert.equal(large.inputBytes,50_000_000);assert.equal(large.readable,true);assert.ok(typeof large.storedBytes==='number'&&large.storedBytes>0);
  assert.equal(proof.localOnly,true);assert.equal(proof.publicWorker,false);
});

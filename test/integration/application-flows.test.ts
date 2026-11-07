import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { validateLocal } from '../../preview/build.js';
import { journalRecord } from '../../preview/publication.js';
import { object, readRecord, run, string, writeRecord } from '../../preview/state.js';

test('independent fictional author and reader exercise blog distribution, ownership and disposable media through actual HTTP',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const localRecord=await readRecord(join(string(receipt.directory),'journal.json'));
  const journal=journalRecord({...localRecord,target:{repository:'local/fixture',registry:'ghcr.io/local/fixture',branch:'local',origin:'https://local.invalid',cloudflareAccountId:'0'.repeat(32)}});
  const evidence=await mkdtemp(join(workspace,'.preview/flows-node-'));

  const result=await validateLocal(string(receipt.image),journal,evidence,async(origin,credentials,directory)=>{
    const output=await run([process.execPath,'dist/scripts/validate-flows.js'],{input:JSON.stringify({origin,credentials,local:true,evidence:directory}),logPath:join(directory,'flows.log'),timeout:300});
    return JSON.parse(output.toString()) as unknown;
  });

  const flows=object(result.functionalEvidence);const blog=object(flows.blog);const media=object(flows.media);
  assert.equal(blog.positivePersonalizedFeed,true);assert.equal(blog.absentFromAll,true);assert.equal(blog.notification,true);assert.equal(blog.ownership,true);assert.equal(blog.unsubscribe,true);
  assert.equal(media.ownerUploadReadAttachDelete,true);assert.equal(media.foreignWriteDeleteRejected,true);assert.equal(media.malformedRejected,true);
  assert.equal(media.boundaryInputBytes,20971520);assert.equal(media.exact20MiBAccepted,true);assert.equal(media.oneByteLargerRejected,true);assert.equal(media.seedDeletionObserved,true);
  assert.equal(flows.signupBlocked,true);assert.equal(flows.localOnly,true);
});

test('actual desktop and mobile emulation authenticate through the hydrated form and render the complete fictional profile and illustrated feed',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const record=await readRecord(join(string(receipt.directory),'journal.json'));
  const journal=journalRecord({...record,target:{repository:'local/fixture',registry:'ghcr.io/local/fixture',branch:'local',origin:'https://local.invalid',cloudflareAccountId:'0'.repeat(32)}});
  const evidence=await mkdtemp(join(workspace,'.preview/browser-node-'));

  const result=await validateLocal(string(receipt.image),journal,evidence,async(origin,credentials,directory)=>{
    const accounts=object(credentials).accounts;assert.ok(Array.isArray(accounts));
    const output=await run([process.execPath,'dist/scripts/validate-example-browser.js'],{input:JSON.stringify({origin,account:accounts[0],accounts,evidence:directory}),logPath:join(directory,'browser.log'),timeout:300});
    return JSON.parse(output.toString()) as unknown;
  });

  const devices=result.functionalEvidence;assert.ok(Array.isArray(devices));assert.equal(devices.length,2);
  for(const [index,value]of devices.entries()){
    const device=object(value);assert.equal(device.width,[1280,390][index]);assert.equal(device.mobileEmulation,index===1);assert.equal(device.posts,8);
    assert.equal(device.hydrationRequiredBeforeLogin,true);assert.equal(device.nativeFallbackKeepsPasswordOutOfUrl,true);assert.equal(device.accountMenuNavigation,true);assert.equal(device.overflow,false);
    assert.ok(Array.isArray(device.feedImages));assert.ok(Array.isArray(device.profileImages));
    const feed=device.feedImages.map(value=>object(value));for(const path of ['/example.local/post-1.svg','/example.local/post-2.svg','/example.local/post-3.svg'])assert.ok(feed.some(image=>image.path===path));
    const profile=device.profileImages.map(value=>object(value));for(const path of ['/example.local/lia.svg','/example.local/cover.svg','/example.local/badge.svg'])assert.ok(profile.some(image=>image.path===path));
  }
});

test('restart and recreation restore the frozen seed, discard runtime edits and uploads, rotate credentials and remove processing orphans',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const receipt=await readRecord(join(workspace,'.preview/local-image-receipt.json'));const record=await readRecord(join(string(receipt.directory),'journal.json'));
  const evidence=await mkdtemp(join(workspace,'.preview/reset-node-'));
  await writeRecord(join(evidence,'journal.json'),{...record,target:{repository:'local/fixture',registry:'ghcr.io/local/fixture',branch:'local',origin:'https://local.invalid',cloudflareAccountId:'0'.repeat(32)}});

  await run([process.execPath,'dist/scripts/validate-example.js',string(receipt.image),evidence],{timeout:600,logPath:join(evidence,'example.log')});

  const restarted=await readRecord(join(evidence,'runtime-restart-validation.json'));const recreated=object((await readRecord(join(evidence,'recreation-validation.json'))).functionalEvidence);
  for(const proof of [restarted,recreated])for(const key of ['allPasswordsRotated','oldPasswordsRejected401','seedPostsRestored','runtimePostDiscarded','seedMediaRestored','oldUploadUrlStill404AfterNewUpload'])assert.equal(proof[key],true,key);
  assert.equal(restarted.orphanedProcessingFileRemoved,true);
});

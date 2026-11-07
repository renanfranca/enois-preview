import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { test } from 'node:test';
import { check as captureProof } from '../../scripts/validate-capture.js';
import { object,privateDir,readRecord,run,string,writeRecord } from '../../preview/state.js';
import { ROOT } from '../../preview/project.js';

test('every distributed application layer excludes four original password hashes that were physically present and authenticated in its fictional source',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);const workspace=resolve(input);
  const evidence=await mkdtemp(join(workspace,'.preview/layers-node-'));const captured=join(evidence,'original-controls');
  await captureProof(workspace,captured);
  const sql=await readFile(join(captured,'credentials.sql'),'utf8');const hashes=[...sql.matchAll(/PASSWORD_HASH='([^']+)'/g)].map(match=>match[1]);assert.equal(hashes.length,4);
  const source=await readFile(join(captured,'data/rede.mv.db'));for(const hash of hashes){assert.ok(hash);assert.equal(source.includes(Buffer.from(hash)),true,'Literal original hash must be physically present before sanitization');}
  const profile=await privateDir(join(evidence,'workspace'));await privateDir(join(profile,'.preview'));const original=await readRecord(join(workspace,'.preview/config.json'));
  const database=join(captured,'data/rede.mv.db');const actions=['identity','status','start','stop','released','ready'];
  const service={...Object.fromEntries(actions.map(action=>[action,[process.execPath,join(ROOT,'dist/preview/service.js'),join(captured,'live-service.json'),action]])),expectedIdentity:database,timeout:120};
  assert.ok(Array.isArray(original.media));const media=original.media.map((mapping:unknown,index:number)=>({url:string(object(mapping).url),root:join(captured,'media',String(index))}));
  await writeRecord(join(profile,'.preview/config.json'),{...original,workspace:profile,database,media,state:join(profile,'.preview/publication'),service});
  const imageEnvironment:NodeJS.ProcessEnv={...process.env,ENOIS_PREVIEW_EXAMPLE_WORKSPACE:profile};delete imageEnvironment.NODE_TEST_CONTEXT;
  await run([process.execPath,'--test','dist/test/integration/image.test.js'],{env:imageEnvironment,timeout:1800,logPath:join(evidence,'controlled-source-image.log')});
  const receipt=await readRecord(join(profile,'.preview/local-image-receipt.json'));const controls=join(evidence,'controls.json');await writeRecord(controls,{controls:{originalPasswordHashes:hashes}});

  await run([process.execPath,'dist/scripts/verify-image-secrets.js',string(receipt.image),'--values',controls,'--evidence',evidence],{timeout:1800,logPath:join(evidence,'layers.log')});

  const proof=await readRecord(join(evidence,'layer-validation.json'));assert.deepEqual(proof.matchedCategories,[]);assert.deepEqual(proof.controlCategories,['originalPasswordHashes']);
  assert.equal(proof.allDistributedLayersScanned,true);assert.equal(proof.deletedFilesIncluded,true);assert.ok(typeof proof.layers==='number'&&proof.layers>0);
  for(const hash of hashes){assert.ok(hash);assert.equal(JSON.stringify(proof).includes(hash),false);}
  await writeRecord(join(evidence,'source-control-validation.json'),{sourceHashesPhysicallyPresent:4,sourceOriginalLoginsValidated:4,privateSourceOnly:true,distributedImage:string(receipt.image),allDistributedLayersScanned:true,matchedCategories:[],scope:'four synthetic original PBKDF2 hashes in the actual source; not a universal secret scan'});
});

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { capture, commits, ROOT } from '../../preview/capture.js';
import { exportSources } from '../../preview/publication.js';
import type { Inputs, Journal } from '../../preview/publication.js';
import { buildImage, validateLocal } from '../../preview/build.js';
import { FORMAT, identity, inventory, object, privateDir, readRecord, run, string, writeRecord } from '../../preview/state.js';

// Actual Docker/application build. The provisional zero tool pin cannot pass publication verification.
test('Node builds the frozen fictional image without application tests and boots a migration that is out of order',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input,'Set ENOIS_PREVIEW_EXAMPLE_WORKSPACE to a fresh prepared fictional workspace');
  const workspace=resolve(input);const config=await readRecord(join(workspace,'.preview/config.json'));
  const versions=await commits(config);const data=await capture(config);
  const directory=await privateDir(await mkdtemp(join(workspace,'.preview/local-image-node-')));
  const frozen=await privateDir(join(directory,'frozen'));await cp(join(string(config.state),'data',data.id,'package'),join(frozen,'data'),{recursive:true});
  const sources=await privateDir(join(frozen,'sources'));const repositories:Record<string,string>={};for(const [name,path]of Object.entries(object(config.repositories)))repositories[name]=string(path);
  await exportSources({repositories},versions,sources);
  const migrations=join(sources,'enois-backend/src/main/resources/db/migration');
  const synthetic='V1.5__preview_out_of_order.sql';
  assert.equal((await readdir(migrations)).some(name=>/^V1\.5__/.test(name)),false);
  await writeFile(join(migrations,synthetic),'CREATE TABLE PREVIEW_OUT_OF_ORDER(ID INT PRIMARY KEY);\n');
  const failing=join(sources,'enois-backend/src/test/java/preview');await mkdir(failing,{recursive:true});
  await writeFile(join(failing,'PreviewAlwaysFailsTests.java'),'package preview;\nclass PreviewAlwaysFailsTests { @org.junit.jupiter.api.Test void alwaysFails() { throw new AssertionError("preview build must not run application tests"); } }\n');
  const recipe:Inputs['recipe']={};for(const name of ['recipe','runtime','src','dist']){recipe[name]=await inventory(join(ROOT,name));await cp(join(ROOT,name),join(frozen,name),{recursive:true});}
  const inputs:Inputs={format:FORMAT,scenario:'local-example',commits:versions,data:data.id,dataManifest:data,recipe,sourceFiles:await inventory(sources)};
  const revision=identity(inputs);const journal:Journal={format:FORMAT,revision,inputs,slug:`local-example-${revision.slice(0,16)}`,operation:'a'.repeat(32),target:{},frozenFiles:await inventory(frozen),checkpoints:{},stage:'localImage',intents:{},tool:{commit:null,verified:false}};
  await writeRecord(join(directory,'journal.json'),journal);

  const image=await buildImage(journal,directory);
  const inspection:unknown=JSON.parse((await run(['docker','image','inspect',image.id])).toString());assert.ok(Array.isArray(inspection));
  assert.deepEqual(object(object(inspection[0]).Config).Entrypoint,['node','/opt/render-demo/runtime/start.js']);
  const media:unknown=JSON.parse((await run([process.execPath,'dist/scripts/verify-image-media.js',image.id,'--manifest',join(directory,'journal.json')])).toString());
  assert.equal(object(media).mediaHashesMatch,true);assert.equal(object(media).mediaFiles,9);assert.equal(object(media).format,'enois-preview-ts-v1');
  const buildLog=await readFile(join(directory,'build.log'),'utf8');
  for(const marker of ['Tests run:','vitest','test:dist'])assert.equal(buildLog.includes(marker),false,`build.log must not show ${marker}`);
  let tables='';
  const validation=await validateLocal(image.id,journal,directory,async(_origin,_credentials,evidence,container)=>{
    await run(['docker','stop','--time','60',container],{timeout:120});
    const copy=join(evidence,'container-db');await mkdir(copy,{recursive:true});
    await run(['docker','cp',`${container}:/tmp/rede-db/rede.mv.db`,join(copy,'rede.mv.db')]);
    tables=(await run(['java','-cp',string(config.h2Jar),'org.h2.tools.Shell','-url',`jdbc:h2:file:${join(copy,'rede')};IFEXISTS=TRUE`,'-user','sa','-sql',"SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='PREVIEW_OUT_OF_ORDER'"])).toString();
    return {outOfOrderTable:tables.includes('PREVIEW_OUT_OF_ORDER')};
  });

  assert.equal(image.seedMediaVerified,true);assert.equal(image.licenseNoticesVerified,true);
  assert.match(tables,/PREVIEW_OUT_OF_ORDER/);
  assert.equal(validation.readiness,'UP');assert.equal(validation.accounts.length,2);assert.equal(validation.media.length,9);
  assert.deepEqual(validation.imageDecoding.map(row=>row.width),[1280,390]);
  assert.equal(validation.imageDecoding.every(row=>row.images.length===9),true);
  await writeRecord(join(directory,'local-build-proof.json'),{localOnly:true,publicToolPin:false,revision,image,validation});
  await writeRecord(join(workspace,'.preview/local-image-receipt.json'),{directory,revision,image:image.id,localOnly:true,publicToolPin:false});
});

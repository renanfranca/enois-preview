import assert from 'node:assert/strict';
import { lstat,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { create } from 'tar';
import { exists,run,writeRecord } from '../../preview/state.js';
import { exportPublic } from '../../scripts/export-public.js';

test('the private consumer installs with ignored lifecycle scripts and explicitly rebuilds the source dependency before its Worker dry run',async()=>{
  const evidence=await mkdtemp(join(process.env.ENOIS_PREVIEW_EVIDENCE??tmpdir(),'enois-consumer-build-'));
  const destination=join(evidence,'launcher');const generated=JSON.parse((await run([process.execPath,'dist/scripts/prepare-launcher.js',destination,'--repository','fixture/private-launcher','--tool-commit','a'.repeat(40),'--worker-name','fixture-preview'])).toString());assert.equal(generated.remoteWrites,false);
  await exportPublic(join(evidence,'public-source'));const archive=join(evidence,'public-source.tar.gz');await create({cwd:evidence,file:archive,gzip:true},['public-source']);
  const file=join(destination,'package.json');const pkg=JSON.parse(await readFile(file,'utf8'));const declared=pkg.devDependencies['enois-preview'];
  assert.equal(declared,'https://codeload.github.com/renanfranca/enois-preview/tar.gz/'+'a'.repeat(40));
  pkg.devDependencies['enois-preview']=`file:${archive}`;await writeFile(file,JSON.stringify(pkg));
  await run(['npm','install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,timeout:600,logPath:join(evidence,'lock.log')});
  await run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,timeout:600,logPath:join(evidence,'install.log')});
  const tool=join(destination,'node_modules/enois-preview');assert.equal((await lstat(tool)).isSymbolicLink(),false);await rm(join(tool,'dist'),{recursive:true,force:true});
  assert.equal(await exists(join(tool,'dist/src/worker.js')),false);

  await run(['npm','run','build'],{cwd:destination,timeout:600,logPath:join(evidence,'build.log')});

  assert.equal(await exists(join(tool,'dist/src/worker.js')),true);assert.equal(await exists(join(tool,'dist/preview/cli.js')),true);assert.equal(await exists(join(destination,'launcher.js')),false);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  await run(['npm','test'],{cwd:destination,env,timeout:600,logPath:join(evidence,'test.log')});
  const tests=await readFile(join(evidence,'test.log'),'utf8');assert.match(tests,/tests [1-9][0-9]+/);assert.match(tests,/fail 0/);assert.match(tests,/skipped 0/);
  await run(['npm','run','check'],{cwd:destination,timeout:120,logPath:join(evidence,'check.log')});
  await writeRecord(join(evidence,'consumer-build-validation.json'),{installationScriptsIgnored:true,dependencyDistAbsentBeforeBuild:true,explicitConsumerBuild:true,compiledWorkerVerified:true,privateLauncherSource:'launcher.ts',installedToolTestsPassed:true,workerDryRunPassed:true,publicArchiveDownloaded:false,transport:'reviewed public source tar substitutes only the unpublished GitHub source archive; npm pack is not that contract',remoteWrites:false});
});

test('the actual reviewed distribution exports the complete TypeScript source tree and no historical automation or private execution files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-real-public-export-'));
  try{
    const destination=join(directory,'public');

    const report=await exportPublic(destination);

    assert.equal(report.published,false);assert.equal(existsSync(join(destination,'.git')),false);
    for(const file of ['preview/cli.ts','src/entry.ts','shared/accounts.ts','runtime/start.ts','runtime/gateway.ts','recipe/prepare.ts','example/prepare.ts','scripts/add-scenario.ts','scripts/pin-scenario.ts','test/capture-journey.test.ts','test/integration/worker-upload.test.ts','tsconfig.json','tsconfig.cloudflare.json','runtime/DemoCredentials.java','recipe/Dockerfile'])assert.equal(existsSync(join(destination,file)),true,file);
    for(const file of ['EXECPLAN.md','.agent','runtime/start.sh','scripts/snapshot.py','preview/cli.py','src/worker.mjs','release/resume-compatible-tools.json'])assert.equal(existsSync(join(destination,file)),false,file);
    assert.deepEqual(JSON.parse(await readFile(join(destination,'catalog/scenarios.json'),'utf8')),{format:'enois-preview-ts-v1',scenarios:{}});
  }finally{await rm(directory,{recursive:true,force:true});}
});

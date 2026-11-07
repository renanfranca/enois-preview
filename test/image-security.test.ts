import assert from 'node:assert/strict';
import { chmod,mkdir,mkdtemp,rm,symlink,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { test } from 'node:test';
import { create } from 'tar';
import { scan } from '../scripts/verify-image-secrets.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

test('a credential split across read boundaries in a deleted lower image layer is still detected without exposing its value',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-image-controls-'));const secret='synthetic-original-credential-control-'+ 'x'.repeat(70000);
  try{
    await mkdir(join(directory,'lower'));await mkdir(join(directory,'upper'));
    await writeFile(join(directory,'lower/removed-private-file'),Buffer.concat([Buffer.alloc(1048576-7,120),Buffer.from(secret)]));await writeFile(join(directory,'upper/.wh.removed-private-file'),'');
    await create({file:join(directory,'lower/layer.tar'),cwd:join(directory,'lower')},['removed-private-file']);await create({file:join(directory,'upper/layer.tar'),cwd:join(directory,'upper')},['.wh.removed-private-file']);
    await writeFile(join(directory,'manifest.json'),JSON.stringify([{Layers:['lower/layer.tar','upper/layer.tar']}]));
    const image=join(directory,'image.tar');await create({file:image,cwd:directory},['manifest.json','lower/layer.tar','upper/layer.tar']);

    const proof=await scan(image,{credentials:[secret]});

    assert.deepEqual(proof.matchedCategories,['credentials']);assert.equal(proof.layers,2);assert.equal(proof.allDistributedLayersScanned,true);assert.equal(proof.deletedFilesIncluded,true);
    assert.equal(JSON.stringify(proof).includes(secret),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a valid empty distributed layer is inspected and counted instead of rejecting the image',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-empty-layer-'));
  try{
    await writeFile(join(directory,'layer.tar'),Buffer.alloc(1024));await writeFile(join(directory,'manifest.json'),JSON.stringify([{Layers:['layer.tar']}]));
    const archive=join(directory,'image.tar');await create({file:archive,cwd:directory},['manifest.json','layer.tar']);

    const proof=await scan(archive,{credentials:['synthetic-control-not-in-empty-layer']});

    assert.equal(proof.layers,1);assert.equal(proof.files,0);assert.equal(proof.scannedBytes,0);assert.deepEqual(proof.matchedCategories,[]);assert.equal(proof.allDistributedLayersScanned,true);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a malformed distributed layer cannot be reported as an inspected empty layer',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-invalid-layer-'));
  try{
    await writeFile(join(directory,'layer.tar'),'not a tar archive');await writeFile(join(directory,'manifest.json'),JSON.stringify([{Layers:['layer.tar']}]));
    const archive=join(directory,'image.tar');await create({file:archive,cwd:directory},['manifest.json','layer.tar']);

    await assert.rejects(scan(archive,{credentials:['synthetic-control-not-in-invalid-layer']}),/could not be inspected|must remain inspectable/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('historical image control records are refused by the CLI before creating evidence or accessing Docker',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-old-controls-'));
  try{
    const file=join(directory,'controls.json'),evidence=join(directory,'evidence');const before='{"credentials":["fictional-private-control"]}\n';await writeFile(file,before,{mode:0o600});
    const bin=join(directory,'bin');await mkdir(bin);const fixture=resolve('dist/test/fixtures/infrastructure.js');await chmod(fixture,0o755);await symlink(fixture,join(bin,'docker'));const log=join(directory,'docker.log');

    const result=spawnSync(process.execPath,['dist/scripts/verify-image-secrets.js','local/fixture','--values',file,'--evidence',evidence],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH??''}`,FIXTURE_PREFLIGHT_LOG:log}});

    assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
    assert.equal(existsSync(evidence),false);assert.equal(existsSync(log),false);assert.equal(await readFile(file,'utf8'),before);assert.doesNotMatch(result.stdout+result.stderr,/fictional-private-control/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('image verification releases its disposable container when the evidence directory is unavailable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-image-cleanup-'));
  try{
    const bin=join(directory,'bin');await mkdir(bin);const fixture=resolve('dist/test/fixtures/docker-command.js');await chmod(fixture,0o755);await symlink(fixture,join(bin,'docker'));await writeFile(join(directory,'platform.json'),'{}');
    const code=`import {verifyImage} from ${JSON.stringify(new URL('../preview/build.js',import.meta.url).href)};try{await verifyImage('fixture/image',{},process.argv[1]);process.exitCode=2;}catch{process.exitCode=1;}`;

    const result=spawnSync(process.execPath,['--input-type=module','-e',code,join(directory,'unavailable-evidence')],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH??''}`,FIXTURE_PLATFORM_ROOT:directory}});

    assert.equal(result.status,1);const commands=existsSync(join(directory,'docker-calls.log'))?(await readFile(join(directory,'docker-calls.log'),'utf8')).trim().split('\n'):[];assert.equal(commands.filter(command=>command==='create').length-commands.filter(command=>command==='rm').length,0,'No disposable image inspection container may remain owned after failure');
  }finally{await rm(directory,{recursive:true,force:true});}
});

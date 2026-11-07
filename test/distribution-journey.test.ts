import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir,mkdtemp,readFile,rm,symlink,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { object } from '../preview/state.js';
import { exportPublic } from '../scripts/export-public.js';

test('the local consumer generator pins an immutable public archive and produces a TypeScript launcher using the compiled public Worker',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-consumer-'));
  try{
    const destination=join(directory,'private-launcher'),commit='a'.repeat(40);

    const result=spawnSync(process.execPath,['dist/scripts/prepare-launcher.js',destination,'--repository','fixture/private-launcher','--tool-commit',commit,'--worker-name','fixture-preview'],{encoding:'utf8'});

    assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.remoteWrites,false);assert.equal(report.launchEnabled,false);
    const config=JSON.parse(await readFile(join(destination,'wrangler.jsonc'),'utf8'));assert.equal(config.main,'launcher.ts');assert.equal(config.vars.LAUNCH_ENABLED,'false');
    const pkg=JSON.parse(await readFile(join(destination,'package.json'),'utf8'));assert.equal(pkg.private,true);assert.equal(pkg.devDependencies['enois-preview'],`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${commit}`);
    assert.deepEqual(pkg.engines,{node:'>=24 <25'});
    assert.match(pkg.devDependencies['@types/node'],/^24\./);
    assert.equal(await readFile(join(destination,'.nvmrc'),'utf8'),'24\n');
    assert.deepEqual(JSON.parse(await readFile(join(destination,'tool.lock.json'),'utf8')),{format:'enois-preview-ts-v1',repository:'renanfranca/enois-preview',commit});
    assert.deepEqual(JSON.parse(await readFile(join(destination,'catalog/scenarios.json'),'utf8')),{format:'enois-preview-ts-v1',scenarios:{}});
    await mkdir(join(destination,'node_modules'));await symlink(resolve('.'),join(destination,'node_modules/enois-preview'),'dir');
    const bundle=await build({entryPoints:[join(destination,'launcher.ts')],bundle:true,write:false,format:'esm',platform:'browser'});assert.ok(bundle.outputFiles[0]);
    const loaded:unknown=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);const exports=object(loaded);assert.equal(typeof exports.Scenario,'function');
    const worker=object(exports.default),fetch=worker.fetch;assert.equal(typeof fetch,'function');
    const response:unknown=await Reflect.apply(fetch as (...args:unknown[])=>unknown,worker,[new Request('https://fixture.example/preview/unknown'),{GITHUB_REPOSITORY:'fixture/private-launcher',SCENARIOS:{idFromName:()=>{throw new Error('Unknown slug must not access infrastructure');}}}]);
    assert.ok(response instanceof Response);assert.equal(response.status,404);
    const repeated=spawnSync(process.execPath,['dist/scripts/prepare-launcher.js',destination,'--repository','fixture/private-launcher','--tool-commit','b'.repeat(40),'--worker-name','fixture-preview'],{encoding:'utf8'});
    assert.equal(repeated.status,1);assert.match(repeated.stderr,/existing files are never replaced/);assert.equal(JSON.parse(await readFile(join(destination,'tool.lock.json'),'utf8')).commit,commit);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('a mutable consumer tool reference is refused before any destination is created',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-unpinned-consumer-'));
  try{
    const destination=join(directory,'private-launcher');

    const result=spawnSync(process.execPath,['dist/scripts/prepare-launcher.js',destination,'--repository','fixture/private-launcher','--tool-commit','main','--worker-name','fixture-preview'],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/full immutable public tool commit/);assert.equal(existsSync(destination),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('release gate refuses disabled launch before deployment without creating a financial renewal record',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-disabled-release-'));
  try{
    await writeFile(join(directory,'wrangler.jsonc'),JSON.stringify({vars:{LAUNCH_ENABLED:'false'}}));

    const result=spawnSync(process.execPath,[resolve('dist/scripts/check-release.js')],{cwd:directory,encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/Launch is disabled/);assert.equal(existsSync(join(directory,'billing.json')),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('release validates the new pinned catalog without requiring recurring financial evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-pinned-release-'));
  try{
    await mkdir(join(directory,'catalog'));await writeFile(join(directory,'wrangler.jsonc'),JSON.stringify({vars:{LAUNCH_ENABLED:'true',GITHUB_REPOSITORY:'fixture/launcher'}}));
    await writeFile(join(directory,'catalog/scenarios.json'),JSON.stringify({format:'enois-preview-ts-v1',scenarios:{music:{format:'enois-preview-ts-v1',repository:'fixture/launcher',launcherCommit:'a'.repeat(40),image:`ghcr.io/fixture/image@sha256:${'b'.repeat(64)}`,devcontainerPath:'.devcontainer/music/devcontainer.json',provenanceSha256:'c'.repeat(64),revision:'d'.repeat(64),accounts:[{id:'author',email:'author@enois.invalid',label:'Author'}]}}}));
    const env={...process.env};delete env.DEMO_BILLING_EVIDENCE;

    const result=spawnSync(process.execPath,[resolve('dist/scripts/check-release.js')],{cwd:directory,env,encoding:'utf8'});

    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/only during initial setup/);assert.equal(existsSync(join(directory,'billing.json')),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('public export includes only reviewed sources and current migration evidence with a new empty catalog',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-public-export-'));
  try{
    const source=join(directory,'private'),destination=join(directory,'public');await mkdir(join(source,'release'),{recursive:true});
    await writeFile(join(source,'release/public-files.json'),JSON.stringify({format:'enois-preview-ts-v1',files:['.nvmrc','tool.ts']}));const code='export const publicValue = 1;\n';await writeFile(join(source,'tool.ts'),code);await writeFile(join(source,'.nvmrc'),'24\n');
    await writeFile(join(source,'VALIDATION.md'),'Private previous evidence marker\n## TypeScript migration evidence (6 November 2026)\nCurrent incomplete acceptance.\n');
    for(const path of ['.git/config','.env','catalog/scenarios.json','work/credentials.json','seed/rede.mv.db','unreviewed.ts']){await mkdir(join(source,path,'..'),{recursive:true});await writeFile(join(source,path),'private-sentinel-never-public');}

    const report=await exportPublic(destination,source);

    assert.equal(report.published,false);assert.equal(report.historyCopied,false);assert.equal(report.operationalCatalogEntries,0);
    assert.equal(await readFile(join(destination,'tool.ts'),'utf8'),code);assert.equal(existsSync(join(destination,'.git')),false);assert.equal(existsSync(join(destination,'unreviewed.ts')),false);assert.equal(existsSync(join(destination,'work')),false);
    assert.equal(await readFile(join(destination,'.nvmrc'),'utf8'),'24\n');
    assert.deepEqual(JSON.parse(await readFile(join(destination,'catalog/scenarios.json'),'utf8')),{format:'enois-preview-ts-v1',scenarios:{}});
    const validation=await readFile(join(destination,'VALIDATION.md'),'utf8');assert.match(validation,/Current incomplete acceptance/);assert.doesNotMatch(validation,/Private previous evidence marker|private-sentinel/);
    assert.equal(JSON.parse(await readFile(join(destination,'wrangler.jsonc'),'utf8')).vars.LAUNCH_ENABLED,'false');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('public export refuses existing destinations, traversal, symlinks and historical allowlists without overwriting operator files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-refused-export-'));
  try{
    const source=join(directory,'source'),destination=join(directory,'public');await mkdir(join(source,'release'),{recursive:true});await writeFile(join(source,'tool.ts'),'export {};');
    await writeFile(join(source,'.env'),'private-sentinel');await mkdir(join(source,'private'));await writeFile(join(source,'private/.nvmrc'),'private-sentinel');
    await mkdir(join(source,'.nvmrc'));await writeFile(join(source,'.nvmrc/nested'),'private-sentinel');
    await writeFile(join(source,'VALIDATION.md'),'## TypeScript migration evidence\nIncomplete.\n');const file=join(source,'release/public-files.json');
    await writeFile(file,JSON.stringify({format:'enois-preview-ts-v1',files:['tool.ts']}));await mkdir(destination);await writeFile(join(destination,'keep'),'operator data');

    await assert.rejects(exportPublic(destination,source),/new destination/);assert.equal(await readFile(join(destination,'keep'),'utf8'),'operator data');
    const fresh=join(directory,'fresh');await symlink(join(source,'tool.ts'),join(source,'public-link.ts'));
    for(const entry of ['../source/tool.ts','/absolute/path','.git/config','.env','private/.nvmrc','.nvmrc/nested','public-link.ts','catalog/scenarios.json','EXECPLAN.md']){
      await writeFile(file,JSON.stringify({format:'enois-preview-ts-v1',files:[entry]}));
      await assert.rejects(exportPublic(fresh,source));assert.equal(existsSync(fresh),false,entry);
    }
    await writeFile(file,JSON.stringify(['tool.ts']));const before=await readFile(file,'utf8');await assert.rejects(exportPublic(fresh,source),/Unsupported record format/);assert.equal(await readFile(file,'utf8'),before);assert.equal(existsSync(fresh),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('the public fictional verifier refuses a historical journal before creating evidence or contacting infrastructure',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-public-old-journal-'));
  try{
    const file=join(directory,'journal.json'),before='{"schema":3,"private":"fictional-original-marker"}\n';await writeFile(file,before);

    const result=spawnSync(process.execPath,['dist/scripts/validate-public-example.js',directory],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
    assert.equal(await readFile(file,'utf8'),before);assert.equal(existsSync(join(directory,'public-functional-evidence')),false);assert.doesNotMatch(result.stdout+result.stderr,/fictional-original-marker/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('the public lifecycle verifier refuses a historical journal before polling, deletion or evidence creation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-public-old-lifecycle-'));
  try{
    const file=join(directory,'journal.json'),before='{"schema":3,"private":"fictional-lifecycle-marker"}\n';await writeFile(file,before);

    const result=spawnSync(process.execPath,['dist/scripts/validate-public-lifecycle.js',directory],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
    assert.equal(await readFile(file,'utf8'),before);assert.equal(existsSync(join(directory,'public-lifecycle-evidence')),false);assert.doesNotMatch(result.stdout+result.stderr,/fictional-lifecycle-marker/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('the media verifier refuses historical credentials before creating local evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-old-media-credentials-'));
  try{
    const evidence=join(directory,'evidence');

    const result=spawnSync(process.execPath,['dist/scripts/validate-media-contracts.js','--local'],{encoding:'utf8',input:JSON.stringify({origin:'http://localhost:1',image:'local/fixture',revision:'a'.repeat(64),evidence,credentials:{email:'fictional-original-marker@enois.invalid',password:'fictional-private-marker'}})});

    assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);assert.equal(existsSync(evidence),false);assert.doesNotMatch(result.stdout+result.stderr,/fictional-original-marker|fictional-private-marker/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('diagnostic scenario preparation freezes versioned provenance and starts the Node supervisor without replacing an existing scenario',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-scenario-'));
  try{
    await mkdir(join(directory,'catalog'));await writeFile(join(directory,'catalog/scenarios.json'),JSON.stringify({format:'enois-preview-ts-v1',scenarios:{}}));
    const image=`ghcr.io/fixture/image@sha256:${'b'.repeat(64)}`,revision='d'.repeat(64),account={id:'author',email:'author@enois.invalid',label:'Author'};
    const proof=JSON.stringify({format:'enois-preview-ts-v1',revision,image,inputs:{dataManifest:{accounts:[account]}}})+'\n';await writeFile(join(directory,'proof.json'),proof);

    const result=spawnSync(process.execPath,[resolve('dist/scripts/add-scenario.js'),'music',image,'https://preview.example','fixture/launcher','proof.json'],{cwd:directory,encoding:'utf8'});

    assert.equal(result.status,0,result.stderr);const config=JSON.parse(await readFile(join(directory,'.devcontainer/music/devcontainer.json'),'utf8'));
    assert.equal(config.image,image);assert.deepEqual(config.postStartCommand,['node','/opt/render-demo/runtime/start.js','--daemon','--slug','music','--origin','https://preview.example']);
    assert.deepEqual(config.hostRequirements,{cpus:2,memory:'4gb',storage:'16gb'});assert.deepEqual(config.forwardPorts,[3000]);
    const item=JSON.parse(await readFile(join(directory,'.devcontainer/music/scenario.json'),'utf8'));assert.equal(item.format,'enois-preview-ts-v1');assert.equal(item.revision,revision);assert.deepEqual(item.accounts,[account]);assert.equal(item.launcherCommit,undefined);
    assert.equal(await readFile(join(directory,item.provenancePath),'utf8'),proof);
    const repeated=spawnSync(process.execPath,[resolve('dist/scripts/add-scenario.js'),'music',image,'https://preview.example','fixture/launcher','proof.json'],{cwd:directory,encoding:'utf8'});
    assert.equal(repeated.status,1);assert.deepEqual(JSON.parse(await readFile(join(directory,'.devcontainer/music/devcontainer.json'),'utf8')),config);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('diagnostic pinning verifies committed configuration and provenance and refuses dirty or repeated catalog publication',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'enois-pin-'));
  const git=(...args:string[])=>{const result=spawnSync('git',['-C',directory,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  try{
    await mkdir(join(directory,'catalog'));const catalogFile=join(directory,'catalog/scenarios.json'),initial=JSON.stringify({format:'enois-preview-ts-v1',scenarios:{}});await writeFile(catalogFile,initial);
    const image=`ghcr.io/fixture/image@sha256:${'b'.repeat(64)}`,proof=JSON.stringify({format:'enois-preview-ts-v1',revision:'d'.repeat(64),image,inputs:{dataManifest:{accounts:[{id:'author',email:'author@enois.invalid',label:'Author'}]}}});await writeFile(join(directory,'proof.json'),proof);
    const prepared=spawnSync(process.execPath,[resolve('dist/scripts/add-scenario.js'),'music',image,'https://preview.example','fixture/launcher','proof.json'],{cwd:directory,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
    git('init','-q');git('config','user.email','fixture@enois.invalid');git('config','user.name','Fixture');git('add','.');git('commit','-qm','fixture');const commit=git('rev-parse','HEAD');
    const configFile=join(directory,'.devcontainer/music/devcontainer.json'),original=await readFile(configFile,'utf8');await writeFile(configFile,original+' ');
    const invoke=()=>spawnSync(process.execPath,[resolve('dist/scripts/pin-scenario.js'),'music',commit],{cwd:directory,encoding:'utf8'});

    const dirty=invoke();assert.equal(dirty.status,1);assert.match(dirty.stderr,/committed configuration/);assert.equal(await readFile(catalogFile,'utf8'),initial);
    await writeFile(configFile,original);const pinned=invoke();

    assert.equal(pinned.status,0,pinned.stderr);const catalog=await readFile(catalogFile,'utf8'),entry=JSON.parse(catalog).scenarios.music;
    assert.equal(entry.launcherCommit,commit);assert.equal(entry.image,image);assert.equal(entry.format,'enois-preview-ts-v1');assert.equal(entry.revision,'d'.repeat(64));
    const repeated=invoke();assert.equal(repeated.status,1);assert.match(repeated.stderr,/Never replace/);assert.equal(await readFile(catalogFile,'utf8'),catalog);
  }finally{await rm(directory,{recursive:true,force:true});}
});

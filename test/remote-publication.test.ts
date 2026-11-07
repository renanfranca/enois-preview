import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, symlinkSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Publisher } from '../preview/remote.js';
import { GitHub, RemoteFailure } from '../preview/remote_http.js';
import type { Journal } from '../preview/publication.js';
import { validateConfig } from '../preview/config.js';
import { workspace, git } from './fixtures/workspace.js';

function command(directory: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', ...(input === undefined ? {} : { input }) });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function journal(letter: string): Journal {
  return { format: 'enois-preview-ts-v1', revision: letter.repeat(64), slug: `fixture-${letter.repeat(16)}`, operation: letter.repeat(32), target: {}, frozenFiles: {}, checkpoints: {}, intents: {}, stage: 'frozenInputs', inputs: {
    format: 'enois-preview-ts-v1', scenario: 'fixture', commits: { 'enois-backend':'1'.repeat(40), 'enois-frontend':'2'.repeat(40), 'enois-design-system':'3'.repeat(40) }, data: 'b'.repeat(64), toolCommit: '1'.repeat(40), recipe: {}, sourceFiles: {},
    dataManifest: { format: 'enois-preview-ts-v1', id: 'b'.repeat(64), accounts: [{ id:'author',email:'author@enois.invalid',label:'Author' }], permissions: { author: { admin:false,moderator:false } }, externalReads: [], media: [], files: {}, logicalSeedSha256:'c'.repeat(64),sanitizerSha256:'d'.repeat(64) }
  } };
}

function simulateGitHub(context: TestContext, bare: string): void {
    context.mock.method(GitHub.prototype, 'call', async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
      const data = body as { ref?: string; sha?: string; tree?: string; parents?: string[]; message?: string } | undefined;
      if (path.startsWith('git/ref/')) {
        const result = spawnSync('git',['-C',bare,'rev-parse','--verify',`refs/${path.slice('git/ref/'.length)}`],{encoding:'utf8'});
        if (result.status !== 0) throw new RemoteFailure(404);
        return { object: { sha: result.stdout.trim() } };
      }
      if (path.startsWith('git/commits/')) {
        const commit = path.slice('git/commits/'.length); const output = command(bare,['show','-s','--format=%T%n%B',commit]).split('\n');
        return { tree: { sha: output[0] }, message: output.slice(1).join('\n').trim() };
      }
      if (path === 'git/commits') {
        assert.ok(data?.tree && data.parents?.[0] && data.message);
        return { sha: command(bare,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',data.tree,'-p',data.parents[0]],data.message) };
      }
      if (path === 'git/refs') {
        assert.ok(data?.ref && data.sha);
        const update = spawnSync('git',['-C',bare,'update-ref',data.ref,data.sha,''],{encoding:'utf8'});
        if (update.status !== 0) throw new RemoteFailure(422);
        return { object: { sha: data.sha } };
      }
      if (path.startsWith('git/refs/') && method === 'DELETE') { command(bare,['update-ref','-d',`refs/${path.slice('git/refs/'.length)}`]); return null; }
      throw new Error(`Unexpected fixture route ${path}`);
    });
}

test('independent publishers serialize through an owned remote Git lease and never remove another operation', async context => {
  const root = mkdtempSync(join(tmpdir(),'enois-remote-'));
  try {
    const config = validateConfig({ ...workspace(root), leaseWaitSeconds: 0 });
    const bare = join(root,'remote.git'); mkdirSync(bare); git(bare,'init','--bare','-q');
    const seed = join(root,'launcher'); mkdirSync(seed); git(seed,'init','-q','-b','preview'); writeFileSync(join(seed,'source'),'fixture');
    git(seed,'add','.'); git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    git(seed,'remote','add','origin',bare); git(seed,'push','-q','origin','preview');
    simulateGitHub(context,bare);
    const first = new Publisher(config, journal('a'), join(root,'first'));
    const other = new Publisher(config, journal('c'), join(root,'other'));

    await first.acquireRemoteLease();
    await assert.rejects(other.acquireRemoteLease(), /Another remote publication/);

    assert.equal(command(bare,['show-ref','--verify',first.leaseRef]).split(' ')[0], first.journal.checkpoints.remoteLease && (first.journal.checkpoints.remoteLease as { commit: string }).commit);
    await assert.rejects(other.releaseRemoteLease(), /ownership/);
    await first.releaseRemoteLease(); await other.acquireRemoteLease(); await other.releaseRemoteLease();
    const ref = spawnSync('git',['-C',bare,'show-ref','--verify','--quiet',first.leaseRef]);
    assert.equal(ref.status, 1);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('configuration push acknowledgement loss reuses the retained Git commit and immutable provenance', async () => {
  const root = mkdtempSync(join(tmpdir(),'enois-config-'));
  const keys = ['PATH','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','FIXTURE_LOST_GIT_ACK'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    const config = validateConfig(workspace(root));
    const bare = join(root,'remote.git'); mkdirSync(bare); git(bare,'init','--bare','-q');
    const seed = join(root,'launcher'); mkdirSync(seed); git(seed,'init','-q','-b','preview');
    writeFileSync(join(seed,'wrangler.jsonc'),JSON.stringify({ main:'launcher.ts', vars:{GITHUB_REPOSITORY:'fixture/launcher',GITHUB_OWNER:'fixture'} }));
    writeFileSync(join(seed,'tool.lock.json'),JSON.stringify({format:'enois-preview-ts-v1',repository:'renanfranca/enois-preview',commit:config.toolCommit}));
    writeFileSync(join(seed,'package.json'),JSON.stringify({devDependencies:{'enois-preview':`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${config.toolCommit}`}}));
    git(seed,'add','.'); git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    git(seed,'remote','add','origin',bare); git(seed,'push','-q','origin','preview');
    process.env.GIT_CONFIG_COUNT='1'; process.env.GIT_CONFIG_KEY_0=`url.${bare}.insteadOf`; process.env.GIT_CONFIG_VALUE_0='https://github.com/fixture/launcher.git';
    const bin=join(root,'bin'); mkdirSync(bin); symlinkSync(resolve('dist/test/fixtures/git-command.js'),join(bin,'git')); chmodSync(resolve('dist/test/fixtures/git-command.js'),0o755);
    process.env.PATH=`${bin}:${previous.PATH ?? ''}`;
    const marker=join(root,'lose-ack'); writeFileSync(marker,'configuration'); process.env.FIXTURE_LOST_GIT_ACK=marker;
    const record=journal('a'); record.checkpoints.registry={ image:`ghcr.io/fixture/image@sha256:${'d'.repeat(64)}`,evidence:{designSystemSha256:'e'.repeat(64)} };
    const directory=join(root,'operation'); mkdirSync(join(directory,'frozen/sources'),{recursive:true}); writeFileSync(join(directory,'frozen/sources/source'),'frozen');
    writeFileSync(join(directory,'adjusted-sources.json'),JSON.stringify({format:'enois-preview-ts-v1',files:{source:{bytes:6,sha256:'e'.repeat(64)}}}));
    const first=new Publisher(config,record,directory);

    await assert.rejects(first.configuration(), /git failed/);

    const configurationCommit=command(bare,['rev-parse','refs/heads/preview']);
    assert.equal(command(bare,['rev-list','--count','preview']),'2');
    const resumed=new Publisher(config,record,directory);
    await resumed.configuration();
    assert.equal(command(bare,['rev-parse','refs/heads/preview']),configurationCommit);
    assert.equal(command(bare,['rev-list','--count','preview']),'2');
    assert.equal((record.checkpoints.configuration as {commit:string}).commit,configurationCommit);
    const proof=JSON.parse(command(bare,['show',`preview:catalog/provenance/${record.revision}.json`]));
    assert.equal(proof.format,'enois-preview-ts-v1');
    assert.equal(proof.revision,record.revision);
  } finally {
    for (const key of keys) { const value=previous[key]; if(value===undefined)delete process.env[key];else process.env[key]=value; }
    rmSync(root,{recursive:true,force:true});
  }
});

test('an existing Python publication lease is refused without creating a competing remote lease', async context => {
  const root=mkdtempSync(join(tmpdir(),'enois-old-lease-'));
  try {
    const config=validateConfig({...workspace(root),leaseWaitSeconds:0});
    const bare=join(root,'remote.git');mkdirSync(bare);git(bare,'init','--bare','-q');
    const seed=join(root,'seed');mkdirSync(seed);git(seed,'init','-q','-b','preview');writeFileSync(join(seed,'source'),'fixture');git(seed,'add','.');git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');git(seed,'remote','add','origin',bare);git(seed,'push','-q','origin','preview');
    const base=command(bare,['rev-parse','preview']);const tree=command(bare,['rev-parse',`${base}^{tree}`]);
    const old=command(bare,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-p',base],'enois-preview lease legacy-operation');
    command(bare,['update-ref','refs/heads/enois-preview-publication-lease',old]);
    simulateGitHub(context,bare);
    const publisher=new Publisher(config,journal('a'),join(root,'operation'));

    await assert.rejects(publisher.acquireRemoteLease(),/unsupported format/);

    assert.equal(command(bare,['rev-parse','refs/heads/enois-preview-publication-lease']),old);
    assert.equal(command(bare,['for-each-ref','--format=%(refname)','refs/heads/']).split('\n').length,2);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('catalog acknowledgement loss is reconciled and later publication preserves both immutable revisions', async () => {
  const root = mkdtempSync(join(tmpdir(),'enois-catalog-'));
  const keys = ['PATH','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','FIXTURE_LOST_GIT_ACK'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    const config = validateConfig(workspace(root));
    const bare = join(root,'remote.git'); mkdirSync(bare); git(bare,'init','--bare','-q');
    const seed = join(root,'launcher'); mkdirSync(seed); git(seed,'init','-q','-b','preview');
    writeFileSync(join(seed,'wrangler.jsonc'),JSON.stringify({ main:'launcher.ts', vars:{GITHUB_REPOSITORY:'fixture/launcher',GITHUB_OWNER:'fixture'} }));
    writeFileSync(join(seed,'tool.lock.json'),JSON.stringify({format:'enois-preview-ts-v1',repository:'renanfranca/enois-preview',commit:config.toolCommit}));
    writeFileSync(join(seed,'package.json'),JSON.stringify({devDependencies:{'enois-preview':`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${config.toolCommit}`}}));
    mkdirSync(join(seed,'catalog'));writeFileSync(join(seed,'catalog/scenarios.json'),JSON.stringify({format:'enois-preview-ts-v1',scenarios:{}}));
    git(seed,'add','.'); git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    git(seed,'remote','add','origin',bare); git(seed,'push','-q','origin','preview');
    process.env.GIT_CONFIG_COUNT='1'; process.env.GIT_CONFIG_KEY_0=`url.${bare}.insteadOf`; process.env.GIT_CONFIG_VALUE_0='https://github.com/fixture/launcher.git';
    const bin=join(root,'bin'); mkdirSync(bin); symlinkSync(resolve('dist/test/fixtures/git-command.js'),join(bin,'git')); chmodSync(resolve('dist/test/fixtures/git-command.js'),0o755);
    process.env.PATH=`${bin}:${previous.PATH ?? ''}`;
    const marker=join(root,'lose-ack'); writeFileSync(marker,'configuration'); process.env.FIXTURE_LOST_GIT_ACK=marker;
    const record=journal('a'); record.checkpoints.registry={ image:`ghcr.io/fixture/image@sha256:${'d'.repeat(64)}`,evidence:{designSystemSha256:'e'.repeat(64)} };
    const directory=join(root,'operation'); mkdirSync(join(directory,'frozen/sources'),{recursive:true}); writeFileSync(join(directory,'frozen/sources/source'),'frozen');
    writeFileSync(join(directory,'adjusted-sources.json'),JSON.stringify({format:'enois-preview-ts-v1',files:{source:{bytes:6,sha256:'e'.repeat(64)}}}));
    rmSync(marker);
    const first=new Publisher(config,record,directory);
    await first.configuration();
    const firstConfiguration=(record.checkpoints.configuration as {commit:string}).commit;
    writeFileSync(marker,'catalog');

    await assert.rejects(first.catalog(), /git failed/);

    const afterLostAck=command(bare,['rev-parse','preview']);
    await new Publisher(config,record,directory).catalog();
    assert.equal(command(bare,['rev-parse','preview']),afterLostAck);
    const otherRecord=journal('c');otherRecord.checkpoints.registry=record.checkpoints.registry;
    const otherDirectory=join(root,'other');mkdirSync(otherDirectory);cpSync(join(directory,'frozen'),join(otherDirectory,'frozen'),{recursive:true});cpSync(join(directory,'adjusted-sources.json'),join(otherDirectory,'adjusted-sources.json'));
    const other=new Publisher(config,otherRecord,otherDirectory);
    await other.configuration();await other.catalog();
    const catalog=JSON.parse(command(bare,['show','preview:catalog/scenarios.json']));
    assert.equal(catalog.format,'enois-preview-ts-v1');
    assert.deepEqual(Object.keys(catalog.scenarios).sort(),[record.slug,otherRecord.slug].sort());
    assert.equal(catalog.scenarios[record.slug].launcherCommit,firstConfiguration);
    assert.equal(command(bare,['rev-list','--count','preview']),'5');
  } finally {
    for (const key of keys) {const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
    rmSync(root,{recursive:true,force:true});
  }
});

test('registry acknowledgement loss reconciles the digest and verified image without a second push', async context => {
  const root=mkdtempSync(join(tmpdir(),'enois-registry-'));
  const previousPath=process.env.PATH;const previousRoot=process.env.FIXTURE_PLATFORM_ROOT;
  try {
    const config=validateConfig(workspace(root));const record=journal('a');
    const directory=join(root,'operation');mkdirSync(directory);
    const image=join(root,'image');mkdirSync(image);
    for(const name of ['seed','media','provenance','licenses'])mkdirSync(join(image,name));
    for(const name of ['enois-backend','enois-frontend','enois-design-system']) {
      mkdirSync(join(directory,'frozen/sources',name),{recursive:true});
      writeFileSync(join(directory,'frozen/sources',name,'LICENSE'),`Synthetic ${name} notice`);
      writeFileSync(join(image,'licenses',`${name}.LICENSE`),`Synthetic ${name} notice`);
    }
    mkdirSync(join(directory,'frozen/recipe'),{recursive:true});cpSync(resolve('recipe/licenses'),join(directory,'frozen/recipe/licenses'),{recursive:true});cpSync(resolve('recipe/licenses'),join(image,'licenses'),{recursive:true});
    writeFileSync(join(directory,'frozen/sources/enois-design-system/package.json'),'{"version":"1.0.0"}');
    writeFileSync(join(image,'provenance/design-system.tgz'),'synthetic package');
    writeFileSync(join(image,'provenance/frontend-package-lock.json'),JSON.stringify({packages:{'node_modules/@rede-enois/design-system':{version:'1.0.0',resolved:'file:../design-system.tgz'}}}));
    writeFileSync(join(root,'platform.json'),JSON.stringify({revision:record.revision,pushes:0,present:false}));writeFileSync(join(root,'lose-registry-ack'),'');
    const bin=join(root,'bin');mkdirSync(bin);symlinkSync(resolve('dist/test/fixtures/docker-command.js'),join(bin,'docker'));chmodSync(resolve('dist/test/fixtures/docker-command.js'),0o755);
    process.env.PATH=`${bin}:${previousPath??''}`;process.env.FIXTURE_PLATFORM_ROOT=root;
    context.mock.method(GitHub.prototype,'credentials',async()=> 'fixture-only');
    context.mock.method(globalThis,'fetch',async (input: string|URL|Request):Promise<Response>=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.pathname==='/token')return Response.json({token:'fixture-only'});
      const state=JSON.parse(readFileSync(join(root,'platform.json'),'utf8'));
      if(url.pathname.includes('/manifests/')&&state.present)return new Response('{"schemaVersion":2}',{headers:{'Docker-Content-Digest':'sha256:bafebd36189ad3688b7b3915ea55d461e0bfcfbdde11e54b0a123999fb6be50f'}});
      return new Response(null,{status:404});
    });
    record.checkpoints.localImage={id:`sha256:${'c'.repeat(64)}`};
    const first=new Publisher(config,record,directory);

    await assert.rejects(first.registry(),/docker failed/);

    await new Publisher(config,record,directory).registry();
    const state=JSON.parse(readFileSync(join(root,'platform.json'),'utf8'));
    assert.equal(state.pushes,1);
    assert.equal((record.checkpoints.registry as {image:string}).image,'ghcr.io/fixture/image@sha256:bafebd36189ad3688b7b3915ea55d461e0bfcfbdde11e54b0a123999fb6be50f');
    assert.equal((record.checkpoints.registry as {evidence:{seedMediaVerified:boolean}}).evidence.seedMediaVerified,true);
  }finally{
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
    if(previousRoot===undefined)delete process.env.FIXTURE_PLATFORM_ROOT;else process.env.FIXTURE_PLATFORM_ROOT=previousRoot;
    rmSync(root,{recursive:true,force:true});
  }
});

test('deployment acknowledgement loss reconciles the current catalog and retains the newest fractional timestamp', async context=>{
  const root = mkdtempSync(join(tmpdir(),'enois-deploy-'));
  const keys = ['PATH','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','FIXTURE_LOST_GIT_ACK'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    const config = validateConfig(workspace(root));
    const bare = join(root,'remote.git'); mkdirSync(bare); git(bare,'init','--bare','-q');
    const seed = join(root,'launcher'); mkdirSync(seed); git(seed,'init','-q','-b','preview');
    writeFileSync(join(seed,'wrangler.jsonc'),JSON.stringify({ main:'launcher.ts', vars:{GITHUB_REPOSITORY:'fixture/launcher',GITHUB_OWNER:'fixture'} }));
    writeFileSync(join(seed,'tool.lock.json'),JSON.stringify({format:'enois-preview-ts-v1',repository:'renanfranca/enois-preview',commit:config.toolCommit}));
    writeFileSync(join(seed,'package.json'),JSON.stringify({devDependencies:{'enois-preview':`https://codeload.github.com/renanfranca/enois-preview/tar.gz/${config.toolCommit}`}}));
    mkdirSync(join(seed,'catalog'));writeFileSync(join(seed,'catalog/scenarios.json'),JSON.stringify({format:'enois-preview-ts-v1',scenarios:{}}));
    git(seed,'add','.'); git(seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
    git(seed,'remote','add','origin',bare); git(seed,'push','-q','origin','preview');
    process.env.GIT_CONFIG_COUNT='1'; process.env.GIT_CONFIG_KEY_0=`url.${bare}.insteadOf`; process.env.GIT_CONFIG_VALUE_0='https://github.com/fixture/launcher.git';
    const bin=join(root,'bin'); mkdirSync(bin); symlinkSync(resolve('dist/test/fixtures/git-command.js'),join(bin,'git')); chmodSync(resolve('dist/test/fixtures/git-command.js'),0o755);
    process.env.PATH=`${bin}:${previous.PATH ?? ''}`;
    const marker=join(root,'lose-ack'); writeFileSync(marker,'configuration'); process.env.FIXTURE_LOST_GIT_ACK=marker;
    const record=journal('a'); record.checkpoints.registry={ image:`ghcr.io/fixture/image@sha256:${'d'.repeat(64)}`,evidence:{designSystemSha256:'e'.repeat(64)} };
    const directory=join(root,'operation'); mkdirSync(join(directory,'frozen/sources'),{recursive:true}); writeFileSync(join(directory,'frozen/sources/source'),'frozen');
    writeFileSync(join(directory,'adjusted-sources.json'),JSON.stringify({format:'enois-preview-ts-v1',files:{source:{bytes:6,sha256:'e'.repeat(64)}}}));
    rmSync(marker);
    const publisher=new Publisher(config,record,directory);await publisher.configuration();await publisher.catalog();
    const previousRoot=process.env.FIXTURE_PLATFORM_ROOT;process.env.FIXTURE_PLATFORM_ROOT=root;
    try {
      for(const name of ['npm','npx'])symlinkSync(resolve('dist/test/fixtures/deploy-command.js'),join(bin,name));chmodSync(resolve('dist/test/fixtures/deploy-command.js'),0o755);
      writeFileSync(join(root,'platform.json'),JSON.stringify({deploys:0,deployed:null}));writeFileSync(join(root,'lose-deploy-ack'),'');
      simulateGitHub(context,bare);
      context.mock.method(globalThis,'fetch',async()=>{const state=JSON.parse(readFileSync(join(root,'platform.json'),'utf8'));return state.deployed?Response.json(state.deployed):new Response(null,{status:404});});

      await assert.rejects(publisher.deploy(),/npx failed/);

      await new Publisher(config,record,directory).deploy();
      assert.equal(JSON.parse(readFileSync(join(root,'platform.json'),'utf8')).deploys,1);
      assert.equal((record.checkpoints.deployment as {identity:{id:string}}).identity.id,'newer');
      assert.equal((record.checkpoints.deployment as {identity:{created_on:string}}).identity.created_on,'2026-11-06T10:00:00.1234568Z');
    }finally{if(previousRoot===undefined)delete process.env.FIXTURE_PLATFORM_ROOT;else process.env.FIXTURE_PLATFORM_ROOT=previousRoot;}
  }finally{for(const key of keys){const value=previous[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});}
});

test('an unresolved registry push refuses a competing artifact before any Docker command',async context=>{
  const root=mkdtempSync(join(tmpdir(),'enois-registry-ambiguous-'));const beforePath=process.env.PATH;const beforeRoot=process.env.FIXTURE_PLATFORM_ROOT;
  try{
    const config=validateConfig(workspace(root));const record=journal('a');const directory=join(root,'operation');mkdirSync(directory);
    record.checkpoints.localImage={id:`sha256:${'c'.repeat(64)}`};record.intents.registry={tag:`preview-${record.revision}`,pushAttempted:true};
    writeFileSync(join(root,'platform.json'),JSON.stringify({revision:record.revision,pushes:0,present:false}));
    const bin=join(root,'bin');mkdirSync(bin);symlinkSync(resolve('dist/test/fixtures/docker-command.js'),join(bin,'docker'));chmodSync(resolve('dist/test/fixtures/docker-command.js'),0o755);
    process.env.PATH=`${bin}:${beforePath??''}`;process.env.FIXTURE_PLATFORM_ROOT=root;
    context.mock.method(GitHub.prototype,'credentials',async()=> 'fixture-only');
    context.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>new URL(input instanceof Request?input.url:String(input)).pathname==='/token'?Response.json({token:'fixture-only'}):new Response(null,{status:404}));

    await assert.rejects(new Publisher(config,record,directory).registry(),/Registry push outcome is unresolved.*do not push a competing artifact/);

    assert.equal(existsSync(join(root,'docker-calls.log')),false);assert.equal(JSON.parse(readFileSync(join(root,'platform.json'),'utf8')).pushes,0);
    assert.equal(record.checkpoints.registry,undefined);assert.equal(record.intents.registry.pushAttempted,true);
  }finally{if(beforePath===undefined)delete process.env.PATH;else process.env.PATH=beforePath;if(beforeRoot===undefined)delete process.env.FIXTURE_PLATFORM_ROOT;else process.env.FIXTURE_PLATFORM_ROOT=beforeRoot;rmSync(root,{recursive:true,force:true});}
});

import { workspace, git } from './fixtures/workspace.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

async function initialSetup(home:string,file:string,answer:string,env:NodeJS.ProcessEnv=process.env):Promise<{code:number|null;output:string}>{
  const command=[process.execPath,resolve('dist/preview/cli.js'),'--home',home,'setup','--config',file].map(value=>"'"+value.replaceAll("'","'\\''")+"'").join(' ');
  return new Promise((done,reject)=>{
    const child=spawn('script',['--return','--quiet','--command',command,'/dev/null'],{env,stdio:['pipe','pipe','pipe']});let output='';let answered=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Initial setup terminal timed out'));},10_000);
    child.stdin.on('error',()=>{});child.on('error',reject);
    const receive=(chunk:Buffer)=>{output+=String(chunk);if(!answered&&output.includes('Type yes:')){answered=true;child.stdin.write(`${answer}\n`);}};
    child.stdout.on('data',receive);child.stderr.on('data',receive);child.on('close',code=>{clearTimeout(timer);done({code,output});});
  });
}

test('installed CLI explains setup, frozen publication and resume through Node without Python', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-cli-'));
  try {
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', directory, '--json'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const archive: unknown = JSON.parse(packed.stdout);
    assert.ok(Array.isArray(archive) && archive[0] && typeof archive[0].filename === 'string');
    const files=archive[0].files as {path:string}[];
    assert.ok(files.some(file=>file.path==='dist/preview/cli.js'));
    assert.ok(files.some(file=>file.path==='preview/cli.ts'));
    assert.ok(files.some(file=>file.path==='.nvmrc'));
    assert.deepEqual(files.filter(file=>file.path==='EXECPLAN.md'||file.path.startsWith('.agent/')||/\.(?:py|mjs|sh)$/.test(file.path)),[],'Distribute TypeScript and generated JavaScript without historical automation or private execution documents');
    const install = spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefix', directory, join(directory, archive[0].filename)], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    const installed=join(directory,'node_modules/enois-preview');
    assert.deepEqual(JSON.parse(readFileSync(join(installed,'package.json'),'utf8')).engines,{node:'>=24 <25'});
    assert.equal(readFileSync(join(installed,'.nvmrc'),'utf8'),'24\n');
    mkdirSync(join(directory, 'bin'));
    symlinkSync(process.execPath, join(directory, 'bin/node'));

    const result = spawnSync(join(directory,'node_modules/.bin/enois-preview'), ['--help'], { encoding: 'utf8', env: { ...process.env, PATH: join(directory, 'bin') } });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /enois-preview/);
    assert.match(result.stdout, /setup/);
    assert.match(result.stdout, /publish/);
    assert.match(result.stdout, /--refresh-data/);
    assert.match(result.stdout, /resume/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the declared CLI executable remains usable through a launcher symlink after an explicit build',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-rebuilt-bin-'));
  try{
    const pkg=JSON.parse(readFileSync('package.json','utf8')),binary=resolve(pkg.bin['enois-preview']);
    const link=join(directory,'enois-preview');symlinkSync(binary,link);mkdirSync(join(directory,'bin'));symlinkSync(process.execPath,join(directory,'bin/node'));

    const result=spawnSync(link,['--help'],{encoding:'utf8',env:{...process.env,PATH:join(directory,'bin')}});

    assert.equal(result.status,0,result.error?.message??result.stderr);assert.match(result.stdout,/enois-preview/);assert.match(result.stdout,/setup/);assert.match(result.stdout,/resume/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('legacy installation is refused before any mutation with fresh installation guidance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-legacy-'));
  try {
    const bytes = '{"schema":1,"secret":"private-sentinel"}\n';
    writeFileSync(join(directory, 'config.json'), bytes);

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', directory, 'setup'], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /enois-preview-ts-v1/);
    assert.match(result.stderr, /fresh installation/i);
    assert.doesNotMatch(result.stderr, /private-sentinel/);
    assert.equal(readFileSync(join(directory, 'config.json'), 'utf8'), bytes);
    assert.deepEqual(readdirSync(directory), ['config.json']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('every dirty application blocks publication without invoking the backend or changing source state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-source-'));
  try {
    const config = workspace(directory);
    const home = join(directory, 'home'); mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    for (const path of Object.values(config.repositories)) {
      for (const kind of ['unstaged', 'staged', 'untracked']) {
        const file = join(path, kind === 'untracked' ? 'new' : 'source'); writeFileSync(file, 'pending');
        if (kind === 'staged') git(path, 'add', '.');
        const head = git(path, 'rev-parse', 'HEAD'); const before = git(path, 'status', '--porcelain=v1', '--untracked-files=all');

        const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'publish', 'fixture'], { encoding: 'utf8' });

        assert.equal(result.status, 1);
        assert.match(result.stderr, /No service was stopped/);
        assert.equal(git(path, 'rev-parse', 'HEAD'), head);
        assert.equal(git(path, 'status', '--porcelain=v1', '--untracked-files=all'), before);
        assert.equal(existsSync(join(config.state, 'restoration.json')), false);
        assert.equal(existsSync(join(config.state, 'data')), false);
        git(path, 'reset', '--hard', '-q'); if (kind === 'untracked') rmSync(file);
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('new noninteractive setup requires its own initial financial confirmation before creating installation state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-setup-'));
  try {
    const configuration = workspace(directory);
    const { installation: _previous, ...input } = configuration;
    const file = join(directory, 'input.json'); writeFileSync(file, JSON.stringify(input));
    const home = join(directory, 'fresh-home');

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'setup', '--config', file], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Initial Free plan verification required/);
    assert.match(result.stderr, /interactive local terminal/);
    assert.equal(existsSync(home), false);
    assert.equal(existsSync(input.state), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('repeated setup preserves the original confirmation and private values after controlled infrastructure preflight', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enois-repeat-'));
  try {
    const base = workspace(directory);
    const config = { ...base, service: { ...base.service, identity: [process.execPath, '-e', 'console.log("fixture")'] }, privateCredentialStore: 'fixture-reference-only' };
    writeFileSync(config.database, 'fictional'); writeFileSync(config.h2Jar, 'fixture');
    const home = join(directory, 'home'); mkdirSync(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify(config));
    const input = join(directory, 'input.json'); writeFileSync(input, JSON.stringify({ format: 'enois-preview-ts-v1', repository: 'fixture/launcher' }));
    const bin = join(directory, 'bin'); mkdirSync(bin);
    for (const executable of ['gh', 'docker', 'npx']) symlinkSync(resolve('dist/test/fixtures/infrastructure.js'), join(bin, executable));
    chmodSync(resolve('dist/test/fixtures/infrastructure.js'), 0o755);
    const log = join(directory, 'preflight.log');

    const result = spawnSync(process.execPath, ['dist/preview/cli.js', '--home', home, 'setup', '--config', input], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FIXTURE_PREFLIGHT_LOG: log } });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installation verified/);
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')), config);
    const commands = readFileSync(log, 'utf8');
    assert.match(commands, /docker info/);
    assert.match(commands, /gh api repos\/fixture\/launcher/);
    assert.match(commands, /npx --no-install wrangler whoami/);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-reference-only/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('setup refuses private state reached through an application directory alias before preflight or writes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-state-location-'));
  try{
    const base=workspace(directory);const backend=base.repositories['enois-backend'];assert.ok(backend);
    const alias=join(directory,'alias');symlinkSync(backend,alias,'dir');
    const config={...base,state:join(alias,'private-state')};const input=join(directory,'input.json');writeFileSync(input,JSON.stringify(config));
    const home=join(directory,'home');mkdirSync(home);const file=join(home,'config.json');const before=JSON.stringify(base);writeFileSync(file,before);

    const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,'setup','--config',input],{encoding:'utf8'});

    assert.equal(result.status,1);assert.match(result.stderr,/Private state must be outside application repositories/);
    assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(config.state),false);assert.deepEqual(readdirSync(home),['config.json']);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('invalid command arguments are refused before service recovery or publication writes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-arguments-'));
  try{
    const config=workspace(directory);const home=join(directory,'home');mkdirSync(home);
    const file=join(home,'config.json');const before=JSON.stringify(config);writeFileSync(file,before);
    for(const args of [['setup','extra'],['setup','--refresh-data'],['publish'],['publish','fixture','extra'],['publish','fixture','--config',file],['resume'],['resume','a'.repeat(64),'extra'],['resume','a'.repeat(64),'--refresh-data']]){
      const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,...args],{encoding:'utf8'});

      assert.equal(result.status,1);assert.match(result.stderr,/Invalid command arguments.*--help/,args.join(' '));
      assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(config.state),false);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('declining initial setup in a real terminal preserves the supplied configuration and creates no installation',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-declined-setup-'));
  try{
    const {installation:_old,...config}=workspace(directory);const file=join(directory,'input.json');const before=JSON.stringify(config);writeFileSync(file,before);
    const home=join(directory,'home');

    const result=await initialSetup(home,file,'no');

    assert.equal(result.code,1,result.output);assert.match(result.output,/Installation verification declined/);
    assert.equal(readFileSync(file,'utf8'),before);assert.equal(existsSync(home),false);assert.equal(existsSync(config.state),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('affirmative initial setup in a real terminal records the configured identities after controlled preflight',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-confirmed-setup-'));
  try{
    const {installation:_old,...base}=workspace(directory);const config={...base,service:{...base.service,identity:[process.execPath,'-e','console.log("fixture")']}};
    writeFileSync(config.database,'fictional');writeFileSync(config.h2Jar,'fixture');
    const file=join(directory,'input.json');const before=JSON.stringify(config);writeFileSync(file,before);const home=join(directory,'home');
    const bin=join(directory,'bin');mkdirSync(bin);for(const name of ['gh','docker','npx'])symlinkSync(resolve('dist/test/fixtures/infrastructure.js'),join(bin,name));chmodSync(resolve('dist/test/fixtures/infrastructure.js'),0o755);
    const started=Date.now();

    const result=await initialSetup(home,file,'yes',{...process.env,PATH:`${bin}:${process.env.PATH??''}`,FIXTURE_PREFLIGHT_LOG:join(directory,'preflight.log')});

    assert.equal(result.code,0,result.output);const stored=JSON.parse(readFileSync(join(home,'config.json'),'utf8'));
    assert.deepEqual(stored.installation,{githubOwner:'fixture',cloudflareAccountId:'a'.repeat(32),freePlansAndSpendingBlocksConfirmed:true,checkedAt:stored.installation.checkedAt});
    assert.ok(Date.parse(stored.installation.checkedAt)>=started&&Date.parse(stored.installation.checkedAt)<=Date.now());
    const {installation:_new,...preserved}=stored;assert.deepEqual(preserved,config);assert.equal(readFileSync(file,'utf8'),before);
    assert.deepEqual(readdirSync(config.state),[]);assert.match(result.output,/Installation verified/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('historical scenario pointers and operation journals are refused by the CLI before creating locks or changing records',()=>{
  const directory=mkdtempSync(join(tmpdir(),'enois-historical-state-'));
  try{
    const config=workspace(directory);const home=join(directory,'home');mkdirSync(home);writeFileSync(join(home,'config.json'),JSON.stringify(config));
    const revision='a'.repeat(64);mkdirSync(join(config.state,'scenarios'),{recursive:true});mkdirSync(join(config.state,'operations',revision),{recursive:true});
    const pointer=join(config.state,'scenarios/fixture.json');const journal=join(config.state,'operations',revision,'journal.json');
    const original='{"schema":3,"data":"historical-private-fixture"}\n';writeFileSync(pointer,original);writeFileSync(journal,original);
    const before=readdirSync(config.state,{recursive:true}).sort();
    for(const args of [['publish','fixture'],['resume',revision]]){

      const result=spawnSync(process.execPath,['dist/preview/cli.js','--home',home,...args],{encoding:'utf8'});

      assert.equal(result.status,1);assert.match(result.stderr,/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);
      assert.doesNotMatch(result.stderr,/historical-private-fixture/);assert.equal(readFileSync(pointer,'utf8'),original);assert.equal(readFileSync(journal,'utf8'),original);
      assert.deepEqual(readdirSync(config.state,{recursive:true}).sort(),before);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

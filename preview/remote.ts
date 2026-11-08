import { join } from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Journal } from './publication.js';
import { GitHub, RemoteFailure, request } from './remote_http.js';
import { buildImage, validateLocal, verifyImage } from './build.js';
import { Session, validate } from './validation.js';
import type { ValidationResult } from './validation.js';
import { canonical, exists, FORMAT, identity, inventory, object, PreviewError, privateDir, readRecord, requireFormat, run, string, commandRunner, writeRecord } from './state.js';

function refSha(value: unknown): string {
  const sha = string(object(object(value).object).sha);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new PreviewError('GitHub returned an invalid Git identity.');
  return sha;
}
function deploymentInstant(value: unknown): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(string(value));
  if (!match?.[1] || !match[3]) throw new PreviewError('Cloudflare returned an unsupported deployment timestamp; inspect private metadata and resume.');
  const seconds = Date.parse(match[1]+match[3]);
  if (!Number.isFinite(seconds)) throw new PreviewError('Cloudflare returned an invalid deployment timestamp.');
  return BigInt(seconds)*1_000_000n+BigInt((match[2]??'').padEnd(9,'0'));
}
export class Publisher {
  readonly github: GitHub;
  private readonly command: typeof run;
  readonly leaseRef = 'refs/heads/enois-preview-publication-lease';
  get checkout(): string { return join(this.directory,'launcher'); }
  constructor(readonly config: Config, readonly journal: Journal, readonly directory: string, readonly signal?: AbortSignal) { this.github = new GitHub(config.repository,signal); this.command = commandRunner(signal); }
  async save(): Promise<void> { await writeRecord(join(this.directory,'journal.json'),this.journal); }
  async intent(stage: string, details: Record<string, unknown> = {}): Promise<Record<string,unknown>> {
    this.signal?.throwIfAborted();
    this.journal.stage = stage; this.journal.intents[stage] ??= details; await this.save(); return this.journal.intents[stage];
  }
  async complete(stage: string, result: unknown): Promise<void> { this.journal.checkpoints[stage] = result; await this.save(); }
  async buildAndValidate(): Promise<void> {
    await this.intent('localImage');
    const recorded = this.journal.checkpoints.localImage;
    if (recorded) {
      let image = string(object(recorded).id);
      try { await this.command(['docker','image','inspect',image]); }
      catch (error: unknown) {
        this.signal?.throwIfAborted();
        if (!(error instanceof PreviewError)) throw error;
        const remote = this.journal.checkpoints.registry;
        if (!remote) throw new PreviewError('Validated local image unavailable; restore its recorded artifact. No rebuild or live recapture attempted.');
        const registry = object(remote); image = string(registry.image);
        if (image !== `${this.config.registry}@${string(registry.digest)}`) throw new PreviewError('Recorded registry identity mismatch.');
        await this.command(['docker','pull',image],{timeout:1800});
      }
      await verifyImage(image,this.journal,this.directory,this.signal); return;
    }
    const image = await buildImage(this.journal,this.directory,this.signal);
    await this.complete('localImage',{...image,validation:await validateLocal(image.id,this.journal,this.directory,undefined,this.signal)});
  }
  async validatePublic(): Promise<ValidationResult> {
    await this.intent('publicValidation');
    const result = await validate(this.config.origin,this.journal,{evidence:this.directory,signal:this.signal});
    await writeRecord(join(this.directory,'public-validation.json'),result);
    await this.complete('publicValidation',result); return result;
  }
  async refreshCheckout(): Promise<string> {
    await rm(this.checkout,{recursive:true,force:true});
    await this.command(['git','clone','--single-branch','--branch',this.config.branch,`https://github.com/${this.config.repository}.git`,this.checkout]);
    await this.command(['git','-C',this.checkout,'config','user.name','enois-preview']);
    await this.command(['git','-C',this.checkout,'config','user.email','preview@enois.invalid']);
    const worker = object(JSON.parse(await readFile(join(this.checkout,'wrangler.jsonc'),'utf8')));
    const vars = object(worker.vars);
    if (vars.GITHUB_REPOSITORY !== this.config.repository || vars.GITHUB_OWNER !== this.config.repository.split('/')[0]) throw new PreviewError('Private launcher does not match the installation.');
    const lock = await readRecord(join(this.checkout,'tool.lock.json'));
    const packageInfo = object(JSON.parse(await readFile(join(this.checkout,'package.json'),'utf8')));
    if (canonical(lock) !== canonical({ format:FORMAT,repository:'renanfranca/enois-preview',commit:this.config.toolCommit }) || object(packageInfo.devDependencies)['enois-preview'] !== `https://codeload.github.com/renanfranca/enois-preview/tar.gz/${this.config.toolCommit}` || worker.main !== 'launcher.ts') throw new PreviewError('Private launcher tool pin differs from the executor. Complete its reviewed TypeScript installation before publication or resume.');
    return (await this.command(['git','-C',this.checkout,'rev-parse','HEAD'])).toString().trim();
  }
  async commitPush(paths: string[], message: string, stage: string): Promise<string> {
    await this.command(['git','-C',this.checkout,'add','--',...paths]);
    await this.command(['git','-C',this.checkout,'commit','-m',message]);
    const commit = (await this.command(['git','-C',this.checkout,'rev-parse','HEAD'])).toString().trim();
    const intent = this.journal.intents[stage]; if (!intent) throw new PreviewError('Missing recorded publication intent.');
    intent.commit = commit; await this.save();
    await this.command(['git','-C',this.checkout,'push','origin',`HEAD:refs/heads/${this.config.branch}`],{logPath:join(this.directory,`${stage}-push.log`)});
    return commit;
  }
  async configuration(): Promise<void> {
    await this.intent('configuration'); await this.refreshCheckout();
    const relative = `.devcontainer/${this.journal.slug}`;
    const proofPath = `catalog/provenance/${this.journal.revision}.json`;
    const registry = object(this.journal.checkpoints.registry);
    const adjusted = await readRecord(join(this.directory,'adjusted-sources.json'));
    const proof = { format:FORMAT,revision:this.journal.revision,inputs:this.journal.inputs,image:string(registry.image),build:object(registry.evidence),sourceInventory:await inventory(join(this.directory,'frozen/sources')),adjustedSourceInventory:object(adjusted.files) };
    const proofBytes = canonical(proof)+'\n';
    const expected = { format:FORMAT,repository:this.config.repository,image:string(registry.image),devcontainerPath:`${relative}/devcontainer.json`,provenanceSha256:createHash('sha256').update(proofBytes).digest('hex'),revision:this.journal.revision,accounts:this.journal.inputs.dataManifest.accounts,provenancePath:proofPath };
    const file = join(this.checkout,relative,'scenario.json');
    let commit: string;
    if (await exists(file)) {
      if (canonical(await readRecord(file)) !== canonical(expected) || await readFile(join(this.checkout,proofPath),'utf8') !== proofBytes) throw new PreviewError('Immutable configuration collision; previous scenario preserved.');
      commit = (await this.command(['git','-C',this.checkout,'log','-1','--format=%H','--',relative])).toString().trim();
    } else {
      const directory = await privateDir(join(this.checkout,relative));
      const devcontainer = { name:`Énóis ${this.journal.slug}`,image:expected.image,overrideCommand:true,remoteUser:'demo',containerUser:'demo',hostRequirements:{cpus:2,memory:'4gb',storage:'16gb'},forwardPorts:[3000],portsAttributes:{'3000':{label:'Énóis preview',onAutoForward:'silent'}},postStartCommand:['node','/opt/render-demo/runtime/start.js','--daemon','--slug',this.journal.slug,'--origin',this.config.origin] };
      await writeFile(join(directory,'devcontainer.json'),canonical(devcontainer)+'\n',{mode:0o600});
      await writeRecord(file,expected); await privateDir(join(this.checkout,'catalog/provenance'));
      await writeFile(join(this.checkout,proofPath),proofBytes,{mode:0o600});
      commit = await this.commitPush([relative,proofPath],'feat: retain immutable TypeScript preview configuration','configuration');
    }
    await this.complete('configuration',{...expected,commit});
  }
  async catalog(): Promise<void> {
    await this.intent('catalog');
    const current = await this.refreshCheckout();
    const file = join(this.checkout,'catalog/scenarios.json');
    const catalog = await readRecord(file); const scenarios = object(catalog.scenarios);
    for (const entry of Object.values(scenarios)) requireFormat(entry);
    const { commit: configurationCommit, ...configuration } = object(this.journal.checkpoints.configuration);
    requireFormat(configuration);
    const expected = { ...configuration,launcherCommit:string(configurationCommit) };
    let commit = current;
    if (Object.hasOwn(scenarios,this.journal.slug)) {
      if (canonical(scenarios[this.journal.slug]) !== canonical(expected)) throw new PreviewError('Catalog revision collision; existing entry preserved.');
    } else {
      scenarios[this.journal.slug] = expected;
      await writeRecord(file,{...catalog,scenarios});
      commit = await this.commitPush(['catalog/scenarios.json'],'feat: publish immutable TypeScript preview catalog entry','catalog');
    }
    await this.complete('catalog',{commit});
  }
  async registryDigest(tag: string): Promise<string | null> {
    const packageName = this.config.registry.slice('ghcr.io/'.length);
    const credentials = Buffer.from(`enois-preview:${await this.github.credentials()}`).toString('base64');
    const query = new URLSearchParams({service:'ghcr.io',scope:`repository:${packageName}:pull`});
    const authorization = await request(`https://ghcr.io/token?${query}`, 'GET', undefined, {Authorization:`Basic ${credentials}`},this.signal);
    const token = string(object(await authorization.json()).token);
    let response: Response;
    try { response = await request(`https://ghcr.io/v2/${packageName}/manifests/${tag}`,'GET',undefined,{Authorization:`Bearer ${token}`,Accept:'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'},this.signal); }
    catch (error: unknown) { if (error instanceof RemoteFailure && error.status === 404) return null; throw error; }
    const digest = `sha256:${createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')}`;
    if (response.headers.get('Docker-Content-Digest') !== digest) throw new PreviewError('Registry manifest digest could not be verified.');
    return digest;
  }
  async registry(): Promise<void> {
    const record = this.journal.checkpoints.registry ? object(this.journal.checkpoints.registry) : undefined;
    const tag = `preview-${this.journal.revision}`; const intent = await this.intent('registry',{tag});
    if (intent.tag !== tag) throw new PreviewError('Recorded registry destination differs from this revision.');
    let digest: string | null;
    if (record) {
      digest = string(record.digest);
      if (!/^sha256:[a-f0-9]{64}$/.test(digest) || record.image !== `${this.config.registry}@${digest}`) throw new PreviewError('Recorded registry identity mismatch.');
      if (await this.registryDigest(digest) !== digest) throw new PreviewError('Confirmed registry digest unavailable; restore that artifact. The mutable tag is not a replacement.');
    } else digest = await this.registryDigest(tag);
    if (digest === null) {
      if (record || intent.pushAttempted) throw new PreviewError('Registry push outcome is unresolved. Inspect its recorded tag; do not push a competing artifact.');
      const image = string(object(this.journal.checkpoints.localImage).id); const destination = `${this.config.registry}:${tag}`;
      await this.command(['docker','tag',image,destination]); intent.pushAttempted = true; await this.save();
      await this.command(['docker','push',destination],{timeout:3600}); digest = await this.registryDigest(tag);
      if (digest === null) throw new PreviewError('Registry did not confirm the pushed artifact.');
    }
    const image = `${this.config.registry}@${digest}`;
    await this.command(['docker','pull',image],{timeout:1800});
    const metadata: unknown = JSON.parse((await this.command(['docker','image','inspect',image])).toString());
    if (!Array.isArray(metadata) || object(object(object(metadata[0]).Config).Labels)['io.enois.preview.revision'] !== this.journal.revision) throw new PreviewError('Registry artifact belongs to another revision.');
    await this.complete('registry',{image,digest,evidence:await verifyImage(image,this.journal,this.directory,this.signal)});
  }
  async deploy(): Promise<void> {
    const intent = await this.intent('deployment',{tag:this.journal.operation});
    const current = await this.refreshCheckout();
    const catalog = await readRecord(join(this.checkout,'catalog/scenarios.json'));
    const expected = object(object(catalog.scenarios)[this.journal.slug]); requireFormat(expected);
    if (expected.revision !== this.journal.revision) throw new PreviewError('Current remote catalog lost the recorded revision.');
    for (const [label,args] of [['install',['npm','ci','--ignore-scripts']],['build',['npm','run','build']],['test',['npm','test']],['check',['npm','run','check']]] as const) await this.command(args,{cwd:this.checkout,timeout:1800,logPath:join(this.directory,`consumer-${label}.log`)});
    const session = new Session(this.config.origin,{slug:this.journal.slug,signal:this.signal});
    let actual: Record<string,unknown> | undefined;
    try { actual = object(await session.json('/__demo/revision')); } catch (error: unknown) { this.signal?.throwIfAborted(); if (!(error instanceof PreviewError)) throw error; }
    const matching = actual && actual.catalogSha256 === identity(catalog) && Object.entries(expected).every(([key,value]) => Object.hasOwn(actual,key) && canonical(actual[key]) === canonical(value));
    const env = {...process.env,CLOUDFLARE_ACCOUNT_ID:this.config.cloudflareAccountId};
    if (!matching) {
      if (intent.attempted) throw new PreviewError('Deployment outcome unresolved; inspect Cloudflare deployments and resume after reconciliation.');
      if (refSha(await this.github.call(`git/ref/heads/${this.config.branch}`)) !== current) throw new PreviewError('Remote catalog advanced during validation; resume to preserve its additions before deploying.');
      intent.attempted = true; await this.save();
      await this.command(['npx','--no-install','wrangler','deploy','--tag',this.journal.operation,'--message',`enois-preview ${this.journal.revision} catalog ${current}`,'--strict'],{cwd:this.checkout,env,logPath:join(this.directory,'deployment.log')});
    }
    const deployments: unknown = JSON.parse((await this.command(['npx','--no-install','wrangler','deployments','list','--json'],{cwd:this.checkout,env})).toString());
    if (!Array.isArray(deployments) || !deployments.length) throw new PreviewError('Cloudflare did not confirm a deployment identity.');
    let latest = object(deployments[0]);
    for (const value of deployments) { const candidate = object(value); if (deploymentInstant(candidate.created_on) > deploymentInstant(latest.created_on)) latest = candidate; }
    if (!Array.isArray(latest.versions)) throw new PreviewError('Cloudflare returned invalid deployment versions.');
    await this.complete('deployment',{catalogCommit:current,identity:{id:string(latest.id),versions:latest.versions,created_on:string(latest.created_on)}});
  }
  async acquireRemoteLease(): Promise<void> {
    await this.intent('remoteLease');
    const deadline = performance.now() + this.config.leaseWaitSeconds * 1000;
    let owned: unknown;
    for (;;) {
      const ref = await this.github.optional(`git/ref/${this.leaseRef.slice('refs/'.length)}`);
      if (ref !== null) {
        const commit = object(await this.github.call(`git/commits/${refSha(ref)}`));
        let record: unknown;
        try { record = JSON.parse(string(commit.message)); } catch { throw new PreviewError('Remote publication lease has an unsupported format; preserve it and inspect its owner before creating a fresh installation.'); }
        requireFormat(record);
        if (record.operation === this.journal.operation) { owned = ref; break; }
      } else {
        const base = refSha(await this.github.call(`git/ref/heads/${this.config.branch}`));
        const current = object(await this.github.call(`git/commits/${base}`));
        const commit = object(await this.github.call('git/commits','POST',{ message:canonical({ format:FORMAT,operation:this.journal.operation }), tree:string(object(current.tree).sha), parents:[base] }));
        try { owned = await this.github.call('git/refs','POST',{ ref:this.leaseRef, sha:string(commit.sha) }); break; }
        catch (error: unknown) { if (!(error instanceof RemoteFailure) || ![409,422].includes(error.status)) throw error; }
      }
      if (performance.now() >= deadline) throw new PreviewError('Another remote publication still holds the lease. Retry with resume after its owner reconciles; do not delete an ambiguous lease.');
      await delay(Math.min(2000,Math.max(50,deadline-performance.now())),undefined,{signal:this.signal});
    }
    await this.complete('remoteLease',{ commit:refSha(owned) });
  }
  async releaseRemoteLease(): Promise<void> {
    const checkpoint = this.journal.checkpoints.remoteLease;
    if (!checkpoint) throw new PreviewError('Remote lease ownership was not recorded; reconcile before release.');
    await this.intent('releaseLease');
    const ref = await this.github.optional(`git/ref/${this.leaseRef.slice('refs/'.length)}`);
    if (ref !== null) {
      if (refSha(ref) !== string(object(checkpoint).commit)) throw new PreviewError('Remote lease ownership changed; inspect before another publication.');
      await this.github.call(`git/refs/${this.leaseRef.slice('refs/'.length)}`,'DELETE');
    }
    await this.complete('releaseLease',{ released:true });
  }
}

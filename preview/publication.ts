import { Publisher } from './remote.js';
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extract } from 'tar';
import { accounts, validateConfig } from './config.js';
import type { Config } from './config.js';
import { capture, commits, recover, ROOT, sourceLease } from './capture.js';
import type { DataManifest } from './capture.js';
import type { AccountSelector } from './capture.js';
import { canonical, exists, FORMAT, identity, inventory, lease, object, PreviewError, privateDir, readRecord, requireFormat, run, string, verify, writeRecord } from './state.js';
import type { Inventory } from './state.js';

export interface Inputs {
  format: typeof FORMAT; scenario: string; commits: Record<string, string>; data: string;
  dataManifest: DataManifest; recipe: Record<string, Inventory>; sourceFiles: Inventory; toolCommit: string;
}
export interface Journal {
  format: typeof FORMAT; revision: string; inputs: Inputs; slug: string; operation: string;
  target: Record<string, string>; frozenFiles: Inventory; checkpoints: Record<string, unknown>;
  stage: string; intents: Record<string, Record<string, unknown>>;
}
export function parseInventory(value: unknown): Inventory {
  const entries = object(value); const result: Inventory = {};
  for (const [path, entry] of Object.entries(entries)) {
    const file = object(entry);
    if (!path || posix.isAbsolute(path) || path.split('/').includes('..') || path.includes('\\') || posix.normalize(path) !== path || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new PreviewError('Invalid frozen inventory. Restore the recorded artifact; no recapture attempted.');
    result[path] = { bytes: file.bytes, sha256: file.sha256 };
  }
  return result;
}
export function dataManifest(value: unknown): DataManifest {
  requireFormat(value);
  const { id, ...content } = value;
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || identity(content) !== id) throw new PreviewError('Frozen data manifest identity mismatch; restore the recorded artifact. No recapture attempted.');
  const selected = accounts(value.accounts); const permissions: DataManifest['permissions'] = {};
  const rawPermissions = object(value.permissions);
  for (const account of selected) {
    const permission = object(rawPermissions[account.id]);
    if (typeof permission.admin !== 'boolean' || typeof permission.moderator !== 'boolean') throw new PreviewError('Frozen permission inventory is incomplete.');
    permissions[account.id] = { admin: permission.admin, moderator: permission.moderator };
  }
  if (!Array.isArray(value.media) || !Array.isArray(value.externalReads) || !value.externalReads.every((item: unknown) => typeof item === 'string')) throw new PreviewError('Invalid frozen media metadata.');
  const media = value.media.map((entry: unknown) => {
    const mapping = object(entry); const directory = string(mapping.directory); const url = string(mapping.url);
    if (!/^\d+$/.test(directory) || !/^\/[a-zA-Z0-9._/-]+\/$/.test(url) || url.includes('//') || url.split('/').includes('..')) throw new PreviewError('Invalid frozen media path.');
    return { directory, url, inventory: parseInventory(mapping.inventory) };
  });
  const result: DataManifest = { format: FORMAT, id, accounts: selected, permissions, externalReads: value.externalReads as string[], media, files: parseInventory(value.files), sanitizerSha256: string(value.sanitizerSha256), logicalSeedSha256: string(value.logicalSeedSha256) };
  if (!/^[a-f0-9]{64}$/.test(result.sanitizerSha256) || !/^[a-f0-9]{64}$/.test(result.logicalSeedSha256) || canonical(result) !== canonical(value)) throw new PreviewError('Unsupported or malformed frozen data manifest. Preserve it and create a fresh installation.');
  return result;
}
export function journalRecord(value: unknown): Journal {
  requireFormat(value);
  const raw = object(value.inputs); requireFormat(raw);
  const manifest = dataManifest(raw.dataManifest);
  const commits: Record<string, string> = {};
  for (const [name, sha] of Object.entries(object(raw.commits))) {
    if (!['enois-backend','enois-frontend','enois-design-system'].includes(name) || typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new PreviewError('Invalid frozen source commit.');
    commits[name] = sha;
  }
  if (Object.keys(commits).length !== 3) throw new PreviewError('Incomplete frozen source commits.');
  const recipe: Record<string, Inventory> = {};
  for (const [name, files] of Object.entries(object(raw.recipe))) {
    if (!['recipe','runtime','src','dist'].includes(name)) throw new PreviewError('Invalid frozen recipe path.');
    recipe[name] = parseInventory(files);
  }
  const inputs: Inputs = { format: FORMAT, scenario: string(raw.scenario), commits, data: string(raw.data), dataManifest: manifest, recipe, sourceFiles: parseInventory(raw.sourceFiles), toolCommit: string(raw.toolCommit) };
  const revision = string(value.revision); const slug = string(value.slug); const operation = string(value.operation);
  if (canonical(inputs) !== canonical(raw) || !/^[a-f0-9]{64}$/.test(revision) || identity(inputs) !== revision || inputs.data !== manifest.id || !/^[a-f0-9]{40}$/.test(inputs.toolCommit) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(inputs.scenario) || slug !== `${inputs.scenario}-${revision.slice(0,16)}` || !/^[a-f0-9-]{32,36}$/.test(operation)) throw new PreviewError('Journal revision identity mismatch; restore the original record.');
  const target: Record<string, string> = {};
  for (const key of ['repository','registry','branch','origin','cloudflareAccountId']) target[key] = string(object(value.target)[key]);
  const intents: Journal['intents'] = {};
  for (const [stage, details] of Object.entries(object(value.intents))) intents[stage] = object(details);
  return { format: FORMAT, revision, inputs, slug, operation, target, frozenFiles: parseInventory(value.frozenFiles), checkpoints: object(value.checkpoints), stage: string(value.stage), intents };
}
function target(config: Config): Record<string, string> {
  return { repository: config.repository, registry: config.registry, branch: config.branch, origin: config.origin, cloudflareAccountId: config.cloudflareAccountId };
}
async function toolCommit(config: Config): Promise<string> {
  if ((await run(['git','-C',ROOT,'rev-parse','HEAD'])).toString().trim() !== config.toolCommit || (await run(['git','-C',ROOT,'status','--porcelain=v1','--untracked-files=all'])).length) throw new PreviewError('Tool checkout differs from the configured public commit; restore that clean checkout before publishing or resuming.');
  return config.toolCommit;
}
export async function verifyJournal(config: Config, journal: Journal): Promise<string> {
  if (journal.inputs.toolCommit !== await toolCommit(config)) throw new PreviewError('Resume requires the recorded TypeScript tool commit and installation pin.');
  if (canonical(journal.target) !== canonical(target(config))) throw new PreviewError('Revision targets another installation.');
  const location = join(config.state, 'operations', journal.revision);
  await verify(join(location, 'frozen/data'), journal.inputs.dataManifest.files);
  await verify(join(location, 'frozen/sources'), journal.inputs.sourceFiles);
  for (const [name, files] of Object.entries(journal.inputs.recipe)) await verify(join(location, 'frozen', name), files);
  await verify(join(location, 'frozen'), journal.frozenFiles);
  return location;
}
export async function exportSources(config: Pick<Config,'repositories'>, versions: Record<string,string>, destination: string): Promise<void> {
  for (const [name, commit] of Object.entries(versions)) {
    const source = config.repositories[name]; if (!source) throw new PreviewError('Missing source repository.');
    const target = join(destination, name); await mkdir(target);
    const file = join(dirname(destination), `.archive-${randomUUID()}.tar`);
    try {
      await writeFile(file, await run(['git','-C',source,'archive',commit]), { mode: 0o600 });
      await extract({ file, cwd: target, strict: true, preservePaths: false, filter: (_path, entry) => {
        if (!('type' in entry) || typeof entry.type !== 'string' || !['File','Directory'].includes(entry.type)) throw new PreviewError('Git export contains an unsupported link or object.');
        return true;
      } });
    } finally { await rm(file, { force: true }); }
  }
}
async function recoverPending(config: Config): Promise<void> {
  if (await exists(join(config.state,'restoration.json'))) await sourceLease(config, () => recover(config));
}
async function continueRevision(config: Config, journal: Journal, dataReused: boolean): Promise<Record<string,unknown>> {
  const directory=join(config.state,'operations',journal.revision);let publisher:Publisher|undefined;
  const already=journal.checkpoints.publicValidation!==undefined;
  let validation:unknown;
  try {
    await verifyJournal(config,journal);publisher=new Publisher(config,journal,directory);
    await publisher.buildAndValidate();await publisher.acquireRemoteLease();await publisher.registry();await publisher.configuration();await publisher.catalog();await publisher.deploy();validation=await publisher.validatePublic();await publisher.releaseRemoteLease();
  }catch(error:unknown){
    const stage=publisher?journal.stage:'frozenInputs';const reason=error instanceof PreviewError?error.message:'Invalid or unavailable private artifact.';
    let released=false;
    if(publisher&&stage==='publicValidation'&&['remoteLease','registry','configuration','catalog','deployment'].every(key=>journal.checkpoints[key]!==undefined)){
      try{await publisher.releaseRemoteLease();released=true;}catch{}
    }
    await writeRecord(join(directory,'failure.json'),{stage,revision:journal.revision,backendRestoration:'complete',reason,publicationLeaseReleased:released});
    throw new PreviewError(`Stage ${stage} incomplete: ${reason} Backend restoration complete. Revision ${journal.revision}. Run enois-preview resume ${journal.revision}. Inspect private evidence at ${directory}.`);
  }
  const registry=object(journal.checkpoints.registry);const configuration=object(journal.checkpoints.configuration);const catalog=object(journal.checkpoints.catalog);
  return {status:'validated',url:config.origin+'/preview/'+journal.slug,scenario:journal.inputs.scenario,revision:journal.revision,reused:already,commits:journal.inputs.commits,dataVersion:journal.inputs.data,dataReused,toolCommit:journal.inputs.toolCommit,image:string(registry.image),provenanceSha256:string(configuration.provenanceSha256),configurationCommit:string(configuration.commit),catalogCommit:string(catalog.commit),deployment:journal.checkpoints.deployment,validation,evidence:directory,next:'Update the PR link for a new revision. Publication checks do not replace functional PR validation.'};
}
export async function publishRevision(value: unknown, scenario: string, refresh = false, select?:AccountSelector): Promise<Record<string,unknown>> {
  const config = validateConfig(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario)) throw new PreviewError('Invalid scenario: use lowercase letters, digits and single separating hyphens.');
  const pointer = join(config.state,'scenarios',`${scenario}.json`);
  const readData = async (): Promise<DataManifest | undefined> => {
    if (!await exists(pointer)) return undefined;
    const current = await readRecord(pointer); const id = string(current.data);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new PreviewError('Invalid scenario data reference.');
    const manifest = dataManifest(await readRecord(join(config.state,'data',id,'manifest.json')));
    if (manifest.id !== id) throw new PreviewError('Scenario data identity mismatch.');
    return manifest;
  };
  await readData();
  if (await exists(join(config.state,'restoration.json'))) await readRecord(join(config.state,'restoration.json'));
  return lease(join(config.state,'publication.lock'), async () => {
    await recoverPending(config);
    const versions = await commits(config); const publicTool = await toolCommit(config);
    let data = await readData();
    const dataReused = data !== undefined && !refresh;
    if (data) await verify(join(config.state,'data',data.id,'package'),data.files);
    if (!data || refresh) { data = await capture(config, data, select); await writeRecord(pointer, { data: data.id }); }
    const source = await privateDir(join(config.state,'exports',randomUUID()));
    let revision: string;
    try {
      await exportSources(config, versions, source);
      const recipe: Record<string,Inventory> = {};
      for (const name of ['recipe','runtime','src','dist']) recipe[name] = await inventory(join(ROOT,name));
      const inputs: Inputs = { format: FORMAT, scenario, commits: versions, data: data.id, dataManifest: data, recipe, sourceFiles: await inventory(source), toolCommit: publicTool };
      revision = identity(inputs); const directory = join(config.state,'operations',revision);
      if (!await exists(directory)) {
        const pending = await privateDir(join(config.state,'operations',`.pending-${randomUUID()}`)); const frozen = await privateDir(join(pending,'frozen'));
        await cp(join(config.state,'data',data.id,'package'),join(frozen,'data'),{recursive:true}); await cp(source,join(frozen,'sources'),{recursive:true});
        for (const name of Object.keys(recipe)) await cp(join(ROOT,name),join(frozen,name),{recursive:true});
        const journal: Journal = { format: FORMAT, revision, inputs, slug: `${scenario}-${revision.slice(0,16)}`, operation: randomUUID(), target: target(config), frozenFiles: await inventory(frozen), checkpoints: {}, stage: 'frozenInputs', intents: {} };
        await writeRecord(join(pending,'journal.json'),journal); await rename(pending,directory);
      }
    } finally { await rm(source,{recursive:true,force:true}); }
    return continueRevision(config,journalRecord(await readRecord(join(config.state,'operations',revision,'journal.json'))),dataReused);
  });
}
export async function resumeRevision(value: unknown, revision: string): Promise<Record<string,unknown>> {
  const config = validateConfig(value);
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new PreviewError('Resume requires the full 64 character revision ID.');
  const file = join(config.state,'operations',revision,'journal.json');
  if (!await exists(file)) throw new PreviewError('Unknown revision. Resume never recaptures live data.');
  const journal = journalRecord(await readRecord(file));
  if (journal.revision !== revision) throw new PreviewError('Journal belongs to another revision.');
  return lease(join(config.state,'publication.lock'), async () => {
    await recoverPending(config);
    const current=journalRecord(await readRecord(file));
    if(current.revision!==revision)throw new PreviewError('Journal belongs to another revision.');
    return continueRevision(config,current,true);
  });
}

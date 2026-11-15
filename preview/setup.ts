import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { Workspace } from './config.js';
import { requireCommands, workspacePrerequisites } from './config.js';
import type { Infrastructure } from './infrastructure.js';
import { infrastructureFile, infrastructureRecord, writeInfrastructure } from './infrastructure.js';
import { generateLauncher, launcherVersion, requirePublished } from './launcher.js';
import { ROOT } from './project.js';
import { canonical, commandRunner, exists, lease, object, PreviewError, privateDir, readRecord, string, writeRecord } from './state.js';
import { VERSION } from './version.js';
import { warn } from './warnings.js';

export interface SetupOptions {
  home: string;
  yes: boolean;
  launcher?: string | undefined;
  branch?: string | undefined;
  registry?: string | undefined;
  worker?: string | undefined;
  account?: string | undefined;
  /** With --config: the validated workspace and the record to store in <home>/config.json. */
  workspace?: { validated: Workspace; record: Record<string, unknown> } | undefined;
}
type Status = 'exists' | 'create' | 'update';
interface Item {
  status: Status;
  resource: string;
}

const SCOPES = ['repo', 'codespace', 'write:packages'];
const WORKER_SECRETS = ['GITHUB_TOKEN', 'CALLBACK_SECRET'] as const;
const CODESPACES_SECRETS = ['DEMO_CALLBACK_SECRET', 'DEMO_WORKER_URL', 'REDE_SECURITY_ENCRYPTION_KEY'] as const;
export const NEEDS_CONSENT = 'Setup needs to create or update infrastructure; rerun in an interactive terminal or with --yes.';
const FREE_PLAN =
  'Keep GitHub Free and Cloudflare Workers Free with additional spending blocked for the configured accounts; enois-preview does not verify billing.';
const TOKEN_GUIDE = (repository: string) =>
  `Create a fine-grained GitHub token at https://github.com/settings/personal-access-tokens/new with resource owner ${repository.split('/')[0]}, repository access "Only select repositories" with ${repository} only, and repository permissions Contents: Read-only, Codespaces: Read and write, Codespaces metadata: Read-only. It becomes the Worker secret GITHUB_TOKEN.`;

/** One readline interface for the whole setup, so answers typed ahead are never lost between prompts. */
class Terminal {
  readonly interactive = process.stdin.isTTY === true;
  private line: Interface | undefined;
  private muted = false;
  constructor(private readonly signal: AbortSignal) {}
  private open(): Interface {
    if (!this.line) {
      const output = new Writable({
        write: (chunk: Buffer, _encoding, done) => {
          if (!this.muted) process.stderr.write(chunk);
          done();
        },
      });
      this.line = createInterface({ input: process.stdin, output, terminal: true });
      this.line.on('SIGINT', () => process.emit('SIGINT'));
    }
    return this.line;
  }
  async confirm(question: string): Promise<boolean> {
    if (!this.interactive) return false;
    const answer = await this.open().question(`${question} [y/N] `, { signal: this.signal });
    return /^y(?:es)?$/i.test(answer.trim());
  }
  async secret(question: string): Promise<string> {
    const line = this.open();
    process.stderr.write(question);
    this.muted = true;
    try {
      return (await line.question('', { signal: this.signal })).trim();
    } finally {
      this.muted = false;
      process.stderr.write('\n');
    }
  }
  /** Gives the terminal to an interactive child command. */
  release(): void {
    this.line?.close();
    this.line = undefined;
  }
}

function attached(args: string[], signal: AbortSignal, cwd?: string): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(args[0] ?? '', args.slice(1), { stdio: 'inherit', cwd });
    const cancelled = () => child.kill('SIGTERM');
    signal.addEventListener('abort', cancelled, { once: true });
    child.on('error', () => reject(new PreviewError(`${args[0]} unavailable; install it, then repeat enois-preview setup.`)));
    child.on('close', code => {
      signal.removeEventListener('abort', cancelled);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new PreviewError(`${args.join(' ')} failed (exit ${code}); repeat enois-preview setup after fixing it.`));
    });
  });
}

export async function setup(options: SetupOptions, signal: AbortSignal): Promise<Record<string, unknown>> {
  const run = commandRunner(signal);
  const terminal = new Terminal(signal);
  const work = await mkdtemp(join(tmpdir(), 'enois-setup-'));
  try {
    return await guided(options, signal, run, terminal, work);
  } finally {
    terminal.release();
    await rm(work, { recursive: true, force: true });
  }
}

async function guided(
  options: SetupOptions,
  signal: AbortSignal,
  run: ReturnType<typeof commandRunner>,
  terminal: Terminal,
  work: string,
): Promise<Record<string, unknown>> {
  /** gh api with the HTTP status read from --include, so a missing resource (404) is told apart from a failure. */
  const github = async (path: string, method = 'GET', env?: NodeJS.ProcessEnv): Promise<Record<string, unknown> | null> => {
    const output = (
      await run(['gh', 'api', '-i', ...(method === 'GET' ? [] : ['-X', method]), path], {
        successCodes: [0, 1],
        timeout: 120,
        ...(env ? { env } : {}),
      })
    ).toString();
    const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(output)?.[1] ?? 0);
    if (status === 404) return null;
    if (status < 200 || status > 299)
      throw new PreviewError(
        `GitHub request ${path} failed (HTTP ${status || 'unavailable'}); inspect gh authentication and repeat setup.`,
      );
    const body = output.replace(/^[\s\S]*?\r?\n\r?\n/, '').trim();
    return body ? object(JSON.parse(body)) : {};
  };
  const fix = async (problem: string, command: string[], how: () => Promise<void>): Promise<void> => {
    const shown = command.join(' ');
    if (!terminal.interactive) throw new PreviewError(`${problem} Run ${shown}, then repeat enois-preview setup.`);
    console.error(problem);
    if (!(await terminal.confirm(`Run ${shown} now?`)))
      throw new PreviewError(`${problem} Setup stopped; run ${shown}, then repeat enois-preview setup.`);
    terminal.release();
    await how();
  };

  // Step 1: tools and logins, before the plan.
  await requireCommands();
  const ghStatus = async () => {
    const output = (await run(['gh', 'auth', 'status', '--json', 'hosts'], { successCodes: [0, 1], timeout: 60 })).toString();
    try {
      const hosts = object(object(JSON.parse(output)).hosts)['github.com'];
      const entry = Array.isArray(hosts) ? hosts.map(object).find(host => host.active === true && host.state === 'success') : undefined;
      return entry
        ? {
            login: string(entry.login),
            scopes: string(entry.scopes ?? '')
              .split(',')
              .map(scope => scope.trim()),
          }
        : undefined;
    } catch {
      return undefined;
    }
  };
  let account = await ghStatus();
  if (!account) {
    const command = ['gh', 'auth', 'login', '-h', 'github.com', '-s', SCOPES.join(',')];
    await fix('GitHub CLI is not logged in.', command, () => attached(command, signal));
    account = await ghStatus();
    if (!account) throw new PreviewError('GitHub CLI is still not logged in; run gh auth login, then repeat enois-preview setup.');
  }
  const missingScopes = SCOPES.filter(scope => !account?.scopes.includes(scope));
  if (missingScopes.length) {
    const command = ['gh', 'auth', 'refresh', '-h', 'github.com', '-s', missingScopes.join(',')];
    await fix(`GitHub CLI lacks the scopes ${missingScopes.join(', ')}.`, command, () => attached(command, signal));
    account = await ghStatus();
    if (!account || SCOPES.some(scope => !account?.scopes.includes(scope)))
      throw new PreviewError(
        `GitHub CLI still lacks the scopes ${SCOPES.join(', ')}; run gh auth refresh, then repeat enois-preview setup.`,
      );
  }
  const login = account.login;
  const dockerConfig = join(process.env.DOCKER_CONFIG ?? join(homedir(), '.docker'), 'config.json');
  const dockerLogged = async () => {
    try {
      const auths = object(object(JSON.parse(await readFile(dockerConfig, 'utf8'))).auths);
      return Object.hasOwn(auths, 'ghcr.io') || Object.hasOwn(auths, 'https://ghcr.io');
    } catch {
      return false;
    }
  };
  if (!(await dockerLogged())) {
    await fix('Docker is not logged in to ghcr.io.', ['docker', 'login', 'ghcr.io', '-u', login, '--password-stdin'], async () => {
      const token = (await run(['gh', 'auth', 'token'], { timeout: 60 })).toString().trim();
      await run(['docker', 'login', 'ghcr.io', '-u', login, '--password-stdin'], { input: token, timeout: 120 });
    });
    if (!(await dockerLogged())) throw new PreviewError('Docker is still not logged in to ghcr.io; repeat enois-preview setup.');
  }
  const whoami = async () => {
    const output = (
      await run(['npx', '--no-install', 'wrangler', 'whoami', '--json'], { cwd: ROOT, successCodes: [0, 1], timeout: 120 })
    ).toString();
    try {
      const value = object(JSON.parse(output));
      return value.loggedIn === true && Array.isArray(value.accounts)
        ? value.accounts.map(item => ({ id: string(object(item).id), name: String(object(item).name ?? '') }))
        : undefined;
    } catch {
      return undefined;
    }
  };
  let accounts = await whoami();
  if (!accounts) {
    await fix('Wrangler is not logged in to Cloudflare.', ['npx', 'wrangler', 'login'], () =>
      attached(['npx', '--no-install', 'wrangler', 'login'], signal, ROOT),
    );
    accounts = await whoami();
    if (!accounts) throw new PreviewError('Wrangler is still not logged in; run npx wrangler login, then repeat enois-preview setup.');
  }
  if (options.workspace) await workspacePrerequisites(options.workspace.validated, signal);

  // Values: infrastructure.json, then flags, then defaults.
  const file = infrastructureFile();
  const existing = (await exists(file)) ? infrastructureRecord(await readRecord(file)) : undefined;
  const flags: [keyof Infrastructure, string, string | undefined][] = [
    ['repository', '--launcher', options.launcher],
    ['branch', '--branch', options.branch],
    ['registry', '--registry', options.registry],
    ['worker', '--worker', options.worker],
    ['cloudflareAccountId', '--account', options.account],
  ];
  for (const [field, flag, value] of flags)
    if (existing && value !== undefined && value !== existing[field])
      throw new PreviewError(
        `${flag} ${value} contradicts ${existing[field]} in infrastructure.json; changing infrastructure is out of scope.`,
      );
  const repository = existing?.repository ?? options.launcher ?? `${login}/enois-preview-launcher`;
  const branch = existing?.branch ?? options.branch ?? 'main';
  const registry = existing?.registry ?? options.registry ?? `ghcr.io/${login.toLowerCase()}/enois-preview`;
  const worker = existing?.worker ?? options.worker ?? 'enois-preview-launcher';
  let cloudflareAccountId = existing?.cloudflareAccountId ?? options.account;
  const listing = accounts.map(item => `${item.name} (${item.id})`).join(', ');
  if (cloudflareAccountId === undefined) {
    if (accounts.length !== 1 || !accounts[0])
      throw new PreviewError(`Several Cloudflare accounts are available; choose one with --account: ${listing || 'none'}.`);
    cloudflareAccountId = accounts[0].id;
  } else if (!accounts.some(item => item.id === cloudflareAccountId))
    throw new PreviewError(
      `Cloudflare account ${cloudflareAccountId} is not available to the logged in Wrangler user; accounts: ${listing || 'none'}.`,
    );
  const account_ = cloudflareAccountId;
  infrastructureRecord({ repository, branch, registry, worker, cloudflareAccountId: account_, origin: 'https://placeholder.invalid' });
  const cloudflare = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account_ };
  const wrangler = (args: string[], extra: { input?: string; cwd?: string } = {}) =>
    run(['npx', '--no-install', 'wrangler', ...args], {
      cwd: extra.cwd ?? ROOT,
      env: cloudflare,
      timeout: 600,
      ...(extra.input === undefined ? {} : { input: extra.input }),
    });
  const remoteUrl = `https://github.com/${repository}.git`;
  const clone = async (name: string): Promise<string> => {
    const directory = join(work, name);
    await rm(directory, { recursive: true, force: true });
    await run(['git', 'clone', '-q', '--single-branch', '--branch', branch, remoteUrl, directory], { timeout: 600 });
    await run(['git', '-C', directory, 'config', 'user.name', 'enois-preview']);
    await run(['git', '-C', directory, 'config', 'user.email', 'preview@enois.invalid']);
    return directory;
  };

  // Observation (read only).
  let repo = await github(`repos/${repository}`);
  if (repo && object(repo.permissions).push !== true)
    throw new PreviewError(`Launcher ${repository} must be writable by the logged in GitHub user.`);
  if (repo && repo.private !== true) warn('launcher-not-private', `Launcher repository ${repository} is not private.`);
  const branchExists = repo !== null && (await github(`repos/${repository}/branches/${branch}`)) !== null;
  let launchEnabled = false;
  let pinned: string | null = null;
  if (branchExists) {
    const observed = await clone('observed');
    pinned = await launcherVersion(observed);
    if (pinned === null)
      throw new PreviewError(
        `Launcher ${repository} uses another format (for example a 0.4.0 launcher with a codeload dependency and tool.lock.json); choose a new --launcher. Setup never migrates it.`,
      );
    const configuration = object(JSON.parse(await readFile(join(observed, 'wrangler.jsonc'), 'utf8')));
    const vars = object(configuration.vars);
    if (
      configuration.main !== 'launcher.ts'
      || vars.GITHUB_REPOSITORY !== repository
      || vars.GITHUB_OWNER !== repository.split('/')[0]
      || configuration.name !== worker
    )
      throw new PreviewError(
        `Launcher ${repository} does not match: wrangler.jsonc must deploy Worker ${worker} from launcher.ts with GITHUB_REPOSITORY ${repository} and GITHUB_OWNER ${repository.split('/')[0]}.`,
      );
    launchEnabled = vars.LAUNCH_ENABLED === 'true';
  } else await requirePublished(VERSION, run);
  let workerExists = true;
  try {
    await wrangler(['deployments', 'list', '--name', worker, '--json']);
  } catch (error: unknown) {
    if (!(error instanceof PreviewError)) throw error;
    workerExists = false;
  }
  const workerSecrets = new Set<string>();
  if (workerExists) {
    const listed: unknown = JSON.parse((await wrangler(['secret', 'list', '--name', worker, '--format', 'json'])).toString());
    if (Array.isArray(listed)) for (const item of listed) workerSecrets.add(string(object(item).name));
  }
  const codespaces = new Map<string, boolean>();
  const userSecrets = object(await github('user/codespaces/secrets'));
  const listedSecrets = Array.isArray(userSecrets.secrets) ? userSecrets.secrets.map(item => string(object(item).name)) : [];
  for (const name of CODESPACES_SECRETS) {
    if (!listedSecrets.includes(name)) continue;
    const selected = repo ? object(await github(`user/codespaces/secrets/${name}/repositories`)) : {};
    const ids = Array.isArray(selected.repositories) ? selected.repositories.map(item => object(item).id) : [];
    codespaces.set(name, repo !== null && ids.includes(repo.id));
  }
  const pendingFile = join(dirname(file), 'pending-callback-secret');
  const pending = await exists(pendingFile);
  const workerCallback = workerSecrets.has('CALLBACK_SECRET');
  const codespacesCallback = codespaces.has('DEMO_CALLBACK_SECRET');
  if (workerCallback !== codespacesCallback && !pending) {
    const [side, remove] = workerCallback
      ? ['the Worker secret CALLBACK_SECRET', `npx wrangler secret delete CALLBACK_SECRET --name ${worker}`]
      : ['the Codespaces user secret DEMO_CALLBACK_SECRET', 'gh secret delete DEMO_CALLBACK_SECRET --user --app codespaces'];
    throw new PreviewError(
      `CALLBACK_SECRET and DEMO_CALLBACK_SECRET must hold the same value, only one of them exists, and neither can be read back, so the two sides can no longer be matched. Delete ${side} (${remove}), then repeat enois-preview setup.`,
    );
  }
  const needsToken = !workerSecrets.has('GITHUB_TOKEN');
  const { chromium } = await import('playwright');
  const chromiumReady = existsSync(chromium.executablePath());
  const known = existing?.origin;

  // Plan.
  const items: Item[] = [];
  const add = (present: boolean, resource: string, otherwise: Status = 'create') =>
    items.push({ status: present ? 'exists' : otherwise, resource });
  add(repo !== null, `repository ${repository}`);
  add(branchExists, `branch ${branch}`);
  add(branchExists, `launcher format (enois-preview ${pinned ?? VERSION})`);
  add(workerExists, `worker ${worker}`);
  add(workerExists && known !== undefined, 'origin', workerExists ? 'update' : 'create');
  for (const name of WORKER_SECRETS) add(workerSecrets.has(name), `secret ${name} (Worker)`);
  for (const name of CODESPACES_SECRETS)
    add(codespaces.get(name) === true, `secret ${name} (Codespaces)`, codespaces.has(name) ? 'update' : 'create');
  add(launchEnabled, 'activation LAUNCH_ENABLED=true', branchExists ? 'update' : 'create');
  add(chromiumReady, 'chromium for public validation');
  const configFile = join(options.home, 'config.json');
  const sameInfrastructure = existing !== undefined && known !== undefined;
  add(sameInfrastructure, `local ${file}`, existing ? 'update' : 'create');
  if (options.workspace) {
    const current = (await exists(configFile)) ? canonical(await readRecord(configFile)) : undefined;
    add(
      current === canonical({ ...options.workspace.record, format: 'enois-preview-ts-v1' }),
      `local ${configFile}`,
      current ? 'update' : 'create',
    );
  }
  console.error('Setup plan:');
  for (const item of items) console.error(`  ${item.status.padEnd(6)} ${item.resource}`);
  const changes = items.some(item => item.status !== 'exists');
  if (changes && !options.yes && !terminal.interactive) throw new PreviewError(NEEDS_CONSENT);
  if (needsToken && !terminal.interactive)
    throw new PreviewError(
      'Setup needs the Worker secret GITHUB_TOKEN, which is read from a hidden prompt; rerun in an interactive terminal.',
    );
  if (changes && !options.yes) {
    if (!(await terminal.confirm('Apply this plan?'))) throw new PreviewError('Setup plan declined; nothing was written.');
  }
  const created: string[] = [];
  const updated: string[] = [];
  const done = (resource: string) => {
    const item = items.find(entry => entry.resource === resource);
    if (item?.status === 'create') created.push(resource);
    else if (item?.status === 'update') updated.push(resource);
  };
  signal.throwIfAborted();

  if (!chromiumReady) {
    try {
      await run(['npx', '--no-install', 'playwright', 'install', 'chromium'], { cwd: ROOT, timeout: 1800 });
      done('chromium for public validation');
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (!(error instanceof PreviewError)) throw error;
      warn(
        'browser-missing',
        `Chromium for public validation could not be installed; retry with npx playwright install chromium in ${ROOT}.`,
      );
    }
  }

  // Step 2: launcher repository.
  if (!repo) {
    await run(['gh', 'repo', 'create', repository, '--private'], { timeout: 120 });
    repo = await github(`repos/${repository}`);
    if (!repo) throw new PreviewError(`GitHub did not confirm the new launcher ${repository}; repeat enois-preview setup.`);
    done(`repository ${repository}`);
  }
  const repositoryId = repo.id;
  if (!branchExists) {
    const directory = join(work, 'new-launcher');
    await generateLauncher(directory, { repository, worker, version: VERSION }, run);
    await run(['git', '-C', directory, 'init', '-q', '-b', branch]);
    await run(['git', '-C', directory, 'add', '-A']);
    await run([
      'git',
      '-C',
      directory,
      '-c',
      'user.name=enois-preview',
      '-c',
      'user.email=preview@enois.invalid',
      'commit',
      '-qm',
      'feat: create enois-preview launcher',
    ]);
    await run(['git', '-C', directory, 'push', '-q', remoteUrl, `HEAD:refs/heads/${branch}`], { timeout: 600 });
    done(`branch ${branch}`);
    done(`launcher format (enois-preview ${VERSION})`);
  }

  // Step 3: Worker, deployed disabled when it does not exist, and its origin.
  const deploy = async (directory: string): Promise<string> => {
    await run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, timeout: 1800 });
    let output = '';
    try {
      output = (await wrangler(['deploy'], { cwd: directory })).toString();
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (!(error instanceof PreviewError)) throw error;
    }
    const found = new RegExp(`https://${worker}\\.[a-z0-9-]+\\.workers\\.dev`).exec(output)?.[0];
    if (!found)
      throw new PreviewError(
        `Worker ${worker} did not deploy to workers.dev. If the Cloudflare account has no workers.dev subdomain, register one in the dashboard (Workers & Pages, https://dash.cloudflare.com/${account_}/workers/onboarding), then repeat enois-preview setup.`,
      );
    return found;
  };
  let origin = known;
  if (!workerExists || origin === undefined) {
    origin = await deploy(await clone('deploy'));
    done(`worker ${worker}`);
    done('origin');
  }

  // Step 4: secrets; values only on standard input.
  const workerSecret = (name: string, value: string) => wrangler(['secret', 'put', name, '--name', worker], { input: value });
  const codespacesSecret = (name: string, value: string) =>
    run(['gh', 'secret', 'set', name, '--user', '--app', 'codespaces', '--repos', repository], { input: value, timeout: 120 });
  if (needsToken) {
    console.error(TOKEN_GUIDE(repository));
    let token: string | undefined;
    for (let attempt = 0; attempt < 3 && token === undefined; attempt++) {
      const candidate = await terminal.secret('GITHUB_TOKEN (input hidden): ');
      const verified =
        candidate !== ''
        && (await github(`repos/${repository}/codespaces`, 'GET', { ...process.env, GH_TOKEN: candidate }).then(
          () => true,
          (error: unknown) => {
            if (error instanceof PreviewError) return false;
            throw error;
          },
        ));
      if (verified) token = candidate;
      else console.error('That token could not list the launcher Codespaces; it was not stored.');
    }
    if (token === undefined)
      throw new PreviewError(
        'GITHUB_TOKEN could not be verified by listing the launcher Codespaces and was not stored; create the token again, then repeat enois-preview setup.',
      );
    await workerSecret('GITHUB_TOKEN', token);
    done('secret GITHUB_TOKEN (Worker)');
  }
  if (!workerCallback || !codespacesCallback) {
    let value: string;
    if (pending) value = (await readFile(pendingFile, 'utf8')).trim();
    else {
      value = randomBytes(32).toString('base64url');
      await privateDir(dirname(pendingFile));
      await writeFile(pendingFile, value + '\n', { mode: 0o600, flag: 'wx' });
    }
    if (!workerCallback) {
      await workerSecret('CALLBACK_SECRET', value);
      done('secret CALLBACK_SECRET (Worker)');
    }
    if (!codespacesCallback) {
      await codespacesSecret('DEMO_CALLBACK_SECRET', value);
      done('secret DEMO_CALLBACK_SECRET (Codespaces)');
    }
    await unlink(pendingFile);
  } else if (pending) await unlink(pendingFile);
  for (const name of CODESPACES_SECRETS) {
    if (codespaces.get(name) === true || (name === 'DEMO_CALLBACK_SECRET' && !codespacesCallback)) continue;
    if (codespaces.has(name)) await github(`user/codespaces/secrets/${name}/repositories/${String(repositoryId)}`, 'PUT');
    else await codespacesSecret(name, name === 'DEMO_WORKER_URL' ? origin : randomBytes(32).toString('base64'));
    done(`secret ${name} (Codespaces)`);
  }

  // Step 5: activation.
  if (!launchEnabled) {
    const directory = await clone('activation');
    const configurationFile = join(directory, 'wrangler.jsonc');
    const configuration = object(JSON.parse(await readFile(configurationFile, 'utf8')));
    await writeFile(
      configurationFile,
      JSON.stringify({ ...configuration, vars: { ...object(configuration.vars), LAUNCH_ENABLED: 'true' } }, null, 2) + '\n',
    );
    await run(['git', '-C', directory, 'commit', '-qam', 'feat: enable enois-preview launches']);
    await run(['git', '-C', directory, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { timeout: 600 });
    await deploy(directory);
    done('activation LAUNCH_ENABLED=true');
  }

  // Step 7: local files, under the installation lock. The registry (step 6) is created by the first publish.
  const infrastructure: Infrastructure = infrastructureRecord({
    repository,
    branch,
    registry,
    worker,
    origin,
    cloudflareAccountId: account_,
  });
  await lease(
    join(options.home, 'installation.lock'),
    async () => {
      signal.throwIfAborted();
      if (!existing || canonical(existing) !== canonical(infrastructure)) {
        await writeInfrastructure(infrastructure, file);
        done(`local ${file}`);
      }
      if (options.workspace) {
        await privateDir(options.workspace.validated.state);
        signal.throwIfAborted();
        const record = { ...options.workspace.record, format: 'enois-preview-ts-v1' };
        if (!(await exists(configFile)) || canonical(await readRecord(configFile)) !== canonical(record)) {
          await writeRecord(configFile, options.workspace.record);
          done(`local ${configFile}`);
        }
      }
    },
    signal,
  );
  warn('free-plan', FREE_PLAN);
  return {
    status: 'configured',
    ...infrastructure,
    created,
    updated,
    message: 'Infrastructure configured. Publish and resume read infrastructure.json and the workspace configuration.',
  };
}

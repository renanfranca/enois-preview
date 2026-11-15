#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// One executable for tests that answers as gh, docker, npx (wrangler, playwright), npm, git and fuser when it is linked
// under those names on PATH. FIXTURE_PREFLIGHT_LOG receives every call (arguments only; standard input is never logged).
// With FIXTURE_INFRA_STATE, a JSON file holds the simulated GitHub, Docker, Cloudflare and npm state; launcher repositories
// are bare Git repositories under <state directory>/remote/OWNER/REPO.git.
const executable = basename(process.argv[1] ?? '');
const args = process.argv.slice(2);
if (process.env.FIXTURE_PREFLIGHT_LOG) appendFileSync(process.env.FIXTURE_PREFLIGHT_LOG, `${executable} ${args.join(' ')}\n`);
if (executable === 'fuser' && process.env.FIXTURE_FUSER_BARRIER) {
  // Pauses until BARRIER.release exists, then reports the file as not in use (exit 1, like fuser).
  const barrier = process.env.FIXTURE_FUSER_BARRIER;
  writeFileSync(barrier, String(process.pid));
  await new Promise<void>(done => {
    const timer = setInterval(() => {
      if (existsSync(`${barrier}.release`)) {
        clearInterval(timer);
        done();
      }
    }, 10);
  });
  process.exit(1);
}

export interface Repository {
  id: number;
  private: boolean;
  push: boolean;
}
export interface InfrastructureState {
  login: string;
  ghLoggedIn: boolean;
  scopes: string[];
  wranglerLoggedIn: boolean;
  accounts: { id: string; name: string }[];
  subdomain: string | null;
  repositories: Record<string, Repository>;
  workers: Record<string, { deploys: { launchEnabled: string | undefined; account: string | undefined }[] }>;
  workerSecrets: Record<string, Record<string, string>>;
  codespacesSecrets: Record<string, { value: string; repositories: number[] }>;
  validTokens: string[];
  published: string[];
  failOnce: string[];
}
const file = process.env.FIXTURE_INFRA_STATE;
const read = (): InfrastructureState => JSON.parse(readFileSync(file ?? '', 'utf8')) as InfrastructureState;
const save = (state: InfrastructureState): void => writeFileSync(file ?? '', JSON.stringify(state, null, 2));
const remote = (repository: string): string => join(dirname(file ?? ''), 'remote', `${repository}.git`);
const stdin = (): string => readFileSync(0, 'utf8');
function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}
/** Answers like `gh api -i`: status line, a blank line, then the JSON body; errors exit 1. */
function respond(status: number, body?: unknown): never {
  const text = ({ 200: 'OK', 204: 'No Content', 401: 'Unauthorized', 404: 'Not Found' } as Record<number, string>)[status] ?? '';
  if (args.includes('-i')) console.log(`HTTP/2.0 ${status} ${text}\nContent-Type: application/json\n`);
  if (body !== undefined) console.log(JSON.stringify(body));
  if (status >= 400) console.error(`gh: ${text} (HTTP ${status})`);
  process.exit(status >= 400 ? 1 : 0);
}
function notFound(): never {
  respond(404, { message: 'Not Found', status: '404' });
}
/** A configured failure (`failOnce` entry equal to the call) happens once, after any effect the call has. */
function failOnce(state: InfrastructureState, call: string): void {
  if (!state.failOnce.includes(call)) return;
  state.failOnce = state.failOnce.filter(item => item !== call);
  save(state);
  fail(`Simulated failure of ${call}`, 42);
}
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const positional = (index: number): string => args.filter(value => !value.startsWith('-'))[index] ?? '';

if (executable === 'git') {
  const result = spawnSync('/usr/bin/git', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
if (!file) {
  // Without state, every command succeeds silently (an observed `docker` that must not be reached).
  process.exit(0);
}
const state = read();

if (executable === 'gh') {
  const [group, action] = args;
  if (group === 'auth' && action === 'status') {
    if (!state.ghLoggedIn) fail('You are not logged into any GitHub hosts.');
    console.log(
      JSON.stringify({
        hosts: {
          'github.com': [{ active: true, host: 'github.com', login: state.login, scopes: state.scopes.join(', '), state: 'success' }],
        },
      }),
    );
  } else if (group === 'auth' && action === 'token') {
    if (!state.ghLoggedIn) fail('no oauth token');
    console.log('gho_fixture_cli_token');
  } else if (group === 'auth' && (action === 'login' || action === 'refresh')) {
    state.ghLoggedIn = true;
    state.scopes = [...new Set([...state.scopes, ...(option('-s') ?? option('--scopes') ?? '').split(',').filter(Boolean)])];
    save(state);
  } else if (group === 'repo' && action === 'create') {
    const name = args[2] ?? '';
    if (state.repositories[name]) fail('repository already exists');
    state.repositories[name] = { id: 1000 + Object.keys(state.repositories).length, private: args.includes('--private'), push: true };
    mkdirSync(remote(name), { recursive: true });
    spawnSync('/usr/bin/git', ['init', '--bare', '-q', remote(name)]);
    save(state);
    failOnce(state, 'gh repo create');
  } else if (group === 'secret' && action === 'set') {
    const name = args[2] ?? '';
    const repository = state.repositories[option('--repos') ?? ''];
    if (!args.includes('--user') || option('--app') !== 'codespaces' || !repository) fail('unexpected gh secret set');
    const value = stdin();
    failOnce(state, `gh secret set ${name}`);
    state.codespacesSecrets[name] = { value, repositories: [repository.id] };
    save(state);
  } else if (group === 'api') {
    const method = option('-X') ?? option('--method') ?? 'GET';
    const path = args.filter(value => !value.startsWith('-') && !['GET', 'PUT', 'POST', 'DELETE'].includes(value))[1] ?? '';
    const repositoryMatch = /^repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(path);
    const secretMatch = /^user\/codespaces\/secrets(?:\/([A-Z_]+)(\/repositories(?:\/(\d+))?)?)?$/.exec(path);
    if (repositoryMatch) {
      const name = repositoryMatch[1] ?? '';
      const repository = state.repositories[name];
      if (!repository) notFound();
      const rest = repositoryMatch[2] ?? '';
      if (rest === '')
        respond(200, { id: repository.id, full_name: name, private: repository.private, permissions: { push: repository.push } });
      else if (rest.startsWith('/branches/')) {
        const branch = rest.slice('/branches/'.length);
        const found = spawnSync('/usr/bin/git', ['-C', remote(name), 'rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
        if (found.status !== 0) notFound();
        respond(200, { name: branch });
      } else if (rest === '/codespaces') {
        if (!state.validTokens.includes(process.env.GH_TOKEN ?? '')) respond(401, { message: 'Bad credentials' });
        respond(200, { total_count: 0, codespaces: [] });
      } else fail(`Unexpected fixture route ${path}`);
    } else if (secretMatch) {
      const [, name, repositories, id] = secretMatch;
      if (!name)
        respond(200, { total_count: 0, secrets: Object.keys(state.codespacesSecrets).map(key => ({ name: key, visibility: 'selected' })) });
      else {
        const secret = state.codespacesSecrets[name];
        if (!secret) notFound();
        if (!repositories) respond(200, { name, visibility: 'selected' });
        else if (method === 'PUT' && id) {
          secret.repositories = [...new Set([...secret.repositories, Number(id)])];
          save(state);
          respond(204);
        } else respond(200, { total_count: secret.repositories.length, repositories: secret.repositories.map(item => ({ id: item })) });
      }
    } else fail(`Unexpected fixture route ${path}`);
  } else fail(`Unexpected fixture gh command ${args.join(' ')}`);
} else if (executable === 'docker') {
  if (args[0] === 'login') {
    const configuration = join(process.env.DOCKER_CONFIG ?? '', 'config.json');
    if (stdin().trim() !== 'gho_fixture_cli_token') fail('unauthorized');
    mkdirSync(dirname(configuration), { recursive: true });
    writeFileSync(configuration, JSON.stringify({ auths: { 'ghcr.io': {} } }));
  } else if (args[0] !== 'info') fail(`Unexpected fixture docker command ${args.join(' ')}`);
} else if (executable === 'npm') {
  if (args[0] === 'view') {
    const version = (args[1] ?? '').split('@').pop() ?? '';
    if (!state.published.includes(version)) fail('npm error code E404');
    console.log(version);
  } else if (args[0] === 'install' && args.includes('--package-lock-only')) {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    writeFileSync(
      join(process.cwd(), 'package-lock.json'),
      JSON.stringify({ name: manifest.name, lockfileVersion: 3, packages: { '': { devDependencies: manifest.devDependencies } } }, null, 2)
        + '\n',
    );
  } else if (args[0] !== 'ci') fail(`Unexpected fixture npm command ${args.join(' ')}`);
} else if (executable === 'npx' && args[0] === '--no-install' && args[1] === 'playwright') {
  const { chromium } = await import('playwright');
  mkdirSync(dirname(chromium.executablePath()), { recursive: true });
  writeFileSync(chromium.executablePath(), '#!/bin/sh\n', { mode: 0o755 });
} else if (executable === 'npx' && args[0] === '--no-install' && args[1] === 'wrangler') {
  const command = args.slice(2);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (command[0] === 'login') {
    state.wranglerLoggedIn = true;
    save(state);
  } else if (!state.wranglerLoggedIn) fail('Not logged in.');
  else if (command[0] === 'whoami') console.log(JSON.stringify({ loggedIn: true, accounts: state.accounts }));
  else if (command[0] === 'deployments' && command[1] === 'list') {
    if (!state.workers[option('--name') ?? '']) fail('This Worker does not exist on your account. [code: 10007]');
    console.log('[]');
  } else if (command[0] === 'secret' && command[1] === 'list') {
    const name = option('--name') ?? '';
    if (!state.workers[name]) fail('This Worker does not exist on your account. [code: 10007]');
    console.log(JSON.stringify(Object.keys(state.workerSecrets[name] ?? {}).map(key => ({ name: key, type: 'secret_text' }))));
  } else if (command[0] === 'secret' && command[1] === 'put') {
    const name = option('--name') ?? '';
    const secret = command[2] ?? '';
    if (!state.workers[name]) fail('There does not seem to be a Worker with that name.');
    state.workerSecrets[name] = { ...state.workerSecrets[name], [secret]: stdin() };
    save(state);
    failOnce(state, `wrangler secret put ${secret}`);
  } else if (command[0] === 'deploy') {
    const configuration = JSON.parse(readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'));
    if (!state.subdomain) fail('You need to register a workers.dev subdomain before publishing to workers.dev');
    const worker = (state.workers[configuration.name] ??= { deploys: [] });
    worker.deploys.push({ launchEnabled: configuration.vars?.LAUNCH_ENABLED, account });
    save(state);
    console.log(`Deployed ${configuration.name} triggers\n  https://${configuration.name}.${state.subdomain}.workers.dev`);
  } else fail(`Unexpected fixture wrangler command ${command.join(' ')}`);
} else fail(`Unexpected fixture command ${executable} ${args.join(' ')}`);

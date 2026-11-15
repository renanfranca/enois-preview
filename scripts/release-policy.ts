import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { invokedDirectly } from '../preview/state.js';

export const REPOSITORY = 'renanfranca/enois-preview';

export class PolicyError extends Error {}

export interface BuildRun {
  head_sha: string;
  event: string;
  conclusion: string | null;
}
export interface TriggeringRun extends BuildRun {
  head_branch: string;
  repository: string;
}
export interface Qualification {
  repository: string;
  event: string;
  ref: string;
  operation: string;
  version: string;
  /** For workflow_dispatch: the commit the workflow runs on. */
  candidate?: string;
  mainHead: string;
  run?: TriggeringRun | undefined;
  builds: BuildRun[];
  tagsAtCandidate: string[];
  /** Full messages of the commits since the latest v* tag reachable from the candidate. */
  commitsSinceTag: string[];
}

export function stableVersion(version: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new PolicyError(`Use a stable version x.y.z (received "${version}").`);
  return version;
}
/** The release a set of Conventional Commits calls for, as in the version table of the specification. */
export function releaseType(messages: string[]): 'major' | 'minor' | 'patch' | null {
  let result: 'major' | 'minor' | 'patch' | null = null;
  for (const message of messages) {
    const header = /^(\w+)(\([^)]*\))?(!)?: /.exec(message);
    if (!header) continue;
    if (header[3] === '!' || /^BREAKING[ -]CHANGE: /m.test(message)) return 'major';
    if (header[1] === 'feat') result = 'minor';
    else if (['fix', 'perf', 'revert'].includes(header[1] ?? '') && result === null) result = 'patch';
  }
  return result;
}
function repository(value: string): void {
  if (value !== REPOSITORY) throw new PolicyError(`Releases run only in ${REPOSITORY}; forks never publish.`);
}
/** Decides whether a candidate commit may be released, and whether a manual request must force a patch. */
export function qualify(input: Qualification): { sha: string; forcePatch: boolean } {
  repository(input.repository);
  let candidate: string;
  if (input.event === 'workflow_run') {
    const run = input.run;
    if (!run || run.event !== 'push' || run.conclusion !== 'success' || run.head_branch !== 'main' || run.repository !== REPOSITORY)
      throw new PolicyError('An automatic release needs a successful push build of main in this repository.');
    candidate = run.head_sha;
  } else if (input.event === 'workflow_dispatch') {
    if (input.operation !== 'release') throw new PolicyError('Qualification handles operation=release; recovery runs in the recover job.');
    if (input.ref !== 'refs/heads/main') throw new PolicyError('Manual releases run from main.');
    if (input.version !== '') throw new PolicyError('The version input must stay empty for a release; the version is always calculated.');
    candidate = input.candidate ?? '';
  } else throw new PolicyError('Release runs only after a build workflow run or by workflow_dispatch.');
  if (!/^[a-f0-9]{40}$/.test(candidate) || candidate !== input.mainHead)
    throw new PolicyError(`Candidate ${candidate} is not the current main head ${input.mainHead}.`);
  if (!input.builds.some(build => build.head_sha === candidate && build.event === 'push' && build.conclusion === 'success'))
    throw new PolicyError(`Candidate ${candidate} has no successful push build.`);
  const tag = input.tagsAtCandidate.find(name => name.startsWith('v'));
  if (tag)
    throw new PolicyError(
      `Candidate ${candidate} is already released as ${tag}; run the workflow with operation=recover and version=${tag.slice(1)} to complete it.`,
    );
  if (input.event === 'workflow_dispatch' && input.commitsSinceTag.length === 0)
    throw new PolicyError('No commits since the latest tag; nothing to release.');
  return { sha: candidate, forcePatch: input.event === 'workflow_dispatch' && releaseType(input.commitsSinceTag) === null };
}
export function recoveryRequest(input: { repository: string; event: string; operation: string; version: string; tagExists: boolean }): {
  version: string;
  tag: string;
} {
  repository(input.repository);
  if (input.event !== 'workflow_dispatch' || input.operation !== 'recover')
    throw new PolicyError('Recovery runs only by workflow_dispatch with operation=recover.');
  const version = stableVersion(input.version);
  if (!input.tagExists) throw new PolicyError(`Tag v${version} does not exist; recovery never creates a tag or a new version.`);
  return { version, tag: `v${version}` };
}

function command(args: string[]): string {
  const result = spawnSync(args[0] ?? '', args.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new PolicyError(`${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
function output(values: Record<string, string>): void {
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  process.stdout.write(lines);
}
/** Collects the facts of a workflow run with git and gh (GH_TOKEN), then applies the policy. */
function collect(mode: string): void {
  const env = process.env;
  const repositoryName = env.GITHUB_REPOSITORY ?? '';
  const event = env.GITHUB_EVENT_NAME ?? '';
  if (mode === 'recover') {
    const version = env.RELEASE_VERSION ?? '';
    const tagExists = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/v${version}`]).status === 0;
    output(recoveryRequest({ repository: repositoryName, event, operation: env.RELEASE_OPERATION ?? '', version, tagExists }));
    return;
  }
  const payload = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const workflowRun = payload.workflow_run;
  const run: TriggeringRun | undefined = workflowRun
    ? {
        head_sha: workflowRun.head_sha,
        event: workflowRun.event,
        conclusion: workflowRun.conclusion,
        head_branch: workflowRun.head_branch,
        repository: workflowRun.head_repository?.full_name ?? '',
      }
    : undefined;
  const candidate = run?.head_sha ?? env.GITHUB_SHA ?? '';
  const mainHead = command(['gh', 'api', `repos/${repositoryName}/git/ref/heads/main`, '--jq', '.object.sha']);
  const builds = JSON.parse(
    command([
      'gh',
      'api',
      `repos/${repositoryName}/actions/workflows/build.yml/runs?head_sha=${candidate}&event=push&status=success`,
      '--jq',
      '.workflow_runs',
    ]),
  ) as BuildRun[];
  const tags = command(['git', 'tag', '--points-at', candidate, '--list', 'v*']).split('\n').filter(Boolean);
  const latest = spawnSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', candidate], { encoding: 'utf8' });
  const range = latest.status === 0 ? `${latest.stdout.trim()}..${candidate}` : candidate;
  const commits = command(['git', 'log', '--format=%B%x00', range])
    .split('\0')
    .map(message => message.trim())
    .filter(Boolean);
  const result = qualify({
    repository: repositoryName,
    event,
    ref: env.GITHUB_REF ?? '',
    operation: env.RELEASE_OPERATION ?? '',
    version: env.RELEASE_VERSION ?? '',
    candidate,
    mainHead,
    run,
    builds,
    tagsAtCandidate: tags,
    commitsSinceTag: commits,
  });
  output({ sha: result.sha, 'force-patch': String(result.forcePatch) });
}

if (await invokedDirectly(import.meta.url)) {
  try {
    collect(process.argv[2] ?? '');
  } catch (error: unknown) {
    console.error(error instanceof PolicyError ? error.message : String(error));
    process.exitCode = 1;
  }
}

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../preview/project.js';
import type { Qualification } from '../../scripts/release-policy.js';
import { qualify, recoveryRequest, releaseType, stableVersion } from '../../scripts/release-policy.js';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const green = { head_sha: HEAD, event: 'push', conclusion: 'success' };
function automatic(overrides: Partial<Qualification> = {}): Qualification {
  return {
    repository: 'renanfranca/enois-preview',
    event: 'workflow_run',
    ref: 'refs/heads/main',
    operation: '',
    version: '',
    mainHead: HEAD,
    run: { head_sha: HEAD, event: 'push', conclusion: 'success', head_branch: 'main', repository: 'renanfranca/enois-preview' },
    builds: [green],
    tagsAtCandidate: [],
    commitsSinceTag: ['feat: add guided setup'],
    ...overrides,
  };
}
function manual(overrides: Partial<Qualification> = {}): Qualification {
  return automatic({ event: 'workflow_dispatch', operation: 'release', run: undefined, candidate: HEAD, ...overrides });
}

test('only stable x.y.z versions are accepted', () => {
  for (const version of ['0.5.0', '1.0.0', '12.34.56']) assert.equal(stableVersion(version), version);
  for (const version of ['', 'v0.5.0', '0.5', '0.5.0-beta.1', '0.0.0-SNAPSHOT', '01.2.3', ' 0.5.0'])
    assert.throws(() => stableVersion(version), /Use a stable version x\.y\.z/, version);
});

test('the version table maps Conventional Commits to patch, minor, major or no release', () => {
  assert.equal(releaseType(['fix: repair']), 'patch');
  assert.equal(releaseType(['perf: faster']), 'patch');
  assert.equal(releaseType(['revert: undo feat']), 'patch');
  assert.equal(releaseType(['fix: repair', 'feat(setup): guided']), 'minor');
  assert.equal(releaseType(['feat!: drop 0.4.0 journals']), 'major');
  assert.equal(releaseType(['fix: repair\n\nBREAKING CHANGE: new FORMAT']), 'major');
  assert.equal(
    releaseType(['docs: guide', 'chore: tidy', 'test: more', 'ci: build', 'refactor: split', 'style: format', 'build: deps']),
    null,
  );
  assert.equal(releaseType([]), null);
});

test('an automatic release qualifies the current green main head that is not tagged', () => {
  assert.deepEqual(qualify(automatic()), { sha: HEAD, forcePatch: false });
});

test('a candidate that is not the current main head is refused', () => {
  assert.throws(() => qualify(automatic({ mainHead: OLDER })), /is not the current main head/);
});

test('a candidate without a successful push build is refused', () => {
  for (const builds of [[], [{ ...green, conclusion: 'failure' }], [{ ...green, event: 'pull_request' }], [{ ...green, head_sha: OLDER }]])
    assert.throws(() => qualify(automatic({ builds })), /has no successful push build/);
});

test('an already released head is refused and points to recover', () => {
  assert.throws(
    () => qualify(manual({ tagsAtCandidate: ['v0.5.0'] })),
    /already released as v0\.5\.0; run the workflow with operation=recover and version=0\.5\.0/,
  );
  assert.throws(() => qualify(automatic({ tagsAtCandidate: ['v0.5.0'] })), /already released/);
});

test('the wrong event, branch, triggering run or a fork is refused', () => {
  assert.throws(() => qualify(automatic({ event: 'push' })), /Release runs only after a build workflow run or by workflow_dispatch/);
  assert.throws(() => qualify(manual({ ref: 'refs/heads/feature' })), /Manual releases run from main/);
  assert.throws(() => qualify(manual({ operation: 'recover' })), /operation=release/);
  assert.throws(() => qualify(manual({ version: '0.6.0' })), /version input must stay empty/);
  assert.throws(() => qualify(automatic({ run: { ...automatic().run!, event: 'pull_request' } })), /successful push build of main/);
  assert.throws(() => qualify(automatic({ run: { ...automatic().run!, conclusion: 'failure' } })), /successful push build of main/);
  assert.throws(() => qualify(automatic({ run: { ...automatic().run!, head_branch: 'feature' } })), /successful push build of main/);
  assert.throws(
    () => qualify(automatic({ run: { ...automatic().run!, repository: 'someone/enois-preview' } })),
    /successful push build of main/,
  );
  assert.throws(() => qualify(automatic({ repository: 'someone/enois-preview' })), /Releases run only in renanfranca\/enois-preview/);
});

test('a manual release with commits but no releasable commit publishes a patch, and one without commits is refused', () => {
  assert.deepEqual(qualify(manual({ commitsSinceTag: ['docs: guide', 'chore: tidy'] })), { sha: HEAD, forcePatch: true });
  assert.deepEqual(qualify(manual({ commitsSinceTag: ['fix: repair'] })), { sha: HEAD, forcePatch: false });
  assert.deepEqual(qualify(automatic({ commitsSinceTag: ['docs: guide'] })), { sha: HEAD, forcePatch: false });
  assert.throws(() => qualify(manual({ commitsSinceTag: [] })), /No commits since the latest tag/);
});

test('a recovery request needs operation=recover, a stable version whose tag exists, from this repository', () => {
  const valid = {
    repository: 'renanfranca/enois-preview',
    event: 'workflow_dispatch',
    operation: 'recover',
    version: '0.5.0',
    tagExists: true,
  };
  assert.deepEqual(recoveryRequest(valid), { version: '0.5.0', tag: 'v0.5.0' });
  assert.throws(
    () => recoveryRequest({ ...valid, tagExists: false }),
    /Tag v0\.5\.0 does not exist; recovery never creates a tag or a new version/,
  );
  assert.throws(() => recoveryRequest({ ...valid, version: '' }), /Use a stable version x\.y\.z/);
  assert.throws(() => recoveryRequest({ ...valid, version: 'v0.5.0' }), /Use a stable version x\.y\.z/);
  assert.throws(() => recoveryRequest({ ...valid, operation: 'release' }), /operation=recover/);
  assert.throws(() => recoveryRequest({ ...valid, event: 'workflow_run' }), /operation=recover/);
  assert.throws(
    () => recoveryRequest({ ...valid, repository: 'someone/enois-preview' }),
    /Releases run only in renanfranca\/enois-preview/,
  );
});

async function released(messages: string[], forcePatch = false): Promise<string | null> {
  const previous = process.env.ENOIS_FORCE_PATCH;
  process.env.ENOIS_FORCE_PATCH = String(forcePatch);
  try {
    const configuration = join(ROOT, 'release.config.cjs');
    const require = createRequire(configuration);
    delete require.cache[configuration];
    const plugins = (require(configuration) as { plugins: unknown[] }).plugins;
    const [, options] = plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer') as [
      string,
      object,
    ];
    const { analyzeCommits } = (await import(require.resolve('@semantic-release/commit-analyzer'))) as {
      analyzeCommits: (options: object, context: object) => Promise<string | null>;
    };
    const commits = messages.map((message, index) => ({ hash: String(index).padStart(40, '0'), message }));
    const logger = { log: () => undefined, error: () => undefined };
    return (await analyzeCommits(options, { commits, logger, cwd: ROOT })) ?? null;
  } finally {
    if (previous === undefined) delete process.env.ENOIS_FORCE_PATCH;
    else process.env.ENOIS_FORCE_PATCH = previous;
  }
}

test('the semantic-release configuration follows the same version table and forces a patch only when asked', async () => {
  for (const messages of [
    ['fix: repair'],
    ['perf: faster'],
    ['revert: undo feat'],
    ['fix: repair', 'feat(setup): guided'],
    ['feat!: drop 0.4.0 journals'],
    ['fix: repair\n\nBREAKING CHANGE: new FORMAT'],
    ['docs: guide', 'chore: tidy', 'test: more', 'ci: build', 'refactor: split', 'style: format', 'build(deps): bump'],
  ])
    assert.equal(await released(messages), releaseType(messages), messages.join(' | '));

  assert.equal(await released(['docs: guide', 'chore: tidy'], true), 'patch');
});

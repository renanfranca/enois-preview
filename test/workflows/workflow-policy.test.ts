import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../../preview/project.js';
import { workflowViolations } from '../../scripts/workflow-policy.js';

const directory = join(ROOT, '.github', 'workflows');
const pinned = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1';
function workflow(job: string, top = 'permissions:\n  contents: read\n'): string {
  return `name: sample\non: push\n${top}jobs:\n${job}`;
}
const build = (uses = pinned, permissions = '    permissions:\n      contents: read\n'): string =>
  `  build:\n    runs-on: ubuntu-latest\n${permissions}    steps:\n      - uses: ${uses}\n`;

test('every workflow of the repository follows the workflow policy', () => {
  const files = readdirSync(directory).filter(name => /\.ya?ml$/.test(name));

  assert.ok(files.includes('build.yml') && files.includes('release.yml'), files.join(', '));
  for (const name of files) assert.deepEqual(workflowViolations(name, readFileSync(join(directory, name), 'utf8')), [], name);
});

test('an action pinned by tag, branch or short SHA is refused, and a local action is allowed', () => {
  for (const uses of ['actions/checkout@v4', 'actions/checkout@main', 'actions/checkout@3d3c42e', 'actions/checkout'])
    assert.deepEqual(workflowViolations('sample.yml', workflow(build(uses))), [
      `sample.yml: build uses ${uses}, which is not pinned to a full commit SHA`,
    ]);

  assert.deepEqual(workflowViolations('sample.yml', workflow(build('./.github/actions/local'))), []);
});

test('missing or broad permissions are refused at workflow and job level', () => {
  assert.deepEqual(workflowViolations('sample.yml', workflow(build(), '')), ['sample.yml: the workflow does not declare permissions']);
  assert.deepEqual(workflowViolations('sample.yml', workflow(build(pinned, ''))), ['sample.yml: job build does not declare permissions']);
  assert.deepEqual(workflowViolations('sample.yml', workflow(build(), 'permissions: write-all\n')), [
    'sample.yml: the workflow grants write-all; declare each permission explicitly',
  ]);
  assert.deepEqual(workflowViolations('sample.yml', workflow(build(), 'permissions:\n  contents: write\n')), [
    'sample.yml: the workflow grants contents: write; grant write permissions only in the publish and recover jobs of release.yml',
  ]);
});

test('write permissions and id-token: write are refused outside the publish and recover jobs of release.yml', () => {
  const writing = '    permissions:\n      contents: read\n      id-token: write\n';

  assert.deepEqual(workflowViolations('release.yml', workflow(build(pinned, writing), 'permissions: {}\n')), [
    'release.yml: job build grants id-token: write; grant write permissions only in the publish and recover jobs of release.yml',
  ]);
  assert.deepEqual(workflowViolations('build.yml', workflow(build(pinned, writing).replace('build:', 'publish:'), 'permissions: {}\n')), [
    'build.yml: job publish grants id-token: write; grant write permissions only in the publish and recover jobs of release.yml',
  ]);
  assert.deepEqual(
    workflowViolations('release.yml', workflow(build(pinned, writing).replace('build:', 'recover:'), 'permissions: {}\n')),
    [],
  );
});

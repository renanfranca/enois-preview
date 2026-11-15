import { parse } from 'yaml';

const PRIVILEGED = new Set(['publish', 'recover']);
const PINNED = /^[\w.-]+\/[\w.-]+(\/[^@]+)?@[0-9a-f]{40}$/;

type Record_ = Record<string, unknown>;
const record = (value: unknown): Record_ | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record_) : undefined;

function permissionViolations(file: string, owner: string, permissions: unknown, privileged: boolean): string[] {
  if (permissions === undefined) return [`${file}: ${owner} does not declare permissions`];
  if (typeof permissions === 'string') return [`${file}: ${owner} grants ${permissions}; declare each permission explicitly`];
  return Object.entries(record(permissions) ?? {})
    .filter(([, access]) => access === 'write' && !privileged)
    .map(
      ([scope]) => `${file}: ${owner} grants ${scope}: write; grant write permissions only in the publish and recover jobs of release.yml`,
    );
}
/** The workflow policy of the specification (§2.1): full-SHA pins and explicit, minimal permissions. */
export function workflowViolations(file: string, text: string): string[] {
  const workflow = record(parse(text)) ?? {};
  const violations = permissionViolations(file, 'the workflow', workflow.permissions, false);
  for (const [name, value] of Object.entries(record(workflow.jobs) ?? {})) {
    const job = record(value) ?? {};
    violations.push(...permissionViolations(file, `job ${name}`, job.permissions, file === 'release.yml' && PRIVILEGED.has(name)));
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const uses = [job.uses, ...steps.map(step => record(step)?.uses)].filter((item): item is string => typeof item === 'string');
    for (const action of uses)
      if (!action.startsWith('./') && !action.startsWith('docker://') && !PINNED.test(action))
        violations.push(`${file}: ${name} uses ${action}, which is not pinned to a full commit SHA`);
  }
  return violations;
}

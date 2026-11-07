export const FORMAT = 'enois-preview-ts-v1';
export class PreviewError extends Error {}
export function requireFormat(value: unknown): asserts value is Record<string, unknown> & { format: typeof FORMAT } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('format' in value) || value.format !== FORMAT) {
    throw new PreviewError(`Unsupported record format. Expected ${FORMAT}. Preserve existing records and create a fresh installation with --home NEW_DIRECTORY.`);
  }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new PreviewError('Canonical records require finite JSON values.');
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreviewError('Invalid private record object.');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new PreviewError('Invalid private record string.');
  return value;
}

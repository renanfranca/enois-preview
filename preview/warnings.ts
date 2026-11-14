import { AsyncLocalStorage } from 'node:async_hooks';

export interface Warning { code: string; message: string }
const current = new AsyncLocalStorage<Warning[]>();

/** Records one observation that never stops the operation: once in the final result and once on stderr. */
export function warn(code: string, message: string): void {
  const collected = current.getStore();
  if (collected?.some(item => item.code === code && item.message === message)) return;
  collected?.push({ code, message });
  console.error(`warning: ${message}`);
}
/** Runs one operation with its own warning collector; the caller attaches the result to its final JSON. */
export async function collectWarnings<T>(work: () => Promise<T>): Promise<{ result: T; warnings: Warning[] }> {
  const warnings: Warning[] = [];
  const result = await current.run(warnings, work);
  return { result, warnings };
}

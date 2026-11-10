import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** True when this module is the process entry point, even when argv[1] reaches it through a symlink such as the installer's `current`. Node only: the image runtime, the CLI and the scripts share it. */
export async function invokedDirectly(moduleUrl: string): Promise<boolean> {
  const invoked = process.argv[1]; if (!invoked) return false;
  try { return await realpath(invoked) === await realpath(fileURLToPath(moduleUrl)); } catch { return false; }
}

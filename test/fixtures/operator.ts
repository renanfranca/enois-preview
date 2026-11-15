import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The infrastructure every fixture workspace publishes to; stored once per test process, as an operator stores it once. */
export const infrastructure = {
  repository: 'fixture/launcher',
  registry: 'ghcr.io/fixture/image',
  branch: 'preview',
  worker: 'enois-preview-launcher',
  origin: 'https://preview.example.invalid',
  cloudflareAccountId: 'a'.repeat(32),
};
if (!process.env.ENOIS_PREVIEW_INFRASTRUCTURE) {
  const directory = mkdtempSync(join(tmpdir(), 'enois-operator-'));
  const file = join(directory, 'infrastructure.json');
  writeFileSync(file, JSON.stringify({ format: 'enois-preview-ts-v1', ...infrastructure }), { mode: 0o600 });
  process.env.ENOIS_PREVIEW_INFRASTRUCTURE = file;
  process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
}

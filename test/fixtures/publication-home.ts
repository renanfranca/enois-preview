import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampInstallation } from '../../preview/installation.js';
import { workspace } from './workspace.js';

function dependency(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  while (!existsSync(join(directory, 'package.json')) || JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(directory); if (parent === directory) throw new Error(`Resolve real ${name} dependency`); directory = parent;
  }
  return directory;
}

/** A fixture CLI home: three clean fixture repositories, an installed tool copy and one frozen scenario `fixture`. */
export async function publicationHome(root: string, source: string) {
  const config = workspace(root);
  const tool = join(root, 'tool'); mkdirSync(tool);
  for (const name of ['dist', 'preview', 'recipe', 'runtime', 'src', 'scripts', 'package.json', 'package-lock.json']) cpSync(join(source, name), join(tool, name), { recursive: true });
  mkdirSync(join(tool, 'node_modules'));
  for (const name of ['tar', 'tough-cookie']) symlinkSync(dependency(name), join(tool, 'node_modules', name), 'dir');
  config.toolCommit = createHash('sha1').update(root).digest('hex');
  await stampInstallation(tool, config.toolCommit);
  const bytes = Buffer.from('explicitly simulated sanitized data');
  const files = { 'seed/rede.mv.db': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  const content = { accounts: [{ email: 'author@enois.invalid', id: 'author', label: 'Author' }], externalReads: [], files, format: 'enois-preview-ts-v1', logicalSeedSha256: 'a'.repeat(64), media: [], permissions: { author: { admin: false, moderator: false } }, sanitizerSha256: 'f'.repeat(64) };
  const data = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  mkdirSync(join(config.state, 'data', data, 'package/seed'), { recursive: true });
  writeFileSync(join(config.state, 'data', data, 'package/seed/rede.mv.db'), bytes);
  writeFileSync(join(config.state, 'data', data, 'manifest.json'), JSON.stringify({ ...content, id: data }));
  mkdirSync(join(config.state, 'scenarios')); writeFileSync(join(config.state, 'scenarios/fixture.json'), JSON.stringify({ format: 'enois-preview-ts-v1', data }));
  const home = join(root, 'home'); mkdirSync(home);
  return { root, config, tool, home, data, cli: join(tool, 'dist/preview/cli.js') };
}

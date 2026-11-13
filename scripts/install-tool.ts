import { mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extract } from 'tar';
import { canonical, exists, inventory, PreviewError, privateDir, run, invokedDirectly } from '../preview/state.js';
import { sourceContents, stampInstallation } from '../preview/installation.js';

const ARCHIVES = 'https://codeload.github.com/renanfranca/enois-preview/tar.gz';
const USAGE = 'Usage: node dist/scripts/install-tool.js --commit PUBLIC_TOOL_COMMIT [--prefix DIRECTORY]';

export async function installTool(commit: string, prefixInput = join(homedir(), '.local/share/enois-preview'), archives = ARCHIVES): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new PreviewError('Install requires the full 40 character public tool commit.');
  const prefix = resolve(prefixInput); const destination = join(prefix, commit);
  if (await exists(destination)) throw new PreviewError(`Commit ${commit} is already installed at ${destination}; installations are immutable.`);
  await privateDir(prefix);
  const staging = await mkdtemp(join(prefix, '.staging-'));
  try {
    const archive = `${archives}/${commit}`; const file = join(staging, 'source.tar.gz');
    const response = await fetch(archive);
    if (!response.ok) throw new PreviewError(`Download of ${archive} failed (HTTP ${response.status}).`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    const top = `enois-preview-${commit}`; const unpacked = await privateDir(join(staging, 'unpacked'));
    let refusal: PreviewError | undefined;
    await extract({ file, cwd: unpacked, strict: true, preservePaths: false, filter: (path, entry) => {
      if (path.split('/')[0] !== top) refusal ??= new PreviewError(`Archive root differs from ${top}; refusing to install another commit.`);
      else if (!('type' in entry) || typeof entry.type !== 'string' || !['File', 'Directory'].includes(entry.type)) refusal ??= new PreviewError('Archive contains an unsupported link or object.');
      return refusal === undefined;
    } });
    if (refusal) throw refusal;
    const root = join(unpacked, top);
    if (!await exists(join(root, 'package.json'))) throw new PreviewError(`Archive root differs from ${top}; refusing to install another commit.`);
    const source = await sourceContents(root);
    const logs = await privateDir(join(prefix, 'logs'));
    await run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, timeout: 1800, logPath: join(logs, `${commit}-install.log`) });
    await run(['npm', 'run', 'build'], { cwd: root, timeout: 1800, logPath: join(logs, `${commit}-build.log`) });
    const built = await sourceContents(root);
    if (canonical(built) !== canonical(source)) {
      const changed = [...new Set([...Object.keys(source), ...Object.keys(built)])].filter(path => canonical(source[path] ?? null) !== canonical(built[path] ?? null)).sort();
      throw new PreviewError(`Build changed source files outside dist: ${changed.join(', ')}. Installation refused.`);
    }
    await stampInstallation(root, commit, { source, dist: await inventory(join(root, 'dist')) });
    await rename(root, destination);
    const current = join(prefix, 'current'); const pending = join(prefix, `.current-${randomUUID()}`);
    await symlink(commit, pending); await rename(pending, current);
    await run(['npm', 'link', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: current, timeout: 600, logPath: join(logs, `${commit}-link.log`) });
    // The browser lives in Playwright's own cache, outside the stamped installation, so a failure here leaves a complete installation.
    const browserLog = join(logs, `${commit}-browser.log`);
    const browser = await run(['npx', '--no-install', 'playwright', 'install', 'chromium'], { cwd: destination, timeout: 1800, logPath: browserLog }).then(() => true, (error: unknown) => {
      if (!(error instanceof PreviewError)) throw error;
      console.error(`Chromium, used by the public validation, was not installed (see ${browserLog}). The installation is complete; retry with: (cd ${destination} && npx --no-install playwright install chromium)`);
      return false;
    });
    return { commit, archive, installation: destination, current, stamp: join(destination, 'install.json'), linked: true, browser };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function runInstaller(argv: string[], archives = ARCHIVES): Promise<number> {
  try {
    const args = [...argv]; const options: Record<string, string> = {};
    while (args.length) {
      const flag = args.shift(); const value = args.shift();
      if ((flag !== '--commit' && flag !== '--prefix') || !value || flag.slice(2) in options) throw new PreviewError(USAGE);
      options[flag.slice(2)] = value;
    }
    if (!options.commit) throw new PreviewError(USAGE);
    console.log(JSON.stringify(await installTool(options.commit, options.prefix, archives), null, 2));
    return 0;
  } catch (error: unknown) {
    console.error(error instanceof PreviewError ? error.message : 'Installation failed; inspect the logs under the installation prefix.');
    return 1;
  }
}

if (await invokedDirectly(import.meta.url)) process.exitCode = await runInstaller(process.argv.slice(2));

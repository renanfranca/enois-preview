#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { sourceDigest } from './capture.js';
import { validateWorkspace, warnIgnoredFields } from './config.js';
import { combine, readInfrastructure } from './infrastructure.js';
import { setup } from './setup.js';
import { invokedDirectly, listenForInterruption, PreviewError, readRecord } from './state.js';
import { VERSION } from './version.js';
import { collectWarnings } from './warnings.js';

const NO_TERMINAL =
  'Select stable account IDs with enois-preview publish SCENARIO --accounts ID[,ID...], in an interactive local terminal, or in the configuration.';
async function selectAccounts(listing: string, signal: AbortSignal): Promise<{ id: string; label: string }[]> {
  if (!process.stdin.isTTY) throw new PreviewError(NO_TERMINAL);
  const rows = new Map<string, string>();
  for (const line of listing.trim().split('\n')) {
    const split = line.indexOf('\t');
    if (split < 1) throw new PreviewError('No usable existing identities in the captured data; inspect private selection evidence.');
    rows.set(line.slice(0, split), line.slice(split + 1));
  }
  console.error('Existing identities (private terminal only):');
  for (const [id, label] of rows) console.error(`${id}: ${label}`);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  prompt.on('SIGINT', () => process.emit('SIGINT'));
  try {
    const answer = await prompt.question('Stable IDs to make available, separated by commas: ', { signal });
    return answer.split(',').map(value => {
      const id = value.trim();
      const label = rows.get(id);
      if (label === undefined) throw new PreviewError('Unknown account ID; retry with a listed identity.');
      return { id, label: label || id };
    });
  } finally {
    prompt.close();
  }
}
function accountIds(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = value.split(',').map(id => id.trim());
  if (!ids.length || ids.some(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id)) || new Set(ids).size !== ids.length)
    throw new PreviewError('Use --accounts with distinct stable IDs separated by commas.');
  return ids;
}
export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const interruption = listenForInterruption();
  const signal = interruption.signal;
  let failure = 'Publication incomplete';
  const unexpected = 'Invalid or unavailable private input. Run enois-preview --help.';
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
        home: { type: 'string' },
        config: { type: 'string' },
        'refresh-data': { type: 'boolean' },
        accounts: { type: 'string' },
        'force-lease': { type: 'boolean' },
        yes: { type: 'boolean' },
        launcher: { type: 'string' },
        branch: { type: 'string' },
        registry: { type: 'string' },
        worker: { type: 'string' },
        account: { type: 'string' },
      },
    });
    if (values.version) {
      console.log(VERSION);
      return 0;
    }
    if (values.help) {
      console.log(`enois-preview: Publish immutable, disposable Énóis PR previews.

Usage: enois-preview [--home PRIVATE_DIRECTORY] COMMAND
       enois-preview --version

Commands:
  setup [--config WORKSPACE_JSON] [--yes] [--launcher OWNER/REPO] [--branch BRANCH] [--registry ghcr.io/OWNER/NAME] [--worker NAME] [--account CLOUDFLARE_ACCOUNT_ID]
        Create or verify your private infrastructure (infrastructure.json) after one confirmed plan; with --config, also store the workspace
  publish SCENARIO [--refresh-data] [--accounts ID[,ID...]] [--force-lease]    Publish commits with frozen scenario data
  resume REVISION [--force-lease]    Continue the recorded immutable revision
  source-digest    Report the logical digest of the source database from a private copy (read only)

Every final JSON result carries warnings: [{code, message}]; each warning is also printed on stderr as "warning: MESSAGE".`);
      return 0;
    }
    const command = positionals[0];
    if (command === 'source-digest') failure = 'Source digest incomplete';
    if (command === 'setup') failure = 'Setup incomplete';
    const publicationOnly = values.accounts !== undefined || values['force-lease'] !== undefined;
    const setupOnly = [values.yes, values.launcher, values.branch, values.registry, values.worker, values.account].some(
      value => value !== undefined,
    );
    if (
      (command === 'setup' && (positionals.length !== 1 || values['refresh-data'] || publicationOnly))
      || (command !== 'setup' && setupOnly)
      || (command === 'publish' && (positionals.length !== 2 || values.config !== undefined))
      || (command === 'resume'
        && (positionals.length !== 2 || values.config !== undefined || values['refresh-data'] || values.accounts !== undefined))
      || (command === 'source-digest'
        && (positionals.length !== 1 || values.config !== undefined || values['refresh-data'] || publicationOnly))
    ) {
      throw new PreviewError('Invalid command arguments. Run enois-preview --help.');
    }
    if (!['setup', 'publish', 'resume', 'source-digest'].includes(command ?? '')) {
      console.error(
        `${command === undefined ? 'Missing command.' : `Unknown command ${command}.`} Choose setup, publish, resume or source-digest. Run enois-preview --help.`,
      );
      return 1;
    }
    const infrastructure = command === 'setup' ? undefined : await readInfrastructure();
    const home = values.home ?? process.env.ENOIS_PREVIEW_HOME ?? join(homedir(), '.config/enois-preview-ts');
    const file = join(home, 'config.json');
    const hasConfig = await access(file).then(
      () => true,
      () => false,
    );
    const config = hasConfig ? await readRecord(file) : undefined;
    const finish = (outcome: { result: Record<string, unknown>; warnings: unknown[] }) => {
      signal.throwIfAborted();
      console.log(JSON.stringify({ ...outcome.result, warnings: outcome.warnings }, null, 2));
      return 0;
    };
    if (command === 'source-digest') {
      // Read only, so it needs no verified installation: it must work before the tool is installed.
      if (!config) throw new PreviewError('Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.');
      return finish(
        await collectWarnings(async () => {
          warnIgnoredFields(config);
          return { ...(await sourceDigest(combine(config, infrastructure!), signal)) };
        }),
      );
    }
    if (['publish', 'resume'].includes(command ?? '')) {
      if (!config) throw new PreviewError('Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.');
      const selected = accountIds(values.accounts);
      const { publishRevision, resumeRevision } = await import('./publication.js');
      signal.throwIfAborted();
      return finish(
        await collectWarnings(async () => {
          warnIgnoredFields(config);
          return command === 'publish'
            ? await publishRevision(
                combine(config, infrastructure!),
                positionals[1] ?? '',
                {
                  refresh: values['refresh-data'] ?? false,
                  select: selectAccounts,
                  ...(selected ? { accounts: selected } : {}),
                  forceLease: values['force-lease'] ?? false,
                },
                signal,
              )
            : await resumeRevision(combine(config, infrastructure!), positionals[1] ?? '', signal, values['force-lease'] ?? false);
        }),
      );
    }
    const supplied = values.config ? await readRecord(values.config) : undefined;
    const candidate: Record<string, unknown> | undefined = supplied ? { ...config, ...supplied } : undefined;
    return finish(
      await collectWarnings(async () => {
        if (candidate) warnIgnoredFields(candidate);
        const workspace = candidate ? { validated: validateWorkspace(candidate), record: candidate } : undefined;
        return setup(
          {
            home,
            yes: values.yes ?? false,
            launcher: values.launcher,
            branch: values.branch,
            registry: values.registry,
            worker: values.worker,
            account: values.account,
            workspace,
          },
          signal,
        );
      }),
    );
  } catch (error: unknown) {
    console.error(`${failure}: ${error instanceof PreviewError ? error.message : unexpected}`);
    return interruption.exitCode ?? 1;
  } finally {
    interruption.dispose();
  }
}

if (await invokedDirectly(import.meta.url)) {
  process.exitCode = await main();
  // main has already awaited every cancelled command; a socket abandoned by a cancelled download must not keep an interrupted process alive.
  if (process.exitCode === 130 || process.exitCode === 143) process.exit();
}

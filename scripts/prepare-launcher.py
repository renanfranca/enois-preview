#!/usr/bin/env python3
"""Prepare a private consumer of an immutable public tool commit, locally only."""
import argparse
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, read, write

ROOT = Path(__file__).resolve().parents[1]


def prepare(destination, repository, tool_commit, worker_name):
    destination = Path(destination).resolve()
    if destination.exists(): raise PreviewError('Choose a new launcher destination; existing files are never replaced.')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository): raise PreviewError('Use owner/private-launcher for the repository.')
    if not re.fullmatch(r'[a-f0-9]{40}', tool_commit): raise PreviewError('Pin the full public tool commit, never a branch or mutable tag.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', worker_name): raise PreviewError('Use a valid Worker name.')
    destination.mkdir(mode=0o700, parents=True)
    dependencies = read(ROOT / 'package.json')['devDependencies']
    package = {'name':'enois-private-preview-launcher', 'private':True, 'type':'module',
        'scripts':{'test':'npm --prefix node_modules/enois-preview test',
                   'check':'wrangler deploy --dry-run',
                   'deploy':'node node_modules/enois-preview/scripts/check-release.mjs && wrangler deploy'},
        'devDependencies':{**dependencies, 'enois-preview':'https://codeload.github.com/renanfranca/enois-preview/tar.gz/' + tool_commit}}
    write(destination / 'package.json', package)
    write(destination / 'tool.lock.json', {'repository':'renanfranca/enois-preview', 'commit':tool_commit})
    write(destination / 'catalog/scenarios.json', {})
    (destination / 'launcher.mjs').write_text("import catalog from './catalog/scenarios.json' with { type: 'json' };\n"
        "import { createWorker } from 'enois-preview/src/worker.mjs';\n"
        "export { Scenario } from 'enois-preview/src/scenario.mjs';\n"
        "export default createWorker(catalog);\n")
    (destination / '.gitignore').write_text('node_modules/\n.wrangler/\n.dev.vars*\n.env*\n')
    write(destination / 'wrangler.jsonc', {'name':worker_name, 'main':'launcher.mjs',
        'compatibility_date':'2026-10-01', 'workers_dev':True, 'observability':{'enabled':False},
        'vars':{'LAUNCH_ENABLED':'false', 'GITHUB_REPOSITORY':repository, 'GITHUB_OWNER':repository.split('/')[0]},
        'durable_objects':{'bindings':[{'name':'SCENARIOS', 'class_name':'Scenario'}]},
        'migrations':[{'tag':'v1', 'new_sqlite_classes':['Scenario']}]})
    return {'directory':str(destination), 'publicToolCommit':tool_commit, 'launchEnabled':False, 'remoteWrites':False,
            'next':'Follow installation diagnostics, authenticate in your local terminal, and verify private destinations with enois-preview setup.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--tool-commit', required=True)
    parser.add_argument('--worker-name', required=True)
    args = parser.parse_args()
    try: print(json.dumps(prepare(args.destination, args.repository, args.tool_commit, args.worker_name), indent=2))
    except PreviewError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

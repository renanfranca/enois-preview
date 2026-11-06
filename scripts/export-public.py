#!/usr/bin/env python3
"""Prepare reviewable public sources, without Git history or remote publication.

The allowlist is deliberate: adding a file requires reviewing its public status.
Operational catalog, original validation history, .git, captures and credentials
are never copied by directory traversal.
"""
import argparse
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, identity, inventory, read, write

ROOT = Path(__file__).resolve().parents[1]
MARKER = '## Automation implementation and delivery, 5–6 November 2026'


def export(destination, source=ROOT):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists() or destination == source or source in destination.parents:
        raise PreviewError('Public export requires a new destination outside the source checkout.')
    files = read(source / 'release/public-files.json')
    for relative in files:
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts or any(part.startswith('.') and part != '.gitignore' for part in path.parts):
            raise PreviewError('Unsafe public source allowlist entry.')
        file = source / path
        if not file.is_file() or file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != source):
            raise PreviewError('Missing or symlinked public source; review the allowlist before export.')
    destination.mkdir(mode=0o700, parents=True)
    try:
        for relative in files:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / relative, target)
        # Source tests require a default catalog, but operational entries belong
        # exclusively to the private consumer. This file has no private input.
        write(destination / 'catalog/scenarios.json', {})
        write(destination / 'release/channel.json', {'schema':1, 'requiresPublicToolPin':True})
        write(destination / 'wrangler.jsonc', {
            'name':'enois-preview-development', 'main':'src/worker.mjs', 'compatibility_date':'2026-10-01',
            'workers_dev':True, 'observability':{'enabled':False},
            'vars':{'LAUNCH_ENABLED':'false', 'GITHUB_REPOSITORY':'operator/private-launcher', 'GITHUB_OWNER':'operator'},
            'durable_objects':{'bindings':[{'name':'SCENARIOS', 'class_name':'Scenario'}]},
            'migrations':[{'tag':'v1', 'new_sqlite_classes':['Scenario']}],
        })
        validation = (source / 'VALIDATION.md').read_text()
        if MARKER not in validation:
            raise PreviewError('Current acceptance section missing; historical private evidence must not be exported.')
        section = validation[validation.index(MARKER):]
        section = section.replace(str(source), 'PRIVATE_TOOL_WORKSPACE')
        (destination / 'VALIDATION.md').write_text('# Current validation record\n\n' + section)
        diagnostics = destination / 'docs/diagnostics/README.md'
        if diagnostics.exists():
            text = diagnostics.read_text()
            start = text.find('Private configuration contains')
            if start < 0:
                raise PreviewError('Diagnostics export boundary missing; inspect the public documentation.')
            diagnostics.write_text('# Installation and recovery diagnostics / Diagnóstico\n\n' + text[start:])
        # The private ExecPlan contains local paths and references the private
        # approved issue. Keep it in the execution checkout only.
        (destination / 'EXECPLAN.md').unlink(missing_ok=True)
        proof = inventory(destination)
        return {'destination':str(destination), 'files':len(proof), 'sourceInventorySha256':identity(proof),
                'historyCopied':False, 'operationalCatalogEntries':0, 'published':False}
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(export(args.destination), indent=2))
    except PreviewError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

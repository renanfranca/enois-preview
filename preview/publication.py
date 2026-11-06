"""Durable orchestration. Every remote side effect has a recorded reconciliation identity."""
import os
from pathlib import Path
import shutil
import re
import uuid
from .capture import capture, commits, export_sources, recover, source_lease
from .state import PreviewError, identity, inventory, lease, private_dir, read, verify, write

ROOT = Path(__file__).resolve().parents[1]


def tool_commit(config):
    from .state import run
    commit = config.get('toolCommit')
    if commit is None: return None  # Private prerelease validation, before a public commit exists.
    if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise PreviewError('Configure the immutable public toolCommit from your private launcher pin.')
    if run(['git','-C',ROOT,'rev-parse','HEAD']).decode().strip() != commit or run(['git','-C',ROOT,'status','--porcelain=v1','--untracked-files=all']):
        raise PreviewError('Tool checkout differs from the configured public commit; restore that clean tool checkout before publishing or resuming.')
    return commit


def recipe_inventory():
    return {name: inventory(ROOT / name) for name in ('recipe', 'runtime', 'src')}


def verify_data_manifest(data, expected_id):
    if not isinstance(expected_id,str) or not re.fullmatch(r'[a-f0-9]{64}',expected_id):
        raise PreviewError('Invalid frozen data reference; restore the recorded manifest. No recapture attempted.')
    content = dict(data)
    recorded = content.pop('id', None)
    if recorded != expected_id or identity(content) != recorded:
        raise PreviewError('Frozen data manifest identity mismatch; restore the recorded artifact. No recapture attempted.')


def verify_journal(config, journal):
    previous=journal['inputs'].get('toolCommit');executor=tool_commit(config)
    if previous != executor:
        file=ROOT/'release/resume-compatible-tools.json'
        compatibility=read(file) if file.exists() else {}
        if not executor or not previous or compatibility.get('schema')!=1 or previous not in compatibility.get('toolCommits',[]):
            raise PreviewError('Resume requires the recorded public tool commit or an explicitly reviewed compatible release; restore its tool checkout and installation pin.')
    if identity(journal['inputs']) != journal['revision']:
        raise PreviewError('Journal revision identity mismatch; restore the original record.')
    if journal['target'] != {key: config[key] for key in ('repository', 'registry', 'branch', 'origin', 'cloudflareAccountId')}:
        raise PreviewError('Revision targets another installation; restore its configuration.')
    if 'sourceFiles' not in journal['inputs']:
        raise PreviewError('Unsupported prototype journal without a committed source inventory. Preserve its artifacts; do not publish replacement inputs under this identity.')
    location = Path(config['state']) / 'operations' / journal['revision']
    verify_data_manifest(journal['inputs']['dataManifest'], journal['inputs']['data'])
    verify(location / 'frozen/data', journal['inputs']['dataManifest']['files'])
    verify(location / 'frozen/sources', journal['inputs']['sourceFiles'])
    for name, expected in journal['inputs']['recipe'].items(): verify(location / 'frozen' / name, expected)
    verify(location / 'frozen', journal['frozenFiles'])
    return location


def publish_revision(config, scenario, refresh=False, select=None):
    state = private_dir(config['state'])
    with lease(state / 'publication.lock'):
        # Restoration precedes all work after an interrupted capture, even dirty source diagnostics.
        if (state / 'restoration.json').exists():
            with source_lease(config): recover(config)
        versions = commits(config)
        public_tool = tool_commit(config)
        pointer = state / 'scenarios' / f'{scenario}.json'
        previous = read(pointer) if pointer.exists() else None
        if previous:
            if not isinstance(previous.get('data'),str) or not re.fullmatch(r'[a-f0-9]{64}',previous['data']): raise PreviewError('Invalid scenario data reference; restore its private pointer.')
            data = read(state / 'data' / previous['data'] / 'manifest.json')
            verify_data_manifest(data, previous['data'])
            verify(state / 'data' / data['id'] / 'package', data['files'])
        if not previous or refresh:
            data = capture(config, data if previous else None, select)
            write(pointer, {'data': data['id']})
        if not data.get('sanitizerSha256'):
            raise PreviewError('Prototype data version has no sanitization recipe hash. Preserve it and use an explicit publish --refresh-data with the final recipe; no implicit recapture was attempted.')
        source_export = private_dir(state / 'exports' / uuid.uuid4().hex)
        try:
            export_sources(config, versions, source_export)
            inputs = {'scenario': scenario, 'commits': versions, 'data': data['id'],
                      'dataManifest': data, 'recipe': recipe_inventory(), 'sourceFiles': inventory(source_export)}
            if public_tool: inputs['toolCommit'] = public_tool
            revision = identity(inputs)
            directory = state / 'operations' / revision
            if not directory.exists():
                pending = private_dir(state / 'operations' / ('.pending-' + uuid.uuid4().hex))
                frozen = private_dir(pending / 'frozen')
                shutil.copytree(state / 'data' / data['id'] / 'package', frozen / 'data')
                shutil.copytree(source_export, frozen / 'sources')
                for name in ('recipe', 'runtime', 'src'): shutil.copytree(ROOT / name, frozen / name, ignore=shutil.ignore_patterns('__pycache__'))
                journal = {'revision': revision, 'inputs': inputs, 'slug': f'{scenario}-{revision[:16]}',
                           'operation': uuid.uuid4().hex, 'target': {key: config[key] for key in ('repository', 'registry', 'branch', 'origin', 'cloudflareAccountId')},
                           'frozenFiles': inventory(frozen), 'checkpoints': {}}
                write(pending / 'journal.json', journal)
                os.rename(pending, directory)
        finally:
            shutil.rmtree(source_export)
        journal = read(directory / 'journal.json')
        return continue_revision(config, journal, data_reused=bool(previous and not refresh))


def resume_revision(config, revision):
    state = private_dir(config['state'])
    with lease(state / 'publication.lock'):
        if (state / 'restoration.json').exists():
            with source_lease(config): recover(config)
        file = state / 'operations' / revision / 'journal.json'
        if not file.is_file(): raise PreviewError('Unknown revision; inspect private operations. Resume never recaptures incomplete live data.')
        journal = read(file)
        if journal.get('revision') != revision: raise PreviewError('Operation journal belongs to another revision; restore the matching journal before resuming.')
        return continue_revision(config, journal, data_reused=True)


def continue_revision(config, journal, data_reused):
    from .remote import Publisher
    revision = journal.get('revision', '')
    if not re.fullmatch(r'[a-f0-9]{64}', revision): raise PreviewError('Invalid operation identity; restore its original journal.')
    directory = Path(config['state']) / 'operations' / revision
    publisher = None
    try:
        verify_journal(config, journal)
        journal['executorToolCommit']=tool_commit(config)
        write(directory/'journal.json',journal)
        publisher = Publisher(config, journal, directory)
        already = journal['checkpoints'].get('publicValidation') is not None
        publisher.build_and_validate()
        publisher.acquire_remote_lease()
        publisher.registry()
        publisher.configuration()
        publisher.catalog()
        publisher.deploy()
        result = publisher.validate_public()
        publisher.release_remote_lease()
    except (Exception, KeyboardInterrupt) as error:
        stage = journal.get('stage', 'frozenInputs') if publisher else 'frozenInputs'
        reason = str(error) if isinstance(error,PreviewError) else type(error).__name__
        released = False
        if publisher and stage == 'publicValidation' and all(key in journal['checkpoints'] for key in ('remoteLease','registry','configuration','catalog','deployment')):
            # All infrastructure writes have confirmed identities. A failed
            # application check must not prevent a corrective new revision.
            # Earlier/ambiguous remote failures retain their serialization lease.
            try:
                publisher.release_remote_lease()
                released = True
            except (Exception, KeyboardInterrupt):
                pass  # Preserve the original failure and the recorded release intent.
        write(directory / 'failure.json', {'stage': stage, 'revision': journal['revision'], 'backendRestoration': 'complete', 'reason':reason, 'publicationLeaseReleased':released})
        raise PreviewError(f'Stage {stage} incomplete: {reason}. Backend restoration complete. Revision {journal["revision"]}. Run enois-preview resume {journal["revision"]}. Inspect private evidence at {directory}.') from error
    return {'status': 'validated', 'url': config['origin'].rstrip('/') + '/preview/' + journal['slug'],
            'scenario': journal['inputs']['scenario'], 'revision': journal['revision'], 'reused': already,
            'commits': journal['inputs']['commits'], 'dataVersion': journal['inputs']['data'], 'dataReused': data_reused,
            'toolCommit':journal['inputs'].get('toolCommit'),'executorToolCommit':journal.get('executorToolCommit'),
            'image': journal['checkpoints']['registry']['image'], 'provenanceSha256': journal['checkpoints']['configuration']['provenanceSha256'],
            'configurationCommit': journal['checkpoints']['configuration']['commit'], 'catalogCommit': journal['checkpoints']['catalog']['commit'],
            'deployment': journal['checkpoints']['deployment'], 'validation': result, 'evidence': str(directory),
            'next': 'Update the PR link for a new revision. Publication checks do not replace functional PR validation.'}

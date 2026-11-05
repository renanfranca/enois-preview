"""Capture under a durable restoration record; build code never opens live data."""
import io
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
import uuid
from .config import REPOS
from .state import PreviewError, identity, inventory, lease, private_dir, read, run, sha, verify, write


def source_lease(config):
    # Separate installations pointing at the same H2 share one host/user lease.
    base = Path(os.environ.get('XDG_RUNTIME_DIR', str(Path.home() / '.cache'))) / 'enois-preview/capture'
    return lease(base / (identity(str(Path(config['database']).resolve())) + '.lock'))


def commits(config):
    result = {}
    for repo in REPOS:
        directory = config['repositories'][repo]
        if run(['git', '-C', directory, 'status', '--porcelain=v1', '--untracked-files=all']):
            raise PreviewError(f'{repo} has staged, unstaged or untracked source changes; commit or resolve them before publishing. No service was stopped.')
        result[repo] = run(['git', '-C', directory, 'rev-parse', 'HEAD']).decode().strip()
    return result


def service(config, action):
    return run(config['service'][action], timeout=config['service'].get('timeout', 60)).decode().strip()


def wait_service(config, action, expected):
    deadline = time.monotonic() + config['service'].get('timeout', 60)
    while True:
        try:
            if service(config, action) == expected:
                return
        except PreviewError:
            pass
        if time.monotonic() >= deadline:
            raise PreviewError(f'Backend {action} did not confirm {expected}; inspect its configured service. Restoration is pending if recorded.')
        time.sleep(.1)


def recover(config):
    path = Path(config['state']) / 'restoration.json'
    if not path.exists(): return
    record = read(path)
    if record['service'] != config['service'] or record['database'] != config['database']:
        raise PreviewError('Pending restoration belongs to another service configuration. Restore that configuration before continuing.')
    if service(config, 'identity') != config['service']['expectedIdentity']:
        raise PreviewError('Pending backend restoration: service identity mismatch.')
    status = service(config, 'status')
    if record['running']:
        if status == 'stopped': service(config, 'start')
        elif status != 'running': raise PreviewError('Backend restoration: ambiguous service status.')
        wait_service(config, 'ready', 'ready')
    elif status != 'stopped':
        raise PreviewError('Previously stopped backend changed state; inspect it before continuing.')
    path.unlink()


def safe_copy(source, destination):
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_file():
        raise PreviewError('Capture source is missing, not regular, or a symlink.')
    before = (source.stat().st_size, sha(source))
    private_dir(destination.parent)
    # O_NOFOLLOW prevents replacing the final source path with a symlink during open.
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as original:
        with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as copied:
            shutil.copyfileobj(original, copied)
            copied.flush()
            os.fsync(copied.fileno())
    if before != (destination.stat().st_size, sha(destination)) or before != (source.stat().st_size, sha(source)):
        raise PreviewError('Source changed during capture; incomplete copy rejected.')


def java_tool(config, action, *args):
    root = Path(__file__).resolve().parents[1]
    classes = private_dir(Path(config['state']) / 'tools')
    run(['javac', '-d', classes, root / 'recipe/SeedTool.java'])
    return run(['java', '-cp', f'{classes}{os.pathsep}{config["h2Jar"]}', 'SeedTool', action, *args], log_path=classes / (action + '.log'))


def capture(config, previous=None, select=None):
    outcome = {'backend': 'not paused', 'capture': 'not started'}
    try:
        return _capture(config, previous, select, outcome)
    except (PreviewError, OSError, ValueError, KeyboardInterrupt) as error:
        if (Path(config['state']) / 'restoration.json').exists(): outcome['backend'] = 'restoration pending'
        reason = str(error) if isinstance(error, PreviewError) else 'Private capture input unavailable or capture cancelled.'
        raise PreviewError(f'Capture {outcome["capture"]} incomplete; backend {outcome["backend"]}. {reason} Retry publication explicitly after resolving the cause; resume will not recapture live data.') from error


def _capture(config, previous, select, outcome):
    state = private_dir(config['state'])
    with source_lease(config):
        recover(config)
        initial = service(config, 'status')
        if initial not in ('running', 'stopped') or service(config, 'identity') != config['service']['expectedIdentity']:
            raise PreviewError('Backend identity or running state is ambiguous; no capture attempted.')
        staging = private_dir(state / 'staging' / uuid.uuid4().hex)
        outcome['capture'] = staging.name
        raw = private_dir(staging / 'raw')
        seed = private_dir(staging / 'package' / 'seed')
        restoration = state / 'restoration.json'
        write(restoration, {'service': config['service'], 'database': config['database'], 'running': initial == 'running'})
        outcome['backend'] = 'restoration pending'
        old_handlers = {}
        def interrupted(number, frame):
            raise PreviewError('Capture interrupted; restoration is recorded durably.')
        for number in (signal.SIGTERM, signal.SIGINT):
            old_handlers[number] = signal.signal(number, interrupted)
        try:
            if initial == 'running': service(config, 'stop')
            wait_service(config, 'status', 'stopped')
            wait_service(config, 'released', 'released')
            # Ownership checks are adapter responsibility; independently reject open H2 handles.
            opened = subprocess.run(['fuser', config['database']], capture_output=True)
            if opened.returncode != 1:
                raise PreviewError('H2 is in use or cannot be checked. No lock file was removed.')
            safe_copy(config['database'], raw / 'rede.mv.db')
            mappings = []
            for index, entry in enumerate(config.get('media', [])):
                root = Path(entry['root'])
                before = inventory(root)
                target = private_dir(staging / 'package' / 'media' / str(index))
                for name in before: safe_copy(root / name, target / name)
                verify(root, before)
                verify(target, before)
                mappings.append({'directory': str(index), 'url': entry['url'], 'inventory': before})
            # Never compare live H2 hashes after this restoration; normal backend writes are valid.
        finally:
            try:
                recover(config)
                outcome['backend'] = 'restored to its prior state'
            finally:
                for number, handler in old_handlers.items(): signal.signal(number, handler)
        accounts = previous['accounts'] if previous else config.get('accounts')
        if previous and config.get('accounts') and config['accounts'] != previous['accounts']:
            accounts = config['accounts']
        if not accounts and select:
            listing = java_tool(config, 'list', raw / 'rede').decode()
            accounts = select(listing)
        if not accounts:
            raise PreviewError('Select stable account IDs with enois-preview publish interactively, or configure accounts. Backend restored; capture remains incomplete.')
        validate_accounts(accounts)
        selection = staging / 'accounts.tsv'
        selection.write_text(''.join(f'{a["id"]}\t{a["email"]}\n' for a in accounts))
        selection.chmod(0o600)
        sanitizer_source = Path(__file__).resolve().parents[1] / 'recipe/SeedTool.java'
        sanitizer_hash = sha(sanitizer_source)
        try:
            java_tool(config, 'sanitize', raw / 'rede', seed / 'rede', selection)
        except PreviewError:
            diagnostic = (state / 'tools/sanitize.log').read_text(errors='replace')
            if 'Selected identity missing' in diagnostic:
                raise PreviewError('Selected identity missing in refreshed data. Correct private account IDs with setup, then explicitly refresh again. Previous complete data preserved; backend restored.') from None
            raise
        import base64
        metadata = java_tool(config, 'metadata', seed / 'rede', selection).decode().splitlines()
        permissions, references = {}, []
        for line in metadata:
            fields = line.split('\t')
            if fields[0] == 'permission':
                permissions[fields[1]] = {'admin':fields[2] == 'true', 'moderator':fields[3] == 'true'}
            elif fields[0] == 'reference': references.append(base64.b64decode(fields[1]).decode())
            else: raise PreviewError('Unrecognized seed metadata; capture remains incomplete.')
        if set(permissions) != {a['id'] for a in accounts}: raise PreviewError('Selected permission inventory incomplete.')
        write(seed / 'accounts.json', accounts)
        logical_seed = (seed / 'logical.sha256').read_text().strip()
        # Raw pages and SQL never become part of the package/build context.
        shutil.rmtree(raw)
        selection.unlink()
        shutil.copyfile(sanitizer_source, staging / 'sanitizer.java')
        (staging / 'sanitizer.java').chmod(0o600)
        if sha(staging / 'sanitizer.java') != sanitizer_hash: raise PreviewError('Sanitization recipe changed during capture; retry explicitly.')
        if previous and previous.get('sanitizerSha256') == sanitizer_hash and previous.get('logicalSeedSha256') == logical_seed and previous['accounts'] == accounts and previous['media'] == mappings and previous['recipe'] == 2:
            shutil.rmtree(staging)
            return previous
        manifest = {'logicalSeedSha256': logical_seed, 'sanitizerSha256':sanitizer_hash, 'schema': 3, 'recipe': 2, 'accounts': accounts, 'permissions':permissions, 'externalReads':references, 'media': mappings,
                    'files': inventory(staging / 'package')}
        data_id = identity(manifest)
        manifest['id'] = data_id
        write(staging / 'manifest.json', manifest)
        target = state / 'data' / data_id
        private_dir(target.parent)
        if target.exists():
            if read(target / 'manifest.json') != manifest: raise PreviewError('Stored data version metadata mismatch; restore it instead of replacing an immutable version.')
            verify(target / 'package', manifest['files'])
            shutil.rmtree(staging)
        else: os.rename(staging, target)
        return manifest


def validate_accounts(accounts):
    import re
    if (not isinstance(accounts, list) or not 1 <= len(accounts) <= 20 or not all(isinstance(a,dict) and isinstance(a.get('id'),str) and isinstance(a.get('email'),str) for a in accounts)
        or len({a.get('id') for a in accounts}) != len(accounts)
        or len({a.get('email') for a in accounts}) != len(accounts)):
        raise PreviewError('Select one to twenty distinct existing identities and distinct demo logins.')
    for a in accounts:
        if (not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', a.get('id', ''))
            or not re.fullmatch(r'[a-z0-9._-]+@enois\.invalid', a.get('email', ''))
            or not isinstance(a.get('label'), str) or not 1 <= len(a['label']) <= 100):
            raise PreviewError('Accounts require stable id, label, and disposable @enois.invalid email.')


def export_sources(config, versions, destination):
    for repo, commit in versions.items():
        target = Path(destination) / repo
        target.mkdir(parents=True)
        archive = run(['git', '-C', config['repositories'][repo], 'archive', commit])
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            # Git symlinks are allowed only when they resolve inside the export.
            files.extractall(target, filter='data')

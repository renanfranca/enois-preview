#!/usr/bin/env python3
"""Record or reconstruct the demo sources without touching the original repositories."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

EXCLUDED = {'.git', 'node_modules', 'target', '.output', 'dist', '.env', '.env.local'}
REPOS = {'backend': 'enois-backend', 'frontend': 'enois-frontend', 'design-system': 'enois-design-system'}

def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs).stdout

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def extract(repo, sha, destination):
    raw = run(['git', '-C', str(repo), 'archive', sha])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        archive.extractall(destination, filter='data')

def inventory(root):
    return {str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and not (set(p.relative_to(root).parts) & EXCLUDED)
            and not p.name.startswith('.env.')}

def media_inventory(package):
    root = package / 'media'
    return {p.relative_to(package).as_posix(): {'bytes': p.stat().st_size, 'sha256': digest(p)}
            for p in sorted(root.rglob('*')) if p.is_file()}

def verify_media(package, manifest):
    schema = manifest['schema']
    if schema == 1:
        return {}
    if schema != 2:
        raise SystemExit(f'Unsupported snapshot schema: {schema}')
    media = manifest.get('media')
    if not isinstance(media, dict) or not media:
        raise SystemExit('Missing media inventory')
    for name, expected in media.items():
        path = PurePosixPath(name)
        if (path.is_absolute() or '..' in path.parts or len(path.parts) != 3
                or path.parts[:2] != ('media', 'pearl-jam.local') or str(path) != name):
            raise SystemExit(f'Invalid media path: {name}')
        source = package / name
        if (not source.is_file() or source.is_symlink() or source.stat().st_size != expected['bytes']
                or digest(source) != expected['sha256']):
            raise SystemExit(f'Media mismatch: {name}')
    if media_inventory(package) != media:
        raise SystemExit('Media inventory mismatch')
    return media

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['record', 'rebuild'])
parser.add_argument('--package', type=Path, required=True)
parser.add_argument('--repositories', type=Path, required=True)
parser.add_argument('--destination', type=Path)
args = parser.parse_args()
package = args.package.resolve()
proof = Path(__file__).resolve().parents[1] / 'catalog' / 'provenance'

if args.action == 'record':
    proof.mkdir(parents=True, exist_ok=True)
    sources = json.loads((package / 'sources.json').read_text())
    manifest = {'schema': 2, 'sources': sources, 'sourceTree': inventory(package / 'src'),
                'media': media_inventory(package),
                'seedSha256': digest(package / 'seed/rede.mv.db'), 'accountSha256': digest(package / 'seed/account.txt'),
                'originalObservedSha256': digest(args.repositories / '.local/data/rede.mv.db'),
                'upstreamQaObserved': {}, 'patches': {}, 'runtime': {}}
    verify_media(package, manifest)
    for short, repo in REPOS.items():
        original = args.repositories / repo
        manifest['upstreamQaObserved'][repo] = run(['git', '-C', str(original), 'rev-parse', 'upstream/qa']).decode().strip()
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            extract(original, sources[repo], temporary)
            run(['git', 'init', '-q', str(temporary)])
            run(['git', '-C', str(temporary), 'add', '.'])
            for child in temporary.iterdir():
                if child.name != '.git':
                    if child.is_dir(): shutil.rmtree(child)
                    else: child.unlink()
            shutil.copytree(package / 'src' / short, temporary, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns(*EXCLUDED, '.env.*'))
            # Include additions in git diff, without including local build outputs.
            run(['git', '-C', str(temporary), 'add', '-N', '.'])
            patch = proof / f'{short}.patch'
            patch.write_bytes(run(['git', '-C', str(temporary), 'diff', '--binary', '--no-ext-diff']))
            manifest['patches'][short] = digest(patch)
    for name in ['Dockerfile', 'launcher/runtime/start.sh', 'launcher/runtime/gateway.mjs', 'launcher/runtime/register-codespace.mjs', 'launcher/runtime/demo-activity.mjs', 'launcher/runtime/DemoCredentials.java']:
        manifest['runtime'][name] = digest(package / name)
    transport = 'launcher/runtime/upload-transport.mjs'
    if (package / transport).is_file(): manifest['runtime'][transport] = digest(package / transport)
    (proof / 'snapshot.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Snapshot recorded; original database was read only for SHA256.')
else:
    if not args.destination: parser.error('--destination is required for rebuild')
    destination = args.destination.resolve()
    if destination.exists(): raise SystemExit('Destination must not exist')
    manifest = json.loads((proof / 'snapshot.json').read_text())
    media = verify_media(package, manifest)
    if digest(package / 'seed/rede.mv.db') != manifest['seedSha256']: raise SystemExit('Seed mismatch')
    if digest(package / 'seed/account.txt') != manifest['accountSha256']: raise SystemExit('Shared account mismatch')
    for short, repo in REPOS.items():
        target = destination / 'src' / short
        target.mkdir(parents=True)
        extract(args.repositories / repo, manifest['sources'][repo], target)
        patch = proof / f'{short}.patch'
        if digest(patch) != manifest['patches'][short]: raise SystemExit('Patch mismatch')
        if patch.stat().st_size: run(['git', '-C', str(target), 'apply', str(patch)])
    tarball = 'rede-enois-design-system-' + manifest['sources']['design-system-version'] + '.tgz'
    shutil.copy2(package / 'src' / tarball, destination / 'src' / tarball)
    if inventory(destination / 'src') != manifest['sourceTree']: raise SystemExit('Rebuilt source tree mismatch')
    for name, expected in manifest['runtime'].items():
        if digest(package / name) != expected: raise SystemExit(f'Runtime mismatch: {name}')
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(package / name, target)
    shutil.copytree(package / 'seed', destination / 'seed')
    for name in media:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(package / name, target)
    if media:
        verify_media(destination, manifest)
    shutil.copy2(proof / 'snapshot.json', destination / 'snapshot.json')
    shutil.copy2(package / '.dockerignore', destination / '.dockerignore')
    print(f'Rebuilt source tree, runtime, seed and {len(media)} media files match the recorded SHA256 manifest.')

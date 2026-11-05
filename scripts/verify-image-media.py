#!/usr/bin/env python3
"""Verify scenario inventories without assuming any particular community or public URL root."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('image')
parser.add_argument('--manifest', type=Path, default=Path(__file__).resolve().parents[1] / 'catalog/provenance/snapshot.json')
args = parser.parse_args()
record = json.loads(args.manifest.read_text())
manifest = record.get('inputs', {}).get('dataManifest', record)
if manifest['schema'] not in (1, 2, 3): raise SystemExit('Unsupported snapshot schema')
container = subprocess.check_output(['docker', 'create', args.image], text=True).strip()

def inventory(root):
    return {p.relative_to(root).as_posix(): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(root.rglob('*')) if p.is_file()}

try:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        subprocess.run(['docker', 'cp', f'{container}:/opt/render-demo/seed', str(root / 'seed')], check=True, capture_output=True)
        count, total = 0, 0
        if manifest['schema'] == 3:
            subprocess.run(['docker', 'cp', f'{container}:/opt/render-demo/media', str(root / 'media')], check=True, capture_output=True)
            for mapping in manifest['media']:
                if not str(mapping['directory']).isdigit(): raise SystemExit('Unsafe media mapping')
                actual = inventory(root / 'media' / mapping['directory'])
                if actual != mapping['inventory']: raise SystemExit('Image media mismatch')
                count += len(actual); total += sum(item['bytes'] for item in actual.values())
            for relative, expected in manifest['files'].items():
                path = PurePosixPath(relative)
                if path.parts[0] != 'seed': continue
                if path.is_absolute() or '..' in path.parts: raise SystemExit('Unsafe seed path')
                if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected['sha256']: raise SystemExit('Image seed mismatch')
        else:
            # Schemas 1/2 retain their original artifact layout and single account selector.
            for name, field in [('rede.mv.db', 'seedSha256'), ('account.txt', 'accountSha256')]:
                if hashlib.sha256((root / 'seed' / name).read_bytes()).hexdigest() != manifest[field]: raise SystemExit(f'Image seed mismatch: {name}')
            groups = {}
            for name, expected in manifest.get('media', {}).items():
                path = PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts or path.parts[0] != 'media' or len(path.parts) < 3: raise SystemExit('Unsafe media path')
                groups.setdefault(path.parts[1], {})['/'.join(path.parts[2:])] = expected
            for prefix, expected in groups.items():
                subprocess.run(['docker', 'cp', f'{container}:/opt/render-demo/frontend/public/{prefix}', str(root / prefix)], check=True, capture_output=True)
                actual = inventory(root / prefix)
                if actual != expected: raise SystemExit('Image media mismatch')
                count += len(actual); total += sum(item['bytes'] for item in actual.values())
        print(json.dumps({'image': args.image, 'schema': manifest['schema'], 'mediaFiles': count, 'mediaBytes': total,
                          'mediaHashesMatch': True, 'provenanceSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest()}))
finally:
    subprocess.run(['docker', 'rm', container], check=True, capture_output=True)

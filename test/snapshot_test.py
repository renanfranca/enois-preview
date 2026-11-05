"""Exercise the public record/rebuild CLI with isolated repositories and artifacts."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / 'package'
        self.script = self.package / 'launcher/scripts/snapshot.py'
        self.script.parent.mkdir(parents=True)
        shutil.copy2(Path(__file__).resolve().parents[1] / 'scripts/snapshot.py', self.script)
        sources = {'design-system-version': '0.12.0'}
        for short in ['backend', 'frontend', 'design-system']:
            repo = self.root / f'enois-{short}'
            repo.mkdir()
            self.git(repo, 'init', '-q')
            (repo / 'source.txt').write_text(f'{short} original\n')
            self.git(repo, 'add', '.')
            self.git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            sources[f'enois-{short}'] = self.git(repo, 'rev-parse', 'HEAD').strip()
            self.git(repo, 'update-ref', 'refs/remotes/upstream/qa', sources[f'enois-{short}'])
            target = self.package / 'src' / short
            target.mkdir(parents=True)
            (target / 'source.txt').write_text(f'{short} demo\n')
        (self.package / 'sources.json').write_text(json.dumps(sources))
        (self.package / 'src/rede-enois-design-system-0.12.0.tgz').write_bytes(b'fixture package')
        for name in ['Dockerfile', '.dockerignore', 'seed/rede.mv.db', 'seed/account.txt',
                     'launcher/runtime/start.sh', 'launcher/runtime/gateway.mjs',
                     'launcher/runtime/register-codespace.mjs', 'launcher/runtime/demo-activity.mjs',
                     'launcher/runtime/DemoCredentials.java', 'media/pearl-jam.local/avatar.jpg',
                     'media/pearl-jam.local/badge.png']:
            target = self.package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(name.encode())
        original = self.root / '.local/data/rede.mv.db'
        original.parent.mkdir(parents=True)
        original.write_bytes(b'untouched original')
        self.proof = self.package / 'launcher/catalog/provenance'
        self.cli('record')

    def git(self, repo, *args):
        return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, text=True).stdout

    def cli(self, action, success=True):
        result = subprocess.run(['python3', str(self.script), action, '--package', str(self.package),
                                 '--repositories', str(self.root), '--destination', str(self.root / 'rebuilt')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def manifest(self):
        return json.loads((self.proof / 'snapshot.json').read_text())

    def write_manifest(self, manifest):
        (self.proof / 'snapshot.json').write_text(json.dumps(manifest))

    def test_rebuild_restores_recorded_media_sources_runtime_and_seed(self):
        manifest = self.manifest()
        self.assertEqual(manifest['schema'], 2)
        self.assertEqual(len(manifest['media']), 2)
        self.cli('rebuild')
        for name, expected in manifest['media'].items():
            content = (self.root / 'rebuilt' / name).read_bytes()
            self.assertEqual(len(content), expected['bytes'])
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected['sha256'])
        self.assertEqual((self.root / 'rebuilt/src/frontend/source.txt').read_text(), 'frontend demo\n')
        self.assertEqual((self.root / '.local/data/rede.mv.db').read_bytes(), b'untouched original')

    def test_missing_media_fails_before_creating_destination(self):
        (self.package / 'media/pearl-jam.local/avatar.jpg').unlink()
        self.assertIn('Media mismatch', self.cli('rebuild', success=False).stderr)
        self.assertFalse((self.root / 'rebuilt').exists())

    def test_same_size_corruption_is_rejected(self):
        path = self.package / 'media/pearl-jam.local/avatar.jpg'
        path.write_bytes(b'x' * path.stat().st_size)
        self.assertIn('Media mismatch', self.cli('rebuild', success=False).stderr)

    def test_extra_media_is_rejected(self):
        (self.package / 'media/pearl-jam.local/extra.jpg').write_bytes(b'extra')
        self.assertIn('Media inventory mismatch', self.cli('rebuild', success=False).stderr)

    def test_invalid_media_path_is_rejected(self):
        manifest = self.manifest()
        manifest['media']['media/pearl-jam.local/../outside.jpg'] = next(iter(manifest['media'].values()))
        self.write_manifest(manifest)
        self.assertIn('Invalid media path', self.cli('rebuild', success=False).stderr)

    def test_schema_two_cannot_silently_omit_media(self):
        manifest = self.manifest()
        del manifest['media']
        self.write_manifest(manifest)
        self.assertIn('Missing media inventory', self.cli('rebuild', success=False).stderr)

    def test_schema_one_remains_readable_without_media(self):
        manifest = self.manifest()
        manifest['schema'] = 1
        del manifest['media']
        self.write_manifest(manifest)
        shutil.rmtree(self.package / 'media')
        self.cli('rebuild')
        self.assertTrue((self.root / 'rebuilt/seed/rede.mv.db').is_file())
        self.assertFalse((self.root / 'rebuilt/media').exists())

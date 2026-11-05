"""The private consumer pins source and prepares no remote resources or secrets."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, read
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_launcher', ROOT / 'scripts/prepare-launcher.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrivateConsumerTests(unittest.TestCase):
    def test_consumer_has_exact_public_commit_and_imports_its_worker_with_a_private_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'private-launcher'
            commit = 'a' * 40
            result = module.prepare(destination, 'fixture/private-launcher', commit, 'fixture-preview')
            self.assertFalse(result['remoteWrites'])
            package = read(destination / 'package.json')
            self.assertTrue(package['private'])
            self.assertEqual(package['devDependencies']['enois-preview'], 'https://codeload.github.com/renanfranca/enois-preview/tar.gz/' + commit)
            self.assertEqual(read(destination / 'tool.lock.json')['commit'], commit)
            self.assertEqual(read(destination / 'catalog/scenarios.json'), {})
            self.assertEqual(read(destination / 'wrangler.jsonc')['vars']['LAUNCH_ENABLED'], 'false')
            self.assertIn("from 'enois-preview/src/worker.mjs'", (destination / 'launcher.mjs').read_text())
            with self.assertRaises(PreviewError): module.prepare(destination, 'fixture/private-launcher', commit, 'fixture-preview')
            self.assertEqual(read(destination / 'tool.lock.json')['commit'], commit)

    def test_mutable_tool_branch_is_refused_before_creating_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'private-launcher'
            with self.assertRaises(PreviewError): module.prepare(destination, 'fixture/private-launcher', 'main', 'fixture-preview')
            self.assertFalse(destination.exists())

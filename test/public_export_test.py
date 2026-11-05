"""Public export refuses unsafe entries and cannot inherit operational history."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, read, write
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('public_export', ROOT / 'scripts/export-public.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'private'
        self.destination = self.root / 'public'
        write(self.source / 'release/public-files.json', ['tool.py'])
        (self.source / 'tool.py').write_text('print("public source")\n')
        (self.source / 'VALIDATION.md').write_text('private historical marker\n' + module.MARKER + '\nCurrent incomplete acceptance.\n')
        for path in ('.git/config', '.env', 'catalog/scenarios.json', 'work/credentials.json', 'seed/rede.mv.db', 'unreviewed.py'):
            target = self.source / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('private-sentinel-never-public')

    def test_export_has_no_history_operational_catalog_or_unreviewed_private_files(self):
        report = module.export(self.destination, self.source)
        self.assertFalse(report['published'])
        self.assertEqual(read(self.destination / 'catalog/scenarios.json'), {})
        for file in self.destination.rglob('*'):
            if file.is_file():
                self.assertNotIn('private-sentinel', file.read_text())
                self.assertNotIn('private historical marker', file.read_text())
        self.assertFalse((self.destination / '.git').exists())
        self.assertFalse((self.destination / 'unreviewed.py').exists())
        self.assertEqual((self.destination / 'tool.py').read_bytes(), (self.source / 'tool.py').read_bytes())

    def test_existing_destination_traversal_and_symlink_are_refused_without_overwrite(self):
        self.destination.mkdir()
        (self.destination / 'keep').write_text('operator data')
        with self.assertRaises(PreviewError): module.export(self.destination, self.source)
        self.assertEqual((self.destination / 'keep').read_text(), 'operator data')
        for entry in ('../private/.env', '/absolute/path', '.git/config'):
            write(self.source / 'release/public-files.json', [entry])
            with self.assertRaises(PreviewError): module.export(self.root / 'other', self.source)
        (self.source / 'public-link').symlink_to(self.source / '.env')
        write(self.source / 'release/public-files.json', ['public-link'])
        with self.assertRaises(PreviewError): module.export(self.root / 'other', self.source)

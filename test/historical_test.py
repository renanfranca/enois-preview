"""Private repository evidence against actual immutable historical catalog records."""
import json
from pathlib import Path
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class HistoricalCatalogTests(unittest.TestCase):
    def test_three_published_scenarios_retain_actual_historical_records(self):
        checkout=subprocess.run(['git','-C',ROOT,'rev-parse','--show-toplevel'],capture_output=True,text=True)
        if checkout.returncode or Path(checkout.stdout.strip()).resolve()!=ROOT.resolve():
            self.skipTest('Installed public tool dependencies intentionally exclude private historical catalog objects')
        probe=subprocess.run(['git','-C',ROOT,'cat-file','-e','3461a05^{commit}'],capture_output=True)
        if probe.returncode: self.skipTest('Historical private Git objects are intentionally excluded from public source exports')
        current=json.loads((ROOT/'catalog/scenarios.json').read_text())
        for slug,commit in [('teste-01','d92e305'),('teste-02','6c81d72'),('teste-03','fd805ac')]:
            configuration=json.loads(subprocess.check_output(['git','-C',ROOT,'show',f'{commit}:.devcontainer/{slug}/scenario.json']))
            dev=json.loads(subprocess.check_output(['git','-C',ROOT,'show',f'{commit}:.devcontainer/{slug}/devcontainer.json']))
            for key,value in configuration.items(): self.assertEqual(current[slug][key],value,(slug,key))
            self.assertTrue(current[slug]['launcherCommit'].startswith(commit))
            self.assertEqual(current[slug]['image'],dev['image'])
            snapshot=json.loads(subprocess.check_output(['git','-C',ROOT,'show',f'{commit}:catalog/provenance/snapshot.json']))
            self.assertIn(snapshot['schema'],(1,2))
        reference=json.loads(subprocess.check_output(['git','-C',ROOT,'show','3461a05:catalog/scenarios.json']))
        self.assertEqual(current,reference)

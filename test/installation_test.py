"""Setup CLI behavior with isolated preflight doubles; no platform billing is audited."""
import builtins
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.cli import main
from preview.state import read,write
from preview.config import legacy_confirmation
from preview.state import PreviewError

class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.home=self.root/'installation';self.source=self.root/'input.json'
        self.config={'schema':1,'toolCommit':'1'*40,'workspace':str(self.root),'state':str(self.root/'state'),'database':str(self.root/'live.mv.db'),
            'h2Jar':str(self.root/'h2.jar'),'repositories':{name:str(self.root/name) for name in ('enois-backend','enois-frontend','enois-design-system')},
            'repository':'fixture/launcher','branch':'preview','registry':'ghcr.io/fixture/image','origin':'https://preview.example.invalid','cloudflareAccountId':'a'*32,
            'service':{**{action:['fixture-service',action] for action in ('identity','status','stop','start','ready','released')},'expectedIdentity':'fixture'}}
        write(self.source,self.config)
    def invoke(self, interactive, answer=None):
        with patch('preview.cli.prerequisites'),patch('sys.stdin.isatty',return_value=interactive),patch.object(builtins,'input',return_value=answer) as prompt,patch('sys.stdout',new_callable=io.StringIO),patch('sys.stderr',new_callable=io.StringIO):
            code=main(['--home',str(self.home),'setup','--config',str(self.source)])
            return code,prompt.call_count
    def test_initial_noninteractive_setup_cannot_assume_confirmation(self):
        self.assertEqual(self.invoke(False),(1,0))
        self.assertFalse((self.home/'config.json').exists())
    def test_declining_initial_setup_preserves_existing_inputs(self):
        before=self.source.read_bytes()
        self.assertEqual(self.invoke(True,'no'),(1,1))
        self.assertEqual(self.source.read_bytes(),before)
        self.assertFalse((self.home/'config.json').exists())
    def test_repeating_setup_preserves_old_confirmation_and_private_values_without_prompt(self):
        self.assertEqual(self.invoke(True,'yes'),(0,1))
        file=self.home/'config.json';installed=read(file)
        installed['installation']['checkedAt']='2000-01-01T00:00:00Z';installed['privateCredentialStore']='fixture-reference-only'
        write(file,installed);write(self.source,self.config)
        self.assertEqual(self.invoke(False),(0,0))
        self.assertEqual(read(file),installed)

    def test_prior_matching_initial_confirmation_migrates_without_expiry_or_timestamp_renewal(self):
        old=self.root/'previous-confirmation.json'
        record={'githubOwner':'fixture','cloudflareAccountId':'a'*32,'githubPlan':'free','cloudflarePlan':'free',
            'githubCodespacesStopUsage':True,'githubPackagesStopUsage':True,'checkedAt':'2000-01-01T00:00:00Z'}
        write(old,record)
        result=legacy_confirmation(self.config,old)
        self.assertEqual(result['checkedAt'],record['checkedAt'])
        self.assertEqual(read(old),record)
        for field,value in [('githubOwner','other'),('cloudflareAccountId','b'*32),('githubPlan','paid'),('githubCodespacesStopUsage',False)]:
            with self.subTest(field=field):
                write(old,{**record,field:value})
                with self.assertRaises(PreviewError):legacy_confirmation(self.config,old)

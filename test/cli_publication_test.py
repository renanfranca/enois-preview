"""Concurrent CLI and checkpoint recovery against local Git and platform doubles."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.state import identity, inventory, read, run, write
ROOT=Path(__file__).resolve().parents[1]
DRIVER=ROOT/'test/fixtures/publication_driver.py'


class CliPublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.home=self.root/'home';self.state=self.root/'private'
        self.config={'schema':1,'toolCommit':'1'*40,'workspace':str(self.root),'state':str(self.state),
            'repositories':{},'database':str(self.root/'unavailable.mv.db'),'h2Jar':str(self.root/'unavailable.jar'),
            'repository':'fixture/launcher','branch':'preview','registry':'ghcr.io/fixture/image','origin':'https://preview.example.invalid','cloudflareAccountId':'a'*32,
            'installation':{'githubOwner':'fixture','cloudflareAccountId':'a'*32,'freePlansAndSpendingBlocksConfirmed':True,'checkedAt':'2000-01-01T00:00:00Z'},
            'service':{**{action:['must-never-run'] for action in ('identity','status','ready','released','start','stop')},'expectedIdentity':'fictional'}}
        for name in ('enois-backend','enois-frontend','enois-design-system'):
            repo=self.root/name;run(['git','init','-q',repo]);(repo/'source').write_text(name)
            run(['git','-C',repo,'add','.']);run(['git','-C',repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'])
            self.config['repositories'][name]=str(repo)
        write(self.home/'config.json',self.config)
        package=self.root/'package';(package/'seed').mkdir(parents=True);(package/'seed/rede.mv.db').write_bytes(b'explicitly simulated sanitized database')
        manifest={'schema':3,'recipe':2,'sanitizerSha256':'f'*64,'accounts':[{'id':'author','email':'author@enois.invalid','label':'Author'}],
                  'permissions':{'author':{'admin':False,'moderator':False}},'externalReads':[],'media':[],'files':inventory(package)}
        manifest['id']=identity(manifest)
        data=self.state/'data'/manifest['id'];shutil.copytree(package,data/'package');write(data/'manifest.json',manifest)
        for scenario in ('one','two'):write(self.state/'scenarios'/f'{scenario}.json',{'data':manifest['id']})
        bare=self.root/'remote.git';seed=self.root/'launcher'
        run(['git','init','--bare','-q',bare]);run(['git','init','-q','-b','preview',seed])
        write(seed/'catalog/scenarios.json',{})
        write(seed/'wrangler.jsonc',{'main':'launcher.mjs','vars':{'GITHUB_REPOSITORY':'fixture/launcher','GITHUB_OWNER':'fixture'}})
        write(seed/'tool.lock.json',{'repository':'renanfranca/enois-preview','commit':'1'*40})
        write(seed/'package.json',{'devDependencies':{'enois-preview':'https://codeload.github.com/renanfranca/enois-preview/tar.gz/'+'1'*40}})
        run(['git','-C',seed,'add','.']);run(['git','-C',seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'])
        run(['git','-C',seed,'remote','add','origin',bare]);run(['git','-C',seed,'push','-q','origin','preview'])
        write(self.root/'platform.json',{'builds':{},'images':{},'deployments':{},'validations':{}})

    def command(self,*args):return [sys.executable,str(DRIVER),str(self.root),'--home',str(self.home),*args]
    def cli(self,*args):return subprocess.run(self.command(*args),capture_output=True,text=True,timeout=30)
    def catalog(self):return json.loads(run(['git','-C',self.root/'remote.git','show','preview:catalog/scenarios.json']))
    def test_simultaneous_identical_cli_publications_converge_to_one_revision_and_artifact(self):
        processes=[subprocess.Popen(self.command('publish','one'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
        reports=[]
        for process in processes:
            stdout,stderr=process.communicate(timeout=30);self.assertEqual(process.returncode,0,stderr);reports.append(json.loads(stdout))
        self.assertEqual(reports[0]['url'],reports[1]['url'])
        self.assertEqual(len(self.catalog()),1)
        state=read(self.root/'platform.json');self.assertEqual(len(state['images']),1)
        self.assertEqual(list(state['builds'].values()),[1]);self.assertEqual(list(state['validations'].values()),[2])
        self.assertEqual(int(run(['git','-C',self.root/'remote.git','rev-list','--count','preview'])),3)

    def test_simultaneous_different_cli_publications_preserve_both_catalog_entries(self):
        processes=[subprocess.Popen(self.command('publish',scenario),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for scenario in ('one','two')]
        for process in processes:
            stdout,stderr=process.communicate(timeout=30);self.assertEqual(process.returncode,0,stderr)
        self.assertEqual(len(self.catalog()),2)
        self.assertEqual(len(read(self.root/'platform.json')['images']),2)

    def test_corrective_executor_resumes_the_original_cli_revision_after_upgrading_the_private_consumer(self):
        old='e958990b0240546b8f03d4d39246cd9959576d0e';new='2'*40
        def consumer_pin(commit,label):
            checkout=self.root/label
            run(['git','clone','-q','--branch','preview',self.root/'remote.git',checkout])
            write(checkout/'tool.lock.json',{'repository':'renanfranca/enois-preview','commit':commit})
            write(checkout/'package.json',{'devDependencies':{'enois-preview':'https://codeload.github.com/renanfranca/enois-preview/tar.gz/'+commit}})
            run(['git','-C',checkout,'add','.']);run(['git','-C',checkout,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Pin reviewed executor'])
            run(['git','-C',checkout,'push','-q','origin','preview'])
        self.config['toolCommit']=old;write(self.home/'config.json',self.config);consumer_pin(old,'old-consumer')
        (self.root/'fail-once').write_text('configuration')
        first=self.cli('publish','one');self.assertEqual(first.returncode,1)
        file=next((self.state/'operations').glob('*/journal.json'));original=read(file)
        self.config['toolCommit']=new;write(self.home/'config.json',self.config);consumer_pin(new,'corrected-consumer')
        for repo in self.config['repositories'].values():shutil.rmtree(repo)
        shutil.rmtree(self.state/'data')
        resumed=self.cli('resume',original['revision']);self.assertEqual(resumed.returncode,0,resumed.stderr)
        report=json.loads(resumed.stdout);final=read(file)
        self.assertEqual(final['inputs'],original['inputs'])
        self.assertEqual(report['revision'],original['revision']);self.assertEqual(report['toolCommit'],old);self.assertEqual(report['executorToolCommit'],new)
        self.assertEqual(len(self.catalog()),1);state=read(self.root/'platform.json')
        self.assertEqual(state['builds'],{original['revision']:1});self.assertEqual(len(state['images']),1)

    def test_cli_resume_reconciles_each_lost_ack_after_live_sources_are_removed(self):
        # Each subcase owns separate fixtures so an earlier recovery cannot mask
        # a later stage. These are platform simulations, not live provider proof.
        for stage in ('registry','configuration','catalog','deployment','beforePublicValidation','publicValidation'):
            with self.subTest(stage=stage):
                other=CliPublicationTests('test_simultaneous_identical_cli_publications_converge_to_one_revision_and_artifact')
                other.setUp()
                try:
                    (other.root/'fail-once').write_text(stage)
                    first=other.cli('publish','one');self.assertEqual(first.returncode,1,first.stdout)
                    journals=list((other.state/'operations').glob('*/journal.json'));self.assertEqual(len(journals),1)
                    journal=read(journals[0]);revision=journal['revision'];self.assertIn('resume '+revision,first.stderr)
                    failure=read(journals[0].parent/'failure.json')
                    confirmed=stage in ('beforePublicValidation','publicValidation')
                    self.assertEqual(failure['publicationLeaseReleased'],confirmed)
                    lease=subprocess.run(['git','-C',str(other.root/'remote.git'),'show-ref','--verify','--quiet','refs/heads/enois-preview-publication-lease'])
                    self.assertEqual(lease.returncode,1 if confirmed else 0)
                    for repo in other.config['repositories'].values():shutil.rmtree(repo)
                    shutil.rmtree(other.state/'data')
                    resumed=other.cli('resume',revision);self.assertEqual(resumed.returncode,0,resumed.stderr)
                    result=json.loads(resumed.stdout);self.assertEqual(result['revision'],revision)
                    state=read(other.root/'platform.json');self.assertEqual(len(state['images']),1)
                    self.assertEqual(state['builds'][revision],1)
                    self.assertEqual(len(other.catalog()),1)
                    self.assertEqual(int(run(['git','-C',other.root/'remote.git','rev-list','--count','preview'])),3)
                finally:other.doCleanups()

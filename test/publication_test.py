"""Behavioral evidence with real Git, service processes, and real H2 where available."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.capture import capture, commits, recover
from preview.config import installed
from preview.state import PreviewError, identity, inventory, read, sha, verify, write

ROOT = Path(__file__).resolve().parents[1]
DRIVERS = sorted((Path.home() / '.m2/repository/com/h2database/h2').glob('*/*.jar'))
H2 = os.environ.get('ENOIS_H2_JAR', str(DRIVERS[-1]) if DRIVERS else '')

class FrozenInputsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'private'
        self.config = {'state': str(self.state), 'repositories': {}}
        for name in ('enois-backend', 'enois-frontend', 'enois-design-system'):
            repo = self.root / name
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', repo], check=True)
            (repo / 'source').write_text(name)
            subprocess.run(['git', '-C', repo, 'add', '.'], check=True)
            subprocess.run(['git', '-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            self.config['repositories'][name] = str(repo)

    def test_every_dirty_source_kind_in_every_application_blocks_before_capture(self):
        for repo in self.config['repositories'].values():
            repo = Path(repo)
            for kind in ('unstaged', 'staged', 'untracked'):
                with self.subTest(repo=repo.name, kind=kind):
                    file = repo / ('new' if kind == 'untracked' else 'source')
                    file.write_text('pending')
                    if kind == 'staged': subprocess.run(['git', '-C', repo, 'add', '.'], check=True)
                    with self.assertRaisesRegex(PreviewError, 'No service was stopped'): commits(self.config)
                    subprocess.run(['git', '-C', repo, 'reset', '--hard', '-q'], check=True)
                    if kind == 'untracked': file.unlink()
        self.assertEqual(len(commits(self.config)), 3)
        self.assertFalse(self.state.exists())

    def test_actual_cli_blocks_each_dirty_application_before_invoking_its_service(self):
        configuration = {**self.config, 'schema':1, 'toolCommit':'1'*40, 'workspace':str(self.root), 'database':str(self.root/'live.mv.db'),
            'h2Jar':str(self.root/'h2.jar'), 'repository':'fixture/launcher', 'registry':'ghcr.io/fixture/image', 'branch':'preview',
            'origin':'https://preview.example.invalid', 'cloudflareAccountId':'a'*32,
            'installation':{'githubOwner':'fixture','cloudflareAccountId':'a'*32,'freePlansAndSpendingBlocksConfirmed':True,'checkedAt':'2000-01-01T00:00:00Z'},
            'service':{**{action:[sys.executable,'-c',"raise RuntimeError('Service must never run')"] for action in ('status','identity','stop','start','ready','released')},'expectedIdentity':'fixture'}}
        home=self.root/'installation'; write(home/'config.json',configuration)
        for repo in self.config['repositories'].values():
            repo=Path(repo)
            for kind in ('staged','unstaged','untracked'):
                with self.subTest(application=repo.name,kind=kind):
                    before=subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'])
                    file=repo/('new' if kind=='untracked' else 'source');file.write_text('pending')
                    if kind=='staged':subprocess.run(['git','-C',repo,'add','.'],check=True)
                    dirty_before=subprocess.check_output(['git','-C',repo,'status','--porcelain=v1','--untracked-files=all'])
                    result=subprocess.run([sys.executable,str(ROOT/'bin/enois-preview'),'--home',str(home),'publish','fixture'],capture_output=True,text=True)
                    self.assertEqual(result.returncode,1)
                    self.assertIn('No service was stopped',result.stderr)
                    self.assertEqual(subprocess.check_output(['git','-C',repo,'rev-parse','HEAD']),before)
                    self.assertEqual(subprocess.check_output(['git','-C',repo,'status','--porcelain=v1','--untracked-files=all']),dirty_before)
                    self.assertFalse((self.state/'restoration.json').exists())
                    self.assertFalse((self.state/'data').exists())
                    subprocess.run(['git','-C',repo,'reset','--hard','-q'],check=True)
                    if kind=='untracked':file.unlink()

    def test_code_only_publication_and_resume_do_not_consult_missing_live_data_or_current_heads(self):
        from preview.publication import publish_revision,resume_revision,verify_journal
        config={**self.config,'database':str(self.root/'unavailable-live.mv.db'),'repository':'fixture/launcher','registry':'ghcr.io/fixture/image','branch':'preview','origin':'https://preview.example.invalid','cloudflareAccountId':'a'*32}
        package=self.root/'prepared';(package/'seed').mkdir(parents=True);(package/'seed/rede.mv.db').write_bytes(b'fictional sanitized fixture')
        manifest={'sanitizerSha256':'f'*64,'schema':3,'accounts':[{'id':'author','email':'author@enois.invalid','label':'Author'}],'media':[],'recipe':1,'files':inventory(package)}
        manifest['id']=identity(manifest)
        destination=self.state/'data'/manifest['id'];shutil.copytree(package,destination/'package');write(destination/'manifest.json',manifest)
        def observed(configuration,journal,data_reused):
            verify_journal(configuration,journal)
            return {'revision':journal['revision'],'inputs':journal['inputs'],'reused':data_reused}
        with patch('preview.publication.capture',return_value=manifest) as snapshots,patch('preview.publication.continue_revision',side_effect=observed):
            first=publish_revision(config,'fixture')
            repo=Path(config['repositories']['enois-frontend']);(repo/'source').write_text('new committed source')
            subprocess.run(['git','-C',repo,'add','.'],check=True)
            subprocess.run(['git','-C',repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','new fixture'],check=True)
            second=publish_revision(config,'fixture')
            self.assertNotEqual(first['revision'],second['revision'])
            self.assertEqual(first['inputs']['data'],second['inputs']['data'])
            self.assertTrue(second['reused']);self.assertEqual(snapshots.call_count,1)
            for path in config['repositories'].values():shutil.rmtree(path)
            shutil.rmtree(self.state/'data')
            resumed=resume_revision(config,first['revision'])
            self.assertEqual(resumed['inputs'],first['inputs'])
            self.assertEqual(snapshots.call_count,1)

    def test_failed_refresh_preserves_scenario_pointer_without_implicit_replacement(self):
        from preview.publication import publish_revision
        config={**self.config,'database':str(self.root/'unavailable.mv.db')}
        manifest={'accounts':[],'files':{},'media':[]}
        manifest['id']=identity(manifest)
        root=self.state/'data'/manifest['id'];(root/'package').mkdir(parents=True);write(root/'manifest.json',manifest)
        pointer=self.state/'scenarios/fixture.json';write(pointer,{'data':manifest['id']});before=pointer.read_bytes()
        with patch('preview.publication.capture',side_effect=PreviewError('Simulated invalid refresh')) as captured:
            with self.assertRaises(PreviewError):publish_revision(config,'fixture',True)
        captured.assert_called_once()
        self.assertEqual(pointer.read_bytes(),before)

    def test_data_manifest_metadata_cannot_change_under_its_existing_identifier(self):
        from preview.publication import verify_data_manifest
        manifest={'schema':3,'files':{},'accounts':[],'media':[],'recipe':1}
        manifest['id']=identity(manifest)
        verify_data_manifest(manifest,manifest['id'])
        manifest['recipe']=2
        with self.assertRaisesRegex(PreviewError,'manifest identity mismatch'):verify_data_manifest(manifest,manifest['id'])

    def test_editing_sources_and_the_mutable_journal_inventory_cannot_bypass_revision_identity(self):
        from preview.publication import verify_journal
        config={**self.config,'repository':'fixture/launcher','registry':'ghcr.io/fixture/image','branch':'preview','origin':'https://preview.example.invalid','cloudflareAccountId':'a'*32}
        prepared=self.root/'prepared';(prepared/'sources').mkdir(parents=True);(prepared/'sources/file').write_text('ORIGINAL')
        (prepared/'data').mkdir();(prepared/'runtime').mkdir();(prepared/'runtime/start').write_text('runtime')
        data={'schema':3,'files':{},'accounts':[],'media':[],'recipe':1};data['id']=identity(data)
        inputs={'data':data['id'],'dataManifest':data,'sourceFiles':inventory(prepared/'sources'),'recipe':{'runtime':inventory(prepared/'runtime')}}
        revision=identity(inputs);directory=self.state/'operations'/revision
        shutil.copytree(prepared,directory/'frozen')
        journal={'revision':revision,'inputs':inputs,'target':{key:config[key] for key in ('repository','registry','branch','origin','cloudflareAccountId')},'frozenFiles':inventory(directory/'frozen')}
        verify_journal(config,journal)
        (directory/'frozen/sources/file').write_text('MODIFIED')
        journal['frozenFiles']=inventory(directory/'frozen')
        with self.assertRaisesRegex(PreviewError,'integrity failure'):verify_journal(config,journal)

    def test_same_size_corruption_and_additional_files_fail_integrity(self):
        root = self.root / 'data'; root.mkdir()
        file = root / 'file'; file.write_bytes(b'AAAA')
        expected = inventory(root)
        file.write_bytes(b'BBBB')
        with self.assertRaisesRegex(PreviewError, 'No live recapture'): verify(root, expected)
        file.write_bytes(b'AAAA'); (root / 'unexpected').write_bytes(b'')
        with self.assertRaises(PreviewError): verify(root, expected)

    def test_symlinks_even_inside_inventory_are_rejected(self):
        root = self.root / 'data'; root.mkdir()
        (root / 'file').write_text('data'); (root / 'alias').symlink_to('file')
        with self.assertRaises(PreviewError): inventory(root)

    def test_installation_does_not_expire_after_thirty_days(self):
        config = {'repository': 'fixture/launcher', 'cloudflareAccountId': 'a'*32,
            'installation': {'githubOwner': 'fixture', 'cloudflareAccountId': 'a'*32,
                'freePlansAndSpendingBlocksConfirmed': True, 'checkedAt': '2000-01-01T00:00:00Z'}}
        installed(config)
        config['cloudflareAccountId'] = 'b'*32
        with self.assertRaises(PreviewError): installed(config)

    def test_private_records_are_atomic_and_restrictive(self):
        file = self.state / 'journal.json'; write(file, {'safe': True})
        self.assertEqual(read(file), {'safe': True})
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(file.parent.stat().st_mode & 0o777, 0o700)

@unittest.skipUnless(H2 and Path(H2).exists(), 'Set ENOIS_H2_JAR to run real H2 lifecycle evidence')
class CaptureLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.database = self.root / 'live.mv.db'
        sql = self.root / 'init.sql'
        sql.write_text("""CREATE TABLE USERS(ID VARCHAR PRIMARY KEY, NAME VARCHAR, EMAIL VARCHAR UNIQUE, IS_ADMIN BOOLEAN, TOTP_ENABLED_AT TIMESTAMP);
CREATE TABLE USER_CREDENTIALS(USER_ID VARCHAR PRIMARY KEY, EMAIL VARCHAR UNIQUE, PASSWORD_HASH VARCHAR, PASSWORD_USABLE BOOLEAN, RESET_NEEDED BOOLEAN);
CREATE TABLE AUTH_SESSIONS(ID VARCHAR, REFRESH_TOKEN VARCHAR);
CREATE TABLE LINKEDIN_CONNECTIONS(USER_ID VARCHAR, ACCESS_TOKEN_ENC VARCHAR);
CREATE TABLE POSTS(ID VARCHAR, AUTHOR_ID VARCHAR, CONTENT VARCHAR);
CREATE TABLE PARENTAL_LINKS(ID VARCHAR, MINOR_USER_ID VARCHAR, GUARDIAN_USER_ID VARCHAR, STATUS VARCHAR, TOKEN_HASH VARCHAR);
INSERT INTO PARENTAL_LINKS VALUES('link','reader','author','ACCEPTED','parental-invitation-marker');
INSERT INTO USERS VALUES('author','Fictional author','original@example.invalid',TRUE,CURRENT_TIMESTAMP),('reader','Fictional reader','reader@example.invalid',FALSE,NULL);
INSERT INTO USER_CREDENTIALS VALUES('author','original@example.invalid','original-credential-marker',TRUE,FALSE),('reader','reader@example.invalid','reader-credential-marker',TRUE,FALSE);
INSERT INTO AUTH_SESSIONS VALUES('original-session','refresh-marker');
INSERT INTO LINKEDIN_CONNECTIONS VALUES('author','integration-marker');
INSERT INTO POSTS VALUES('post','author','fictional preserved content');
""")
        subprocess.run(['java', '-cp', H2, 'org.h2.tools.RunScript', '-url', f'jdbc:h2:file:{self.root}/live;MODE=MySQL', '-user', 'sa', '-script', sql], check=True, capture_output=True)
        self.flag = self.root / 'status'; self.flag.write_text('running')
        self.events = self.root / 'events'
        adapter = self.root / 'service.py'
        adapter.write_text('''import sys
from pathlib import Path
root=Path(sys.argv[1]); action=sys.argv[2]
with (root/'events').open('a') as f: f.write(action+'\\n')
flag=root/'status'
if action=='status': print(flag.read_text())
elif action=='identity': print('fixture-backend')
elif action=='stop': flag.write_text('stopped')
elif action=='start': flag.write_text('running')
elif action=='ready': print('ready' if flag.read_text()=='running' else 'not-ready')
elif action=='released': print('released')
''')
        media = self.root / 'live-media'; media.mkdir(); (media / 'image.bin').write_bytes(b'fictional')
        self.config = {'state': str(self.root / 'private'), 'database': str(self.database), 'h2Jar': H2,
            'accounts': [{'id':'author','email':'author@enois.invalid','label':'Author'}, {'id':'reader','email':'reader@enois.invalid','label':'Reader'}],
            'media':[{'root':str(media),'url':'/fixture/'}],
            'service':{**{action:[sys.executable,str(adapter),str(self.root),action] for action in ('status','identity','stop','start','ready','released')},'expectedIdentity':'fixture-backend','timeout':2}}

    def query(self, database, sql):
        return subprocess.check_output(['java','-cp',H2,'org.h2.tools.Shell','-url',f'jdbc:h2:file:{database};IFEXISTS=TRUE','-user','sa','-sql',sql], text=True)

    def test_capture_restores_running_backend_and_sanitizes_fresh_pages_preserving_relationships(self):
        before = sha(self.database)
        result = capture(self.config)
        self.assertEqual(self.flag.read_text(), 'running')
        self.assertEqual(sha(self.database), before)
        package = Path(self.config['state']) / 'data' / result['id'] / 'package'
        verify(package, result['files'])
        answer = self.query(package / 'seed/rede', 'SELECT ID, IS_ADMIN FROM USERS ORDER BY ID; SELECT * FROM POSTS; SELECT COUNT(*) FROM AUTH_SESSIONS; SELECT COUNT(*) FROM LINKEDIN_CONNECTIONS; SELECT PASSWORD_USABLE FROM USER_CREDENTIALS; SELECT * FROM PARENTAL_LINKS')
        self.assertIn('fictional preserved content', answer)
        self.assertIn('author', answer)
        self.assertIn('FALSE', answer)
        self.assertIn('ACCEPTED', answer)
        self.assertNotIn('parental-invitation-marker', answer)
        self.assertEqual(result['sanitizerSha256'], sha(ROOT/'recipe/SeedTool.java'))
        self.assertEqual(sha(package.parent/'sanitizer.java'), result['sanitizerSha256'])
        seed = (package / 'seed/rede.mv.db').read_bytes()
        for marker in (b'original-credential-marker', b'original-session', b'refresh-marker', b'integration-marker', b'original@example.invalid', b'parental-invitation-marker'):
            self.assertNotIn(marker, seed)
        self.assertFalse((Path(self.config['state']) / 'restoration.json').exists())

    def test_initially_stopped_backend_stays_stopped(self):
        self.flag.write_text('stopped')
        capture(self.config)
        events = self.events.read_text().splitlines()
        self.assertNotIn('stop', events)
        self.assertNotIn('start', events)
        self.assertEqual(self.flag.read_text(), 'stopped')

    def test_copy_failure_restores_backend_and_does_not_promote_data(self):
        self.config['media'][0]['root'] += '-missing'
        with self.assertRaises(PreviewError): capture(self.config)
        self.assertEqual(self.flag.read_text(), 'running')
        self.assertFalse((Path(self.config['state']) / 'data').exists())

    def test_catchable_termination_restores_backend_and_never_selects_incomplete_data(self):
        def terminate(source,destination):
            os.kill(os.getpid(), signal.SIGTERM)
            self.fail('Capture termination handler did not interrupt copying')
        with patch('preview.capture.safe_copy',side_effect=terminate):
            with self.assertRaisesRegex(PreviewError,'interrupted'):capture(self.config)
        self.assertEqual(self.flag.read_text(),'running')
        self.assertFalse((Path(self.config['state'])/'restoration.json').exists())
        self.assertFalse((Path(self.config['state'])/'data').exists())

    def test_actual_open_h2_handle_is_refused_even_when_release_adapter_claims_success(self):
        holder=self.root/'Hold.java'
        holder.write_text('''import java.sql.*;
public class Hold { public static void main(String[] args) throws Exception {
 try(Connection db=DriverManager.getConnection("jdbc:h2:file:"+args[0]+";IFEXISTS=TRUE","sa","")) {
  System.out.println("holding H2"); System.out.flush(); System.in.read();
 }
}}''')
        subprocess.run(['javac','-d',self.root,holder],check=True,capture_output=True)
        child=subprocess.Popen(['java','-cp',f'{self.root}:{H2}','Hold',str(self.root/'live')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            self.assertEqual(child.stdout.readline().strip(),b'holding H2')
            with self.assertRaisesRegex(PreviewError,'H2 is in use'):capture(self.config)
            self.assertEqual(self.flag.read_text(),'running')
            self.assertFalse((Path(self.config['state'])/'data').exists())
        finally:
            child.communicate(input=b'\n',timeout=5)

    def test_missing_refresh_identity_preserves_previous_complete_capture(self):
        previous = capture(self.config)
        self.query(self.root / 'live', "DELETE FROM USER_CREDENTIALS WHERE USER_ID='reader'; DELETE FROM USERS WHERE ID='reader'")
        with self.assertRaises(PreviewError): capture(self.config, previous)
        self.assertEqual(self.flag.read_text(), 'running')
        self.assertEqual(len(list((Path(self.config['state']) / 'data').iterdir())), 1)

    def test_unchanged_explicit_refresh_reuses_the_existing_complete_version(self):
        previous=capture(self.config)
        refreshed=capture(self.config,previous)
        self.assertEqual(refreshed['id'],previous['id'])
        self.assertEqual(len(list((Path(self.config['state'])/'data').iterdir())),1)

    def test_uncatchable_publisher_termination_is_restored_by_next_invocation(self):
        adapter=Path(self.config['service']['released'][1])
        adapter.write_text(adapter.read_text().replace("elif action=='released': print('released')", "elif action=='released':\n import os,time\n (root/'paused').write_text(str(os.getpid()))\n time.sleep(60)\n print('released')"))
        self.config['service']['timeout']=120
        config_file=self.root/'config.json'; write(config_file,self.config)
        child=subprocess.Popen([sys.executable,'-c',"import sys; sys.path.insert(0,sys.argv[1]); from preview.state import read; from preview.capture import capture; capture(read(sys.argv[2]))",str(ROOT),str(config_file)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        helper=None
        try:
            import time
            for attempt in range(100):
                if (self.root/'paused').exists(): break
                time.sleep(.05)
            else: self.fail('Identifiable fixture service was not paused')
            helper=int((self.root/'paused').read_text())
            self.assertEqual(self.flag.read_text(),'stopped')
            child.kill(); child.wait(timeout=5)
            self.assertTrue((Path(self.config['state'])/'restoration.json').exists())
            recover(self.config)
            self.assertEqual(self.flag.read_text(),'running')
            self.assertFalse((Path(self.config['state'])/'restoration.json').exists())
            self.assertFalse((Path(self.config['state'])/'data').exists())
        finally:
            if child.poll() is None: child.kill(); child.wait()
            if helper:
                try: os.kill(helper,signal.SIGTERM)
                except ProcessLookupError: pass

    def test_restoration_failure_stays_durable_until_the_service_can_start_again(self):
        adapter=Path(self.config['service']['start'][1])
        adapter.write_text(adapter.read_text().replace("elif action=='start': flag.write_text('running')", "elif action=='start':\n if (root/'fail-start').exists(): raise SystemExit(1)\n flag.write_text('running')"))
        failure=self.root/'fail-start';failure.touch()
        with self.assertRaises(PreviewError):capture(self.config)
        record=Path(self.config['state'])/'restoration.json'
        self.assertTrue(record.exists());self.assertEqual(self.flag.read_text(),'stopped')
        self.assertFalse((Path(self.config['state'])/'data').exists())
        failure.unlink();recover(self.config)
        self.assertEqual(self.flag.read_text(),'running');self.assertFalse(record.exists())

    def test_release_timeout_restores_running_backend_without_promoting_data(self):
        adapter=Path(self.config['service']['released'][1])
        adapter.write_text(adapter.read_text().replace("elif action=='released': print('released')", "elif action=='released': print('locked')"))
        self.config['service']['timeout']=.3
        with self.assertRaisesRegex(PreviewError,'released'):capture(self.config)
        self.assertEqual(self.flag.read_text(),'running')
        self.assertFalse((Path(self.config['state'])/'data').exists())

    def test_next_invocation_recovers_recorded_running_state(self):
        self.flag.write_text('stopped')
        record = Path(self.config['state']) / 'restoration.json'
        write(record, {'service':self.config['service'],'database':self.config['database'],'running':True})
        recover(self.config)
        self.assertEqual(self.flag.read_text(), 'running')
        self.assertFalse(record.exists())

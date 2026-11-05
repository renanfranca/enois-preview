"""Publisher recovery against a real local Git remote and simulated registry/Cloudflare transports.
These tests do not establish actual GHCR, GitHub API or Cloudflare publication acceptance.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.remote import Publisher
from preview.remote_http import RemoteFailure
from preview.state import PreviewError,canonical,read,run,write

ROOT=Path(__file__).resolve().parents[1]
class GitHubFixture:
    token='fixture-only'
    def __init__(self,bare):self.bare=bare
    def optional(self,path):
        if not path.startswith('git/ref/'):raise AssertionError(path)
        ref='refs/'+path.removeprefix('git/ref/')
        result=subprocess.run(['git','-C',self.bare,'rev-parse','--verify',ref],capture_output=True,text=True)
        return {'object':{'sha':result.stdout.strip()}} if result.returncode==0 else None
    def call(self,path,method='GET',body=None):
        if path.startswith('git/ref/'):
            value=self.optional(path)
            if value is None:raise RemoteFailure(404)
            return value
        if path.startswith('git/commits/'):
            sha=path.removeprefix('git/commits/')
            values=run(['git','-C',self.bare,'show','-s','--format=%T%n%B',sha]).decode().splitlines()
            return {'tree':{'sha':values[0]},'message':'\n'.join(values[1:]).strip()}
        if path=='git/commits':
            sha=run(['git','-C',self.bare,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',body['tree'],'-p',body['parents'][0]],input=body['message'].encode()).decode().strip()
            return {'sha':sha}
        if path=='git/refs':
            try:run(['git','-C',self.bare,'update-ref',body['ref'],body['sha'],''])
            except PreviewError:raise RemoteFailure(422) from None
            return {'object':{'sha':body['sha']}}
        if path.startswith('git/refs/') and method=='DELETE':
            run(['git','-C',self.bare,'update-ref','-d','refs/'+path.removeprefix('git/refs/')]);return None
        raise AssertionError((path,method))

class RemotePublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.bare=self.root/'remote.git';seed=self.root/'seed'
        run(['git','init','--bare','-q',self.bare]);run(['git','init','-q','-b','preview',seed])
        write(seed/'catalog/scenarios.json',{})
        write(seed/'wrangler.jsonc',{'vars':{'GITHUB_REPOSITORY':'fixture/launcher','GITHUB_OWNER':'fixture'}})
        (seed/'src').mkdir();(seed/'src/worker.mjs').write_text('// fixture\n')
        (seed/'scripts').mkdir();(seed/'scripts/check-release.mjs').write_text('// fixture\n')
        run(['git','-C',seed,'add','.']);run(['git','-C',seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'])
        run(['git','-C',seed,'remote','add','origin',self.bare]);run(['git','-C',seed,'push','-q','origin','preview'])
        self.config={'repository':'fixture/launcher','branch':'preview','registry':'ghcr.io/fixture/image','origin':'https://preview.example.invalid','cloudflareAccountId':'a'*32,'leaseWaitSeconds':0}
        self.fail_push=False;self.pushes=0
        self.runner=patch('preview.remote.run',side_effect=self.command);self.runner.start();self.addCleanup(self.runner.stop)
    def command(self,args,**options):
        args=[str(x) for x in args]
        if args[:2]==['git','clone']:args[-2]=str(self.bare)
        if args[0] in ('npm','npx'):return b'[]'
        result=run(args,**options)
        if args[0]=='git' and 'push' in args:
            self.pushes+=1
            if self.fail_push:self.fail_push=False;raise PreviewError('Simulated acknowledgement loss after successful Git push')
        return result
    def publisher(self,letter='a'):
        directory=self.root/letter;directory.mkdir(exist_ok=True)
        frozen=directory/'frozen/src'
        if not frozen.exists():shutil.copytree(ROOT/'src',frozen)
        (directory/'frozen/sources').mkdir(exist_ok=True)
        (directory/'frozen/sources/fixture').write_text('source')
        write(directory/'adjusted-sources.json',{'fixture':{'sha256':'e'*64,'bytes':6}})
        journal={'revision':letter*64,'slug':'fixture-'+letter*16,'operation':letter*32,
            'inputs':{'scenario':'fixture','commits':{},'data':'b'*64,'dataManifest':{'accounts':[{'id':'author','email':'author@enois.invalid','label':'Author'}]}},
            'checkpoints':{'localImage':{'id':'sha256:'+'c'*64},'registry':{'image':'ghcr.io/fixture/image@sha256:'+'d'*64,'evidence':{'designSystemSha256':'e'*64}}},'intents':{}}
        file=directory/'journal.json'
        if file.exists():journal=read(file)
        else:write(file,journal)
        publisher=Publisher(self.config,journal,directory);publisher.github=GitHubFixture(self.bare)
        return publisher
    def test_configuration_push_with_lost_ack_is_reused_without_another_commit(self):
        first=self.publisher();self.fail_push=True
        with self.assertRaises(PreviewError):first.configuration()
        second=self.publisher();second.configuration()
        self.assertEqual(self.pushes,1)
        self.assertIn('configuration',second.journal['checkpoints'])
        self.assertEqual(int(run(['git','-C',self.bare,'rev-list','--count','preview'])),2)
    def test_catalog_push_with_lost_ack_retains_existing_and_other_revisions(self):
        first=self.publisher('a');first.configuration();self.fail_push=True
        with self.assertRaises(PreviewError):first.catalog()
        resumed=self.publisher('a');resumed.catalog()
        other=self.publisher('b');other.configuration();other.catalog()
        catalog=json.loads(run(['git','-C',self.bare,'show','preview:catalog/scenarios.json']))
        self.assertEqual(set(catalog),{'fixture-'+'a'*16,'fixture-'+'b'*16})
        self.assertEqual(self.pushes,4)
    def test_remote_lease_prevents_overlapping_operations_and_releases_only_its_owner(self):
        first,other=self.publisher('a'),self.publisher('b')
        with patch('preview.remote.GitHub',side_effect=lambda repository:GitHubFixture(self.bare)):
            first.acquire_remote_lease()
            with self.assertRaisesRegex(PreviewError,'Another remote publication'):other.acquire_remote_lease()
            first.release_remote_lease();other.acquire_remote_lease();other.release_remote_lease()
        self.assertIsNone(GitHubFixture(self.bare).optional('git/ref/heads/enois-preview-publication-lease'))

    def test_independent_publications_wait_for_the_remote_owner_then_acquire_without_deleting_it(self):
        first,other=self.publisher('a'),self.publisher('b')
        other.config={**other.config,'leaseWaitSeconds':5}
        observed=threading.Event()
        class ObservedGitHub(GitHubFixture):
            def optional(inner,path):
                ref=super().optional(path)
                if ref and path=='git/ref/heads/enois-preview-publication-lease' and threading.current_thread().name.startswith('independent'):
                    observed.set()
                return ref
        with patch('preview.remote.GitHub',side_effect=lambda repository:ObservedGitHub(self.bare)):
            first.acquire_remote_lease()
            with ThreadPoolExecutor(max_workers=1,thread_name_prefix='independent') as executor:
                waiting=executor.submit(other.acquire_remote_lease)
                self.assertTrue(observed.wait(3),'Second publication never observed the first owner')
                self.assertFalse(waiting.done())
                first.release_remote_lease()
                waiting.result(timeout=6)
            other.release_remote_lease()
        self.assertIsNone(GitHubFixture(self.bare).optional('git/ref/heads/enois-preview-publication-lease'))
    def test_registry_acknowledgement_loss_reconciles_exact_digest_without_repush(self):
        publisher=self.publisher();publisher.journal['checkpoints'].pop('registry')
        manifest=b'{"schemaVersion":2,"fixture":true}';digest='sha256:'+hashlib.sha256(manifest).hexdigest()
        remote={'pushed':False,'pushes':0}
        def transport(url,method='GET',body=None,headers=None):
            if '/token?' in url:return 200,{},b'{"token":"fixture"}'
            if not remote['pushed']:raise RemoteFailure(404)
            return 200,{'Docker-Content-Digest':digest},manifest
        def docker(args,**options):
            if args[:2]==['docker','push']:
                remote['pushed']=True;remote['pushes']+=1;raise PreviewError('Simulated push acknowledgement loss')
            if args[:3]==['docker','image','inspect']:return json.dumps([{'Config':{'Labels':{'io.enois.preview.revision':publisher.journal['revision']}}}]).encode()
            return b''
        with patch('preview.remote.request',side_effect=transport),patch('preview.remote.run',side_effect=docker),patch('preview.build.verify_image',return_value={'verified':True}):
            with self.assertRaises(PreviewError):publisher.registry()
            publisher.registry()
        self.assertEqual(remote['pushes'],1)
        self.assertEqual(publisher.journal['checkpoints']['registry']['digest'],digest)
    def test_confirmed_registry_artifact_is_reconciled_by_digest_without_using_its_tag(self):
        publisher=self.publisher();digest='sha256:'+'d'*64
        publisher.journal['checkpoints']['registry']['digest']=digest
        def docker(args,**options):
            if args[:3]==['docker','image','inspect']:return json.dumps([{'Config':{'Labels':{'io.enois.preview.revision':publisher.journal['revision']}}}]).encode()
            self.assertNotEqual(args[:2],['docker','push'])
            return b''
        with patch.object(publisher,'registry_digest',return_value=digest) as queried,patch('preview.remote.run',side_effect=docker),patch('preview.build.verify_image',return_value={'verified':True}):
            publisher.registry()
        queried.assert_called_once_with(digest)

    def test_missing_local_cache_pulls_the_confirmed_immutable_image_without_rebuilding(self):
        publisher=self.publisher();record=publisher.journal['checkpoints']['registry'];record['digest']='sha256:'+'d'*64
        calls=[]
        def docker(args,**options):
            calls.append(args)
            if args[:3]==['docker','image','inspect']:raise PreviewError('Simulated local cache eviction')
            return b''
        with patch('preview.remote.run',side_effect=docker),patch('preview.build.verify_image',return_value={'verified':True}) as verified,patch('preview.build.build') as builder:
            publisher.build_and_validate()
        builder.assert_not_called()
        self.assertEqual(calls[-1],['docker','pull',record['image']])
        self.assertEqual(verified.call_args.args[0],record['image'])

    def test_cloudflare_acknowledgement_loss_reconciles_the_deployed_catalog_before_retry(self):
        publisher=self.publisher();publisher.configuration();publisher.catalog()
        state={'deployed':False,'deploys':0}
        original=self.command
        def commands(args,**options):
            values=[str(x) for x in args]
            if values[:4]==['npx','--no-install','wrangler','deploy']:
                state['deployed']=True;state['deploys']+=1
                raise PreviewError('Simulated deployment acknowledgement loss')
            if values[:5]==['npx','--no-install','wrangler','deployments','list']:
                return json.dumps([{'id':'fixture-deployment','versions':[{'version_id':'fixture-version','percentage':100}],'created_on':'2000-01-01T00:00:00Z','author_email':'private@example.invalid'}]).encode()
            return original(args,**options)
        owner=self
        class SimulatedPublicWorker:
            def __init__(self,*args):pass
            def json(self,path):
                if not state['deployed']:raise PreviewError('Simulated old Worker')
                catalog=json.loads(run(['git','-C',owner.bare,'show','preview:catalog/scenarios.json']))
                return {**catalog[publisher.journal['slug']],'catalogSha256':hashlib.sha256(canonical(catalog)).hexdigest()}
        with patch('preview.remote.run',side_effect=commands),patch('preview.validation.Session',SimulatedPublicWorker):
            with self.assertRaises(PreviewError):publisher.deploy()
            resumed=self.publisher();resumed.deploy()
        self.assertEqual(state['deploys'],1)
        self.assertEqual(resumed.journal['checkpoints']['deployment']['identity']['id'],'fixture-deployment')
        self.assertNotIn('author_email',resumed.journal['checkpoints']['deployment']['identity'])

    def test_ambiguous_registry_outcome_cannot_trigger_a_competing_push(self):
        publisher=self.publisher();publisher.journal['checkpoints'].pop('registry')
        publisher.journal['intents']['registry']={'tag':'preview-'+publisher.journal['revision'],'pushAttempted':True}
        with patch.object(publisher,'registry_digest',return_value=None),patch('preview.remote.run') as commands:
            with self.assertRaisesRegex(PreviewError,'unresolved'):publisher.registry()
            commands.assert_not_called()

    def test_a_catalog_advance_before_deployment_remains_resumable_and_preserves_both_revisions(self):
        publisher=self.publisher('a');publisher.configuration();publisher.catalog()
        other=self.publisher('b');state={'advanced':False,'deploys':0}
        original=self.command
        def commands(args,**options):
            values=[str(x) for x in args]
            if values==['npm','run','check'] and not state['advanced']:
                state['advanced']=True;other.configuration();other.catalog()
                return b''
            if values[:4]==['npx','--no-install','wrangler','deploy']:
                catalog=read(publisher.checkout/'catalog/scenarios.json')
                self.assertEqual(set(catalog),{publisher.journal['slug'],other.journal['slug']})
                state['deploys']+=1;return b'{}'
            if values[:5]==['npx','--no-install','wrangler','deployments','list']:
                return json.dumps([{'id':'current-catalog-deployment','versions':[],'created_on':'2000-01-01T00:00:00Z'}]).encode()
            return original(args,**options)
        class PreviousWorker:
            def __init__(self,*args):pass
            def json(self,path):raise PreviewError('Previous catalog remains deployed')
        with patch('preview.remote.run',side_effect=commands),patch('preview.validation.Session',PreviousWorker):
            with self.assertRaisesRegex(PreviewError,'advanced'):publisher.deploy()
            self.assertFalse(publisher.journal['intents']['deployment'].get('attempted',False))
            self.assertEqual(state['deploys'],0)
            publisher.deploy()
        self.assertEqual(state['deploys'],1)
        self.assertEqual(len(self.catalog_for_assertion()),2)

    def catalog_for_assertion(self):
        return json.loads(run(['git','-C',self.bare,'show','preview:catalog/scenarios.json']))

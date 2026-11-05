"""CLI subprocess harness: real orchestration/Git, explicitly doubled platforms.

Build/runtime/registry/deployment are controlled doubles, not public acceptance.
The production CLI has no fixture switch or transport backdoor.
"""
from pathlib import Path
import sys
import time
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'test'))
from remote_publication_test import GitHubFixture
from preview.cli import main
from preview.remote import Publisher
from preview.state import PreviewError, identity, inventory, read, run, write

fixture=Path(sys.argv[1]); active=None

def platform(): return read(fixture/'platform.json')
def save(value): write(fixture/'platform.json',value)
def fail(stage):
    marker=fixture/'fail-once'
    if marker.exists() and marker.read_text()==stage:
        marker.unlink()
        raise PreviewError('Simulated lost acknowledgement after '+stage)

def command(args,**options):
    args=[str(x) for x in args]
    if any(x.startswith('--force') for x in args): raise AssertionError('Force push forbidden')
    if args[:2]==['git','clone']:args[-2]=str(fixture/'remote.git')
    result=run(args,**options)
    if args[0]=='git' and 'push' in args: fail(active.journal['stage'])
    return result

def build(self):
    global active
    active=self
    self.intent('localImage')
    if self.journal['checkpoints'].get('localImage'):return
    state=platform();state['builds'][self.journal['revision']]=state['builds'].get(self.journal['revision'],0)+1;save(state)
    write(self.directory/'adjusted-sources.json',inventory(self.directory/'frozen/sources'))
    time.sleep(.1)
    self.complete('localImage',{'id':'sha256:'+self.journal['revision'],'transport':'simulated build'})

def registry(self):
    self.intent('registry')
    state=platform();revision=self.journal['revision']
    if revision not in state['images']:
        state['images'][revision]={'image':self.config['registry']+'@sha256:'+revision,'digest':'sha256:'+revision,'evidence':{'transport':'simulated registry'}};save(state)
        fail('registry')
    self.complete('registry',state['images'][revision])

def deploy(self):
    self.intent('deployment')
    state=platform();revision=self.journal['revision']
    if revision not in state['deployments']:
        state['deployments'][revision]={'identity':revision,'transport':'simulated Cloudflare'};save(state)
        fail('deployment')
    self.complete('deployment',state['deployments'][revision])

def validate(self):
    self.intent('publicValidation')
    fail('beforePublicValidation')
    state=platform();revision=self.journal['revision']
    state['validations'][revision]=state['validations'].get(revision,0)+1;save(state)
    fail('publicValidation')
    result={'identityVerified':True,'transport':'simulated public validation'}
    self.complete('publicValidation',result)
    return result

with patch('preview.publication.tool_commit',return_value='1'*40), \
     patch('preview.remote.run',side_effect=command), \
     patch('preview.remote.GitHub',side_effect=lambda repo:GitHubFixture(fixture/'remote.git')), \
     patch.object(Publisher,'build_and_validate',build), \
     patch.object(Publisher,'registry',registry), \
     patch.object(Publisher,'deploy',deploy), \
     patch.object(Publisher,'validate_public',validate):
    raise SystemExit(main(sys.argv[2:]))

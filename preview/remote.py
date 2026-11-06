"""Existing GitHub/GHCR/Cloudflare adapters. Never force push or replace an immutable revision."""
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import urllib.parse
from .remote_http import GitHub, RemoteFailure, request
from .state import PreviewError, canonical, inventory, read, run, sha, verify, write

def deployment_time(value):
    # Python 3.10 accepts only 3 or 6 fractional digits, while RFC 3339 and
    # Cloudflare permit variable precision. Normalize without changing order
    # at the microsecond precision used by Python's datetime.
    match=re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})',value)
    if not match:raise PreviewError('Cloudflare returned an unsupported deployment timestamp; inspect private metadata and resume.')
    fraction=(match[2] or '').ljust(6,'0')[:6]
    return datetime.fromisoformat(match[1]+'.'+fraction+('+00:00' if match[3]=='Z' else match[3]))

class Publisher:
    def __init__(self, config, journal, directory):
        self.config, self.journal, self.directory = config, journal, directory
        self.github = None
        self.checkout = directory / 'launcher'
        self.lease_ref = 'heads/enois-preview-publication-lease'
    def save(self): write(self.directory / 'journal.json', self.journal)
    def intent(self, stage, **details):
        self.journal['stage'] = stage
        self.journal.setdefault('intents', {}).setdefault(stage, details)
        self.save()
        return self.journal['intents'][stage]
    def complete(self, stage, result):
        self.journal['checkpoints'][stage] = result; self.save()
    def build_and_validate(self):
        from .build import build, verify_image, validate_local
        self.intent('localImage')
        recorded = self.journal['checkpoints'].get('localImage')
        if recorded:
            try:
                run(['docker','image','inspect',recorded['id']])
                image = recorded['id']
            except PreviewError:
                remote = self.journal['checkpoints'].get('registry')
                if not remote: raise PreviewError('Validated local image unavailable; restore its recorded artifact or reconcile the registry intent. No rebuild or live recapture was attempted.') from None
                image = remote['image']
                if image != self.config['registry'] + '@' + remote['digest']: raise PreviewError('Recorded registry identity mismatch.')
                run(['docker','pull',image],timeout=1800)
            verify_image(image, self.journal, self.directory)
            return
        result = build(self.config, self.journal, self.directory)
        result['validation'] = validate_local(result['id'], self.journal, self.directory)
        self.complete('localImage', result)
    def acquire_remote_lease(self):
        import time
        self.github = GitHub(self.config['repository'])
        self.intent('remoteLease')
        deadline = time.monotonic() + self.config.get('leaseWaitSeconds', 900)
        while True:
            ref = self.github.optional('git/ref/' + self.lease_ref)
            if ref:
                commit = self.github.call('git/commits/' + ref['object']['sha'])
                if commit['message'] == 'enois-preview lease ' + self.journal['operation']: break
            else:
                base = self.github.call('git/ref/heads/' + self.config['branch'])['object']['sha']
                commit = self.github.call('git/commits/' + base)
                commit = self.github.call('git/commits', 'POST', {'message':'enois-preview lease ' + self.journal['operation'], 'tree':commit['tree']['sha'], 'parents':[base]})
                try:
                    # Lost acknowledgements are reconciled by this operation ID
                    # on resume. Definite competing ref creation may be retried.
                    ref = self.github.call('git/refs', 'POST', {'ref':'refs/' + self.lease_ref, 'sha':commit['sha']})
                    break
                except RemoteFailure as error:
                    if error.status not in (409,422): raise
            if time.monotonic() >= deadline:
                raise PreviewError('Another remote publication still holds the lease. Retry this revision with resume after the owner finishes or reconciles its operation; do not delete an ambiguous lease.')
            time.sleep(min(2,max(.05,deadline-time.monotonic())))
        self.complete('remoteLease', {'commit':ref['object']['sha']})
    def registry_digest(self, tag):
        package = self.config['registry'].removeprefix('ghcr.io/')
        credentials = base64.b64encode(('enois-preview:' + self.github.token).encode()).decode()
        query = urllib.parse.urlencode({'service':'ghcr.io', 'scope':'repository:' + package + ':pull'})
        status, headers, body = request('https://ghcr.io/token?' + query, headers={'Authorization':'Basic ' + credentials})
        token = json.loads(body)['token']
        try:
            status, headers, raw = request(f'https://ghcr.io/v2/{package}/manifests/{tag}', headers={
                'Authorization':'Bearer ' + token, 'Accept':'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'})
        except RemoteFailure as error:
            if error.status == 404: return None
            raise
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        expected = next((value for key,value in headers.items() if key.lower() == 'docker-content-digest'), None)
        if expected != digest: raise PreviewError('Registry manifest digest could not be verified.')
        return digest
    def registry(self):
        from .build import verify_image
        record = self.journal['checkpoints'].get('registry')
        tag = 'preview-' + self.journal['revision']
        intent = self.intent('registry', tag=tag)
        if record:
            digest = record['digest']
            if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest) or record['image'] != self.config['registry'] + '@' + digest:
                raise PreviewError('Recorded registry identity mismatch.')
            if self.registry_digest(digest) != digest: raise PreviewError('Confirmed registry digest unavailable; restore that artifact. The mutable tag is not a replacement.')
        else:
            digest = self.registry_digest(tag)
        if digest is None:
            if record or intent.get('pushAttempted'):
                raise PreviewError('Registry push outcome is unresolved. Inspect the recorded tag; do not push a competing artifact.')
            image_id = self.journal['checkpoints']['localImage']['id']
            destination = self.config['registry'] + ':' + tag
            run(['docker','tag',image_id,destination])
            intent['pushAttempted'] = True; self.save()
            run(['docker','push',destination], timeout=3600)
            digest = self.registry_digest(tag)
            if digest is None: raise PreviewError('Registry did not confirm the pushed artifact.')
        image = self.config['registry'] + '@' + digest
        run(['docker','pull', image], timeout=1800)
        meta = json.loads(run(['docker','image','inspect',image]))[0]
        if meta['Config'].get('Labels', {}).get('io.enois.preview.revision') != self.journal['revision']:
            raise PreviewError('Registry artifact belongs to another revision.')
        evidence = verify_image(image, self.journal, self.directory)
        self.complete('registry', {'image':image,'digest':digest,'evidence':evidence})
    def refresh_checkout(self):
        if self.checkout.exists(): shutil.rmtree(self.checkout)
        run(['git','clone','--single-branch','--branch',self.config['branch'], 'https://github.com/' + self.config['repository'] + '.git',self.checkout])
        run(['git','-C',self.checkout,'config','user.name','enois-preview'])
        run(['git','-C',self.checkout,'config','user.email','preview@enois.invalid'])
        worker = read(self.checkout / 'wrangler.jsonc')
        if worker['vars']['GITHUB_REPOSITORY'] != self.config['repository'] or worker['vars']['GITHUB_OWNER'] != self.config['repository'].split('/')[0]:
            raise PreviewError('Private launcher configuration does not match the installation.')
        public_tool = self.config.get('toolCommit')
        if public_tool:
            lock = read(self.checkout / 'tool.lock.json')
            package = read(self.checkout / 'package.json')
            expected = 'https://codeload.github.com/renanfranca/enois-preview/tar.gz/' + public_tool
            if (lock != {'repository':'renanfranca/enois-preview', 'commit':public_tool}
                or package.get('devDependencies',{}).get('enois-preview') != expected
                or worker['main'] != 'launcher.mjs'):
                raise PreviewError('Private launcher tool pin differs from the current executor. Complete its reviewed tool upgrade before publication or recovery.')
        return run(['git','-C',self.checkout,'rev-parse','HEAD']).decode().strip()
    def commit_push(self, paths, message, stage):
        run(['git','-C',self.checkout,'add','--',*paths])
        run(['git','-C',self.checkout,'commit','-m',message])
        commit = run(['git','-C',self.checkout,'rev-parse','HEAD']).decode().strip()
        intent = self.journal['intents'][stage]
        intent['commit'] = commit; self.save()
        run(['git','-C',self.checkout,'push','origin','HEAD:refs/heads/' + self.config['branch']], log_path=self.directory / (stage + '-push.log'))
        return commit
    def configuration(self):
        stage = 'configuration'
        self.intent(stage)
        self.refresh_checkout()
        slug = self.journal['slug']
        relative = '.devcontainer/' + slug
        proof_path = 'catalog/provenance/' + self.journal['revision'] + '.json'
        proof = {'schema':3, 'revision':self.journal['revision'], 'inputs':self.journal['inputs'],
                 'image':self.journal['checkpoints']['registry']['image'], 'build':self.journal['checkpoints']['registry']['evidence'],
                 'sourceInventory':inventory(self.directory / 'frozen/sources'),
                 'adjustedSourceInventory':read(self.directory / 'adjusted-sources.json')}
        # Local Docker IDs and validation contain no credentials; local paths are excluded from proof.
        proof_bytes = canonical(proof) + b'\n'
        digest = hashlib.sha256(proof_bytes).hexdigest()
        expected = {'repository':self.config['repository'], 'image':self.journal['checkpoints']['registry']['image'],
            'devcontainerPath':relative + '/devcontainer.json', 'provenanceSha256':digest,
            'revision':self.journal['revision'], 'accounts':self.journal['inputs']['dataManifest']['accounts'], 'provenancePath':proof_path}
        if 'upload-transport.mjs' in self.journal['inputs'].get('recipe',{}).get('runtime',{}): expected['uploadTransport'] = True
        existing = self.checkout / relative / 'scenario.json'
        if existing.exists():
            if read(existing) != expected or (self.checkout / proof_path).read_bytes() != proof_bytes:
                raise PreviewError('Immutable configuration collision; previous scenario was preserved.')
            commit = run(['git','-C',self.checkout,'log','-1','--format=%H','--',relative]).decode().strip()
        else:
            directory = self.checkout / relative; directory.mkdir(parents=True)
            origin = self.config['origin'].rstrip('/')
            dev = {'name':'Énóis ' + slug, 'image':expected['image'], 'overrideCommand':True,'remoteUser':'demo','containerUser':'demo',
                'hostRequirements':{'cpus':2,'memory':'4gb','storage':'16gb'},'forwardPorts':[3000],
                'portsAttributes':{'3000':{'label':'Énóis preview','onAutoForward':'silent'}},
                'postStartCommand':['nohup','bash','-c',f'export DEMO_SLUG={slug}; export DEMO_PUBLIC_ORIGIN={shlex.quote(origin)}; export CODESPACE_PORT_FORWARDING_DOMAIN="$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"; /opt/render-demo/start.sh > /tmp/enois-demo.log 2>&1 < /dev/null &']}
            write(directory / 'devcontainer.json',dev); write(existing,expected)
            (self.checkout / proof_path).parent.mkdir(parents=True, exist_ok=True)
            (self.checkout / proof_path).write_bytes(proof_bytes)
            paths = [relative,proof_path]
            if not self.journal['inputs'].get('toolCommit'):
                # Transitional private validation only. Released consumers import
                # the exact public dependency and never maintain a second copy.
                shutil.copytree(self.directory / 'frozen/src', self.checkout / 'src', dirs_exist_ok=True)
                shutil.copyfile(Path(__file__).resolve().parents[1] / 'scripts/check-release.mjs', self.checkout / 'scripts/check-release.mjs')
                paths += ['src','scripts/check-release.mjs']
            commit = self.commit_push(paths, 'feat: retain immutable preview configuration', stage)
        self.complete(stage, {**expected,'commit':commit})
    def catalog(self):
        self.intent('catalog')
        current = self.refresh_checkout()
        file = self.checkout / 'catalog/scenarios.json'
        catalog = read(file)
        expected = dict(self.journal['checkpoints']['configuration'])
        expected['launcherCommit'] = expected.pop('commit')
        slug = self.journal['slug']
        if slug in catalog:
            if catalog[slug] != expected: raise PreviewError('Catalog revision collision; existing entry preserved.')
            commit = current
        else:
            catalog[slug] = expected; write(file, catalog)
            commit = self.commit_push(['catalog/scenarios.json'], 'feat: publish immutable preview catalog entry', 'catalog')
        self.complete('catalog', {'commit':commit})
    def deploy(self):
        from .validation import Session
        self.intent('deployment', tag=self.journal['operation'])
        current = self.refresh_checkout()
        slug = self.journal['slug']
        expected_catalog = read(self.checkout / 'catalog/scenarios.json')
        if expected_catalog.get(slug, {}).get('revision') != self.journal['revision']: raise PreviewError('Current remote catalog lost the recorded revision.')
        env = {**os.environ,'CLOUDFLARE_ACCOUNT_ID':self.config['cloudflareAccountId']}
        run(['npm','ci','--ignore-scripts'],cwd=self.checkout)
        run(['npm','test'],cwd=self.checkout,timeout=1800)
        run(['npm','run','check'],cwd=self.checkout)
        # Query the deployed Worker first after an ambiguous deployment response.
        session = Session(self.config['origin'],slug)
        try: actual = session.json('/__demo/revision')
        except PreviewError: actual = None
        recorded = self.journal['checkpoints'].get('deployment')
        expected_digest = hashlib.sha256(canonical(expected_catalog)).hexdigest()
        matching = actual and actual.get('catalogSha256') == expected_digest and all(actual.get(key) == value for key,value in expected_catalog[slug].items())
        if not matching:
            intent = self.journal['intents']['deployment']
            if intent.get('attempted'):
                raise PreviewError('Deployment outcome unresolved; inspect Cloudflare deployments and resume after reconciliation.')
            if self.github.call('git/ref/heads/' + self.config['branch'])['object']['sha'] != current:
                raise PreviewError('Remote catalog advanced during validation; resume to preserve its additions before deploying.')
            intent['attempted'] = True; self.save()
            output = run(['npx','--no-install','wrangler','deploy','--tag',self.journal['operation'],'--message',f'enois-preview {self.journal["revision"]} catalog {current}','--strict'],cwd=self.checkout,env=env)
        deployments = json.loads(run(['npx','--no-install','wrangler','deployments','list','--json'],cwd=self.checkout,env=env))
        if not deployments: raise PreviewError('Cloudflare did not confirm a deployment identity.')
        # Wrangler's JSON list is oldest first. Select by provider timestamp,
        # independent of ordering, and retain only shareable identity fields.
        latest=max(deployments,key=lambda item:deployment_time(item['created_on']))
        self.complete('deployment', {'catalogCommit':current, 'identity':{key:latest[key] for key in ('id','versions','created_on')}})
    def validate_public(self):
        from .validation import validate
        self.intent('publicValidation')
        result = validate(self.config['origin'], self.journal, evidence=self.directory)
        write(self.directory / 'public-validation.json',result)
        self.complete('publicValidation',result)
        return result
    def release_remote_lease(self):
        self.intent('releaseLease')
        ref = self.github.optional('git/ref/' + self.lease_ref)
        if ref and ref['object']['sha'] == self.journal['checkpoints']['remoteLease']['commit']:
            self.github.call('git/refs/' + self.lease_ref, 'DELETE')
        elif ref: raise PreviewError('Remote lease ownership changed; inspect before another publication.')
        self.complete('releaseLease', {'released':True})

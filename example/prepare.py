#!/usr/bin/env python3
"""Create a separate fictional workspace from pinned public source, never from private captures."""
import json
import os
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, inventory, private_dir, run, write, sha


def prepare(destination):
    root = Path(__file__).resolve().parent
    destination = Path(destination).resolve()
    if destination.exists(): raise PreviewError('Example destination must not exist. Choose a new empty location.')
    destination.mkdir(mode=0o700, parents=True)
    pins = json.loads((root / 'sources.json').read_text())
    for name, source in pins.items():
        run(['git', '-c', 'credential.helper=', 'clone', '--no-checkout', source['url'], destination / name], timeout=1800,
            env={**os.environ, 'GIT_TERMINAL_PROMPT':'0'})
        run(['git', '-C', destination / name, 'checkout', '--detach', source['commit']])
    state = private_dir(destination / '.preview')
    shutil.copytree(root / 'media', destination / 'media')
    backend = destination / 'enois-backend'
    run(['./mvnw','-B','-Dmaven.test.skip=true','package'],cwd=backend,timeout=1800)
    extracted = state / 'backend'
    run(['java','-Djarmode=tools','-jar',backend / 'target/rede-0.0.1-SNAPSHOT.jar','extract','--destination',extracted,'--application-filename','rede.jar'])
    classes = private_dir(state / 'tools')
    classpath = f'{extracted}/lib/*'
    run(['javac','-cp',classpath,'-d',classes,root / 'ExampleSeed.java',root / 'VerifyExample.java'])
    private_dir(state / 'data')
    run(['java','-cp',f'{classes}:{classpath}','ExampleSeed',state / 'data/rede',backend / 'src/main/resources/db/migration',root / 'seed.sql'],timeout=600)
    h2 = next((extracted / 'lib').glob('h2-*.jar'))
    counts = json.loads(run(['java','-cp',f'{classes}:{classpath}','VerifyExample',state / 'data/rede',state / 'canonical-data.txt']))
    service = {'schema':1,'database':str(state / 'data/rede.mv.db'),'jar':str(backend / 'target/rede-0.0.1-SNAPSHOT.jar'),
               'cwd':str(backend),'port':18081,'pidfile':str(state / 'backend.pid'),'log':str(state / 'backend.log'),
               'environmentFile':str(state / 'service-environment.json')}
    import base64, secrets
    write(state / 'service-environment.json', {'REDE_SECURITY_ENCRYPTION_KEY':base64.b64encode(secrets.token_bytes(32)).decode()})
    write(state / 'service.json',service)
    adapter = Path(__file__).resolve().parents[1] / 'preview/service.py'
    service_commands = {action:[sys.executable,str(adapter),str(state / 'service.json'),action] for action in ('identity','status','start','stop','released','ready')}
    service_commands.update({'expectedIdentity':str(state / 'data/rede.mv.db'),'timeout':120})
    configuration = {'schema':1,'workspace':str(destination),'state':str(state / 'publication'),
        'repositories':{name:str(destination / name) for name in pins},'database':str(state / 'data/rede.mv.db'),
        'h2Jar':str(h2),'service':service_commands,'media':[{'root':str(destination / 'media'),'url':'/example.local/'}],
        'accounts':[{'id':'example_lia','email':'lia@enois.invalid','label':'Lia · autora'}, {'id':'example_rui','email':'rui@enois.invalid','label':'Rui · leitor'}],
        'repository':'YOUR_OWNER/YOUR_PRIVATE_LAUNCHER','branch':'YOUR_BRANCH','registry':'ghcr.io/YOUR_OWNER/YOUR_PRIVATE_IMAGE',
        'origin':'https://YOUR_WORKER.workers.dev','cloudflareAccountId':'YOUR_ACCOUNT_ID'}
    write(state / 'config.json',configuration)
    write(destination / 'example-manifest.json',{'sources':pins,'media':inventory(destination / 'media'),
        'observed':counts,'canonicalDataSha256':sha(state / 'canonical-data.txt'),'recipeSha256':__import__('hashlib').sha256((root / 'seed.sql').read_bytes()).hexdigest()})
    print(f'Fictional workspace prepared at {destination}. Configure your existing private infrastructure in .preview/config.json, then run enois-preview setup --config {state / "config.json"}. No preview was published.')

if __name__ == '__main__':
    try:
        if len(sys.argv) != 2: raise PreviewError('Usage: npm run example:prepare -- /ABSOLUTE/NEW_WORKSPACE')
        prepare(sys.argv[1])
    except PreviewError as error:
        print(str(error), file=sys.stderr); raise SystemExit(1)

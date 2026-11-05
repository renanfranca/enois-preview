#!/usr/bin/env python3
"""Probe actual packaged application background boundaries using blocked HTTP."""
import base64
import json
from pathlib import Path
import secrets
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, private_dir, run, write


def check(image, evidence):
    evidence = private_dir(evidence)
    inspect = json.loads(run(['docker', 'image', 'inspect', image]))[0]
    if not inspect.get('Config', {}).get('Labels', {}).get('io.enois.preview.revision'):
        raise PreviewError('Use an identified fictional preview image.')
    container = run(['docker', 'create', '--cpus=2', '--memory=2g',
        '-e', 'DEMO_PUBLIC_ORIGIN=http://localhost:3000',
        '-e', 'REDE_SECURITY_ENCRYPTION_KEY=' + base64.b64encode(secrets.token_bytes(32)).decode(),
        '--entrypoint', 'java', image, '--enable-native-access=ALL-UNNAMED',
        '-XX:ActiveProcessorCount=1', '-Xmx768m', '-cp',
        '/tmp/probe:/opt/render-demo/backend/rede.jar:/opt/render-demo/backend/lib/*', 'IntegrationProbe']).decode().strip()
    try:
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            root = Path(temp)
            run(['docker', 'cp', f'{container}:/opt/render-demo/backend', root/'backend'])
            classpath = str(root/'backend/rede.jar') + ':' + str(root/'backend/lib/*')
            run(['javac', '-cp', classpath, '-d', root/'probe', Path(__file__).with_name('IntegrationProbe.java')],log_path=evidence/'probe-compilation.log')
            run(['docker', 'cp', root/'probe', f'{container}:/tmp/probe'])
            run(['docker', 'start', '-a', container], timeout=300, log_path=evidence/'integration-probe.log')
            if json.loads(run(['docker','inspect',container]))[0]['State']['ExitCode'] != 0:
                raise PreviewError('Packaged integration probe failed; inspect its private log.')
            output=(evidence/'integration-probe.log').read_text()
            proof=json.loads(next(line.removeprefix('INTEGRATION_PROOF=') for line in output.splitlines() if line.startswith('INTEGRATION_PROOF=')))
            proof.update(image=image,actualPackagedApplication=True,localOnly=True,
                transport='JDK HTTP blocked by recording ProxySelector with positive control; external storage beans absent')
            write(evidence/'integration-validation.json',proof)
            print('Packaged integration isolation validated: six scheduled entry points, eligible external asset deletion, absent lazy migration and zero observed blocked HTTP attempts.')
    finally:
        run(['docker', 'rm', '-f', container])


if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('Usage: python3 scripts/validate-integration-isolation.py IMAGE PRIVATE_EVIDENCE_DIRECTORY')
    try: check(sys.argv[1], Path(sys.argv[2]))
    except (PreviewError, StopIteration, ValueError) as error:
        print(str(error) if isinstance(error,PreviewError) else 'Invalid integration probe evidence.',file=sys.stderr)
        raise SystemExit(1)

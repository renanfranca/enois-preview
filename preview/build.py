"""Build exclusively from recorded exports; validate the actual image before registry writes."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from .state import PreviewError, inventory, private_dir, read, run, sha, verify, write


def build(config, journal, directory):
    frozen = directory / 'frozen'
    context = directory / 'build'
    if context.exists(): shutil.rmtree(context)
    shutil.copytree(frozen, context)
    private_dir(context / 'data/media')
    manifest = {'revision':journal['revision'], 'commits':journal['inputs']['commits'],
                'dataVersion':journal['inputs']['data'], 'media':journal['inputs']['dataManifest']['media']}
    write(context / 'runtime-manifest.json', manifest)
    run(['python3', context / 'recipe/prepare.py', context])
    write(directory / 'adjusted-sources.json', inventory(context / 'sources'))
    tag = f'enois-preview:{journal["revision"]}'
    run(['docker', 'build', '--label', f'io.enois.preview.revision={journal["revision"]}',
         '-f', context / 'recipe/Dockerfile', '-t', tag, context], timeout=7200, log_path=directory / 'build.log')
    image_id = json.loads(run(['docker', 'image', 'inspect', tag]))[0]['Id']
    return {'tag':tag, 'id':image_id, **verify_image(image_id, journal, directory)}


def verify_image(image, journal, directory):
    container = run(['docker', 'create', image]).decode().strip()
    try:
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            root = Path(temporary)
            for name in ('seed', 'media', 'provenance'):
                run(['docker', 'cp', f'{container}:/opt/render-demo/{name}', root / name])
            has_notices = 'licenses/opennsfw-onnx.LICENSE' in journal['inputs'].get('recipe',{}).get('recipe',{})
            if has_notices:
                run(['docker','cp',f'{container}:/opt/render-demo/licenses',root/'licenses'])
                for project in ('enois-backend','enois-frontend','enois-design-system'):
                    if sha(root/'licenses'/(project+'.LICENSE')) != sha(directory/'frozen/sources'/project/'LICENSE'):
                        raise PreviewError('Packaged application license differs from its frozen source notice.')
                expected_notices=inventory(directory/'frozen/recipe/licenses')
                for relative,expected_notice in expected_notices.items():
                    file=root/'licenses'/relative
                    if not file.is_file() or sha(file)!=expected_notice['sha256']:raise PreviewError('Model license notice missing from image.')
            expected = journal['inputs']['dataManifest']
            for mapping in expected['media']: verify(root / 'media' / mapping['directory'], mapping['inventory'])
            for relative, file in expected['files'].items():
                if relative.startswith('seed/'):
                    target = root / relative
                    if not target.is_file() or sha(target) != file['sha256']: raise PreviewError('Image seed mismatch.')
            ds = root / 'provenance/design-system.tgz'
            if not ds.is_file() or ds.stat().st_size == 0: raise PreviewError('Fresh design system package missing from image.')
            resolution = read(root / 'provenance/frontend-package-lock.json')
            package = resolution['packages']['node_modules/@rede-enois/design-system']
            dependency = package['resolved']
            expected_version = read(directory / 'frozen/sources/enois-design-system/package.json')['version']
            if package['version'] != expected_version: raise PreviewError('Frontend design system version differs from the captured source commit.')
            if dependency != 'file:../design-system.tgz': raise PreviewError('Frontend did not consume the freshly built design system package.')
            proof = {'seedMediaVerified':True, 'designSystemSha256':sha(ds), 'frontendDependency':dependency, 'designSystemVersion':expected_version, 'frontendResolutionSha256':sha(root / 'provenance/frontend-package-lock.json')}
            if has_notices: proof['licenseNoticesVerified'] = True
            write(directory / 'image-evidence.json', proof)
            return proof
    finally: run(['docker', 'rm', container])


def validate_local(image, journal, directory, exercise=None):
    import secrets
    import base64
    import socket
    from .validation import validate
    # Reserve an available local port, then bind Docker only on loopback.
    with socket.socket() as socket_port:
        socket_port.bind(('127.0.0.1', 0)); port = socket_port.getsockname()[1]
    origin = f'http://localhost:{port}'
    container = run(['docker', 'run', '-d', '--cpus=2', '--memory=2g', '-p', f'127.0.0.1:{port}:3000',
        '-e', f'DEMO_PUBLIC_ORIGIN={origin}', '-e', 'REDE_SECURITY_ENCRYPTION_KEY=' + base64.b64encode(secrets.token_bytes(32)).decode(), image]).decode().strip()
    try:
        import time
        credential_file = directory / 'local-credentials.json'
        for attempt in range(300):
            try:
                run(['docker', 'cp', f'{container}:/tmp/demo-credentials.json', credential_file])
                credential_file.chmod(0o600)
                break
            except PreviewError:
                status = json.loads(run(['docker','inspect',container]))[0]['State']
                if not status['Running']: raise PreviewError('Disposable runtime exited before generating credentials; inspect runtime.log.')
                time.sleep(1)
        else: raise PreviewError('Disposable runtime did not generate credentials.')
        result = validate(origin, journal, read(credential_file), local=True, evidence=directory, alive=lambda: json.loads(run(['docker','inspect',container]))[0]['State']['Running'])
        if exercise:
            result['functionalEvidence'] = exercise(origin, read(credential_file), directory, container)
        write(directory / 'local-validation.json', result)
        return result
    finally:
        try:
            state = json.loads(run(['docker','inspect',container]))[0]['State']
            write(directory / 'runtime-exit.json', {key:state[key] for key in ('Running','ExitCode','OOMKilled','Error')})
            run(['docker','logs',container], log_path=directory / 'runtime.log')
            # JVM crash reports can contain private process details; retain them
            # only beside other mode 0600 diagnostics, before removing runtime.
            import re
            for line in run(['docker','diff',container]).decode().splitlines():
                path = line[2:]
                if re.fullmatch(r'/tmp/hs_err_pid[0-9]+\.log', path):
                    target = directory / Path(path).name
                    run(['docker','cp',f'{container}:{path}',target])
                    target.chmod(0o600)
        finally:
            run(['docker', 'rm', '-f', container])

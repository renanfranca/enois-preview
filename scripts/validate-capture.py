#!/usr/bin/env python3
"""Verify capture with real running Spring/H2 and valid fictional credentials.

This intentionally mutates only a separately prepared fictional data workspace.
It never changes application Git sources or another installation's service.
"""
import base64
import hashlib
from pathlib import Path
import secrets
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.capture import capture, service, wait_service
from preview.exercises import require, denied
from preview.state import PreviewError, private_dir, read, run, write
from preview.validation import Session


def check(workspace):
    workspace = Path(workspace).resolve()
    manifest = read(workspace / 'example-manifest.json')
    require(manifest['observed']['users'] == 4, 'Use a separately prepared fictional workspace')
    config = read(workspace / '.preview/config.json')
    require(Path(config['database']).resolve() == workspace / '.preview/data/rede.mv.db', 'Unexpected fictional database path')
    require(all(a['id'].startswith('example_') for a in config['accounts']), 'Fictional account selection required')
    require(service(config,'status') == 'stopped', 'Choose an initially stopped example; this check changes fictional credentials')
    evidence = private_dir(workspace / '.preview/capture-evidence')
    service_config = read(workspace / '.preview/service.json')
    if not service_config.get('environmentFile'):
        service_config['environmentFile'] = str(workspace / '.preview/service-environment.json')
        write(service_config['environmentFile'], {'REDE_SECURITY_ENCRYPTION_KEY':base64.b64encode(secrets.token_bytes(32)).decode()})
        write(workspace / '.preview/service.json', service_config)
    originals = []
    sql = []
    for name in ('lia','rui','maya','davi'):
        password = secrets.token_urlsafe(24)
        salt = secrets.token_bytes(16)
        encoded = '120000:' + base64.b64encode(salt).decode() + ':' + base64.b64encode(hashlib.pbkdf2_hmac('sha256',password.encode(),salt,120000,32)).decode()
        originals.append({'id':'example_'+name,'email':name+'@enois.invalid','password':password})
        sql.append(f"UPDATE USER_CREDENTIALS SET PASSWORD_HASH='{encoded}', PASSWORD_USABLE=TRUE, RESET_NEEDED=FALSE WHERE USER_ID='example_{name}';")
    sql.append("UPDATE USERS SET IS_ADMIN=TRUE WHERE ID='example_lia';")
    write(evidence / 'original-fictional-credentials.json', {'accounts':originals})
    statements = evidence / 'credentials.sql'
    statements.write_text('\n'.join(sql)); statements.chmod(0o600)
    database = str(Path(config['database']).with_suffix('').with_suffix(''))
    run(['java','-cp',config['h2Jar'],'org.h2.tools.RunScript','-url','jdbc:h2:file:'+database+';MODE=MySQL;IFEXISTS=TRUE','-user','sa','-script',statements])
    service(config,'start')
    clean_config = None
    try:
        wait_service(config,'ready','ready')
        origin = 'http://localhost:' + str(read(workspace / '.preview/service.json')['port'])
        for account in originals:
            login = Session(origin,local=True).json('/api/auth/login',{'email':account['email'],'password':account['password']})
            require(login['user']['id'] == account['id'], 'Original synthetic credential was not a valid login')
        frozen = capture(config)
        require(service(config,'status') == 'running', 'Running Spring backend was not restored before capture returned')
        wait_service(config,'ready','ready')
        for account in originals:
            require(Session(origin,local=True).json('/api/auth/login',{'email':account['email'],'password':account['password']})['user']['id'] == account['id'], 'Original credentials were altered by sanitization')
        require(frozen['permissions']['example_lia']['admin'] is True, 'Captured admin permission was not preserved')
        seed = Path(config['state']) / 'data' / frozen['id'] / 'package/seed/rede.mv.db'
        clean = private_dir(evidence / 'clean-data') / 'rede.mv.db'
        shutil.copyfile(seed,clean)
        adapter = read(workspace / '.preview/service.json')
        adapter.update(database=str(clean),port=18082,pidfile=str(evidence/'clean.pid'),log=str(evidence/'clean.log'))
        write(evidence/'clean-service.json',adapter)
        clean_config = {**config,'database':str(clean),'service':{**config['service'],**{
            action:[sys.executable,str(Path(__file__).resolve().parents[1]/'preview/service.py'),str(evidence/'clean-service.json'),action]
            for action in ('identity','status','start','stop','ready','released')},'expectedIdentity':str(clean)}}
        service(clean_config,'start');wait_service(clean_config,'ready','ready')
        for account in originals:
            session = Session('http://localhost:18082',local=True)
            denied(lambda:session.json('/api/auth/login',{'email':account['email'],'password':account['password']}),401)
        result = {'realSpringAndH2':True,'validOriginalLoginsBeforeCapture':len(originals),
            'backendRestoredHealthyBeforeCaptureReturned':True,'originalLoginsStillValidAfterCapture':len(originals),
            'originalLoginsRejectedInSanitizedCopy401':len(originals),'capturedAdminPermissionPreserved':True,
            'dataVersion':frozen['id'],'sanitizerSha256':frozen['sanitizerSha256'],'localOnly':True}
        write(evidence/'capture-validation.json',result)
        print('Real Spring/H2 capture validated: four valid original logins preserved locally and rejected in sanitized copy; backend restored healthy before capture returned.')
    finally:
        if clean_config: service(clean_config,'stop')
        service(config,'stop')


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Usage: python3 scripts/validate-capture.py SEPARATE_FICTIONAL_WORKSPACE')
    try: check(sys.argv[1])
    except PreviewError as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(1)

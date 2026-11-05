#!/usr/bin/env python3
"""Local fictional acceptance, including restart/recreation; never claims public Worker acceptance."""
import json
from pathlib import Path
import shutil
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.build import validate_local
from preview.validation import Session,validate
from preview.exercises import require,denied,png
from preview.state import PreviewError,read,run,write

if len(sys.argv)!=3:raise SystemExit('Usage: python3 scripts/validate-example.py IMAGE PRIVATE_OPERATION_DIRECTORY')
directory=Path(sys.argv[2]).resolve()
journal=read(directory/'journal.json')

def reset_checks(origin,credentials,evidence,container):
    old=read(evidence/'first-boot-credentials.json')
    for previous,current in zip(old['accounts'],credentials['accounts']):
        require(previous['id']==current['id'] and previous['password']!=current['password'],'Boot did not rotate every selected password')
        session=Session(origin,local=True)
        denied(lambda:session.json('/api/auth/login',{'email':previous['email'],'password':previous['password']}),401)
    flow=read(evidence/'example-flows.json')
    account=credentials['accounts'][0];author=Session(origin,local=True)
    author.json('/api/auth/login',{'email':account['email'],'password':account['password']})
    posts=author.json('/api/feed?tab=ALL&limit=20')['items']
    require(len([item for item in posts if item['id'].startswith('example_post_')])==8,'Seed posts were not restored')
    require(flow['media']['post'] not in [item['id'] for item in posts],'Runtime post survived boot')
    old_url=flow['media']['boundaryUploadUrl'];denied(lambda:author.request(old_url),404)
    raw=png();new=author.json('/api/media/uploads',{'fileName':'new.png','mimeType':'image/png','size':len(raw),'purpose':'POST_IMAGE'})
    author.request(new['uploadUrl'],method='PUT',raw=raw,content_type='image/png')
    require(new['cdnUrl']!=old_url,'New boot reused the previous upload namespace')
    denied(lambda:author.request(old_url),404)
    require(author.request('/example.local/post-1.svg')[0]==200,'Deleted seed media was not restored')
    return {'allPasswordsRotated':True,'oldPasswordsRejected401':True,'seedPostsRestored':True,'runtimePostDiscarded':True,'seedMediaRestored':True,'oldUploadUrlStill404AfterNewUpload':True}


def exercise(origin,credentials,evidence,container):
    root=Path(__file__).resolve().parents[1]
    result=json.loads(run(['node',root/'scripts/validate-example-browser.mjs'],input=json.dumps({
        'origin':origin,'account':credentials['accounts'][0],'evidence':str(evidence)}).encode(),
        log_path=evidence/'example-browser.log',timeout=600))
    write(evidence/'example-browser.json',{'localOnly':True,'devices':result})
    flow=json.loads(run([sys.executable,root/'scripts/validate-flows.py'],input=json.dumps({'origin':origin,'credentials':credentials,'local':True}).encode(),log_path=evidence/'example-flows.log',timeout=600))
    write(evidence/'example-flows.json',flow)
    write(evidence/'first-boot-credentials.json',credentials)
    run(['docker','exec',container,'sh','-c','printf fixture > /tmp/demo-uploads/.processing/orphan.partial'])
    run(['docker','restart',container],timeout=120)
    new_file=evidence/'restart-credentials.json'
    deadline=time.monotonic()+180
    while True:
        try:
            run(['docker','cp',f'{container}:/tmp/demo-credentials.json',new_file]);new_file.chmod(0o600)
            new=read(new_file)
            if all(a['password']!=b['password'] for a,b in zip(credentials['accounts'],new['accounts'])):break
        except (PreviewError,OSError):pass
        if time.monotonic()>deadline:raise PreviewError('Runtime restart did not rotate credentials')
        time.sleep(.2)
    validate(origin,journal,new,local=True,evidence=evidence)
    restarted=reset_checks(origin,new,evidence,container)
    run(['docker','exec',container,'test','!','-e','/tmp/demo-uploads/.processing/orphan.partial'])
    restarted['orphanedProcessingFileRemoved']=True
    write(evidence/'runtime-restart-validation.json',restarted)
    return {'localOnly':True,'devices':result,'flows':flow,'runtimeRestart':restarted}

try:
    first=validate_local(sys.argv[1],journal,directory,exercise=exercise)
    write(directory/'first-boot-validation.json',first)
    second=validate_local(sys.argv[1],journal,directory,exercise=reset_checks)
    write(directory/'recreation-validation.json',second)
    print('Local fictional example validated: profile/feed at 1280 and 390 px mobile emulation, blog, uploads, restart and recreation.')
except PreviewError as error:
    print(str(error),file=sys.stderr);raise SystemExit(1)

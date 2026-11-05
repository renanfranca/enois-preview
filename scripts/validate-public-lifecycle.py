#!/usr/bin/env python3
"""Observe real inactivity deletion and frozen-state recreation without a Codespace terminal."""
from datetime import datetime, timezone
import time
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, private_dir, read, write
from preview.validation import Session, validate
from preview.exercises import require, denied, png


def check(directory):
    directory=Path(directory).resolve();journal=read(directory/'journal.json')
    evidence=private_dir(directory/'public-lifecycle-evidence')
    origin=journal['target']['origin'];slug=journal['slug'];session=Session(origin,slug)
    credentials=session.json('/__demo/access.json');write(evidence/'previous-credentials.json',credentials)
    require(all(a['id'].startswith('example_') for a in credentials['accounts']), 'Fictional identities required')
    flow=read(directory/'public-functional-evidence/validation.json')['flows']
    author=Session(origin,slug);account=credentials['accounts'][0]
    author.json('/api/auth/login',{'email':account['email'],'password':account['password']})
    raw=png();old_asset=author.json('/api/media/uploads',{'fileName':'before-recreation.png','mimeType':'image/png','size':len(raw),'purpose':'POST_IMAGE'})
    author.request(old_asset['uploadUrl'],method='PUT',raw=raw,content_type='image/png')
    old_url=old_asset['cdnUrl']
    require(author.json('/api/feed/posts/'+flow['media']['post'])['id']==flow['media']['post'],'Runtime post did not exist before lifecycle reset')
    require(author.request(old_url)[0]==200,'Runtime upload did not exist before lifecycle reset')
    denied(lambda:author.request('/example.local/post-1.svg'),404)
    samples=[];start=time.monotonic();deadline=start+750;started_at=datetime.now(timezone.utc).isoformat()
    while True:
        try:
            status,mime,raw=session.request('/__demo/status/'+slug)
        except PreviewError as error:
            require('HTTP 410' in str(error),'Inactivity polling failed for an unexpected reason');status=410
        samples.append({'elapsedSeconds':round(time.monotonic()-start,3),'status':status})
        write(evidence/'inactivity-observation.json',{'pollingOnly':True,'recognizedActivitySent':False,'startedAt':started_at,'samples':samples,'complete':status==410})
        if status==410:break
        if time.monotonic()>deadline:raise PreviewError('Public inactivity deletion was not observed; no recreation requested')
        time.sleep(20)
    basic=validate(origin,journal,evidence=evidence)
    current=Session(origin,slug).json('/__demo/access.json');write(evidence/'current-credentials.json',current)
    for old,new in zip(credentials['accounts'],current['accounts']):
        require(old['id']==new['id'] and old['password']!=new['password'],'Recreation did not rotate every selected password')
        independent=Session(origin,slug)
        denied(lambda:independent.json('/api/auth/login',{'email':old['email'],'password':old['password']}),401)
    fresh=Session(origin,slug);new=current['accounts'][0]
    fresh.json('/api/auth/login',{'email':new['email'],'password':new['password']})
    denied(lambda:fresh.json('/api/feed/posts/'+flow['media']['post']),404)
    denied(lambda:fresh.request(old_url),404)
    require(fresh.request('/example.local/post-1.svg')[0]==200,'Seed media was not restored')
    raw=png();asset=fresh.json('/api/media/uploads',{'fileName':'recreated.png','mimeType':'image/png','size':len(raw),'purpose':'POST_IMAGE'})
    fresh.request(asset['uploadUrl'],method='PUT',raw=raw,content_type='image/png')
    require(asset['cdnUrl']!=old_url,'Upload URL namespace reused an old URL')
    denied(lambda:fresh.request(old_url),404)
    proof={'publicWorker':True,'revision':journal['revision'],'pollingDidNotPreventDeletion':True,'observedExpiredBeforeRecreation':True,
           'automaticRecreationValidated':basic,'allPasswordsRotated':True,'oldPasswordsRejected401':True,'runtimePostDiscarded404':True,
           'runtimeUploadDiscarded404':True,'seedMediaRestored':True,'oldUrlStill404AfterNewUpload':True,'samples':samples}
    write(evidence/'validation.json',proof)
    print('Public inactivity and recreation validated: polling allowed deletion, automatic boot restored seed data/media, passwords rotated and old upload URLs remain 404.')


if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: python3 scripts/validate-public-lifecycle.py PRIVATE_OPERATION_DIRECTORY')
    try:check(sys.argv[1])
    except PreviewError as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)

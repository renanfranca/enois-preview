#!/usr/bin/env python3
"""Real disposable HTTP capacity exercise using decodable PCM WAV files.

Use an image for local checks or --public with a private operation directory.
Public checks require a ready, fresh fictional environment. Explicit activity
controls, if used during filling, must be recorded separately from idle tests.
"""
from concurrent.futures import ThreadPoolExecutor
import io
from pathlib import Path
import sys
import threading
import time
import wave
import struct
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview.build import validate_local
from preview.exercises import denied, require
from preview.state import PreviewError, private_dir, read, write
from preview.validation import Session


def wav(output_bytes):
    # Valid PCM with a 78-byte RIFF container: same input and sanitized output
    # byte count. The independent output assertion catches muxer changes.
    payload=bytes(output_bytes-78)
    fmt=b'fmt '+struct.pack('<IHHIIHH',16,1,1,48_000,96_000,2,16)
    metadata=b'LIST'+struct.pack('<I',26)+b'INFOISFT'+struct.pack('<I',14)+b'fictionaltest\0'
    body=b'WAVE'+fmt+metadata+b'data'+struct.pack('<I',len(payload))+payload
    result=b'RIFF'+struct.pack('<I',len(body))+body
    require(len(result)==output_bytes,'WAV input is not the literal requested byte count')
    return result


def exercise(origin, credentials, evidence, container, local=True, slug=None):
    require(all(a['id'].startswith('example_') for a in credentials['accounts']), 'Capacity checks require fictional identities')
    def login(account):
        session = Session(origin, slug, local=local, timeout=120)
        session.json('/api/auth/login', {'email':account['email'], 'password':account['password']})
        return session
    author, reader = [login(account) for account in credentials['accounts'][:2]]
    def allocate(session, count):
        raw = wav(count)
        asset = session.json('/api/media/uploads', {'fileName':'capacity.wav', 'mimeType':'audio/wav', 'size':len(raw), 'purpose':'POST_AUDIO'})
        return asset, raw
    def upload(session, asset, raw, expected):
        session.request(asset['uploadUrl'], method='PUT', raw=raw, content_type='audio/wav')
        status, mime, stored = session.request(asset['cdnUrl'], byte_range='bytes=0-77')
        require(status == 206 and mime.startswith('audio/wav') and len(stored) == 78 and struct.unpack('<I',stored[4:8])[0]+8==expected, 'WAV stored byte count differs from the independent capacity fixture')
        end_status,_,last=session.request(asset['cdnUrl'],byte_range=f'bytes={expected-1}-{expected-1}')
        require(end_status==206 and len(last)==1,'WAV physical last byte does not match the expected size')
        # The application currently maps invalid ranges to its MEDIA_NOT_FOUND
        # response. Prove exact physical extent without reading private counters.
        denied(lambda:session.request(asset['cdnUrl'],byte_range=f'bytes={expected}-{expected}'),404)
        with wave.open(io.BytesIO(stored), 'rb') as decoded:
            require(decoded.getnchannels() == 1 and decoded.getsampwidth() == 2 and decoded.getnframes() * 2 == expected - 78, 'Stored WAV is not the expected decodable PCM')
        return {'id':asset['id'], 'url':asset['cdnUrl'], 'inputBytes':len(raw), 'storedBytes':expected, 'physicalByteRangeBoundaryVerified':True}
    occupied = []
    for count in [20 * 1024 * 1024] * 12 + [14 * 1024 * 1024]:
        asset, raw = allocate(author, count)
        occupied.append(upload(author, asset, raw, count))
        write(evidence / 'capacity-progress.json', {'verifiedStoredBytes':sum(item['storedBytes'] for item in occupied), 'verifiedFiles':len(occupied), 'localOnly':local})
    require(sum(item['storedBytes'] for item in occupied) == 254 * 1024 * 1024, 'Fixture did not leave exactly 2 MiB free')
    attempts = [(session, *allocate(session, 2 * 1024 * 1024)) for session in (author, reader)]
    barrier = threading.Barrier(2)
    def compete(attempt):
        session, asset, raw = attempt
        barrier.wait(timeout=10)
        try:
            proof = upload(session, asset, raw, 2 * 1024 * 1024)
            return {'status':200, **proof}
        except PreviewError as error:
            require('HTTP 507' in str(error), 'Race failed for a condition other than capacity')
            denied(lambda:session.request(asset['cdnUrl']), 404)
            return {'status':507, 'id':asset['id']}
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(compete, attempts))
    require(sorted(item['status'] for item in results) == [200,507], 'Exactly one simultaneous valid upload must fit')
    author.json('/api/media/' + occupied[0]['id'], method='DELETE')
    deadline = time.monotonic() + 30
    while True:
        try:
            author.request(occupied[0]['url'])
        except PreviewError as error:
            require('HTTP 404' in str(error), 'Unexpected physical deletion response')
            break
        if time.monotonic() >= deadline:
            raise PreviewError('Physical deletion did not restore capacity')
        time.sleep(.25)
    replacement, raw = allocate(author, 20 * 1024 * 1024)
    restored = upload(author, replacement, raw, 20 * 1024 * 1024)
    proof = {'localOnly':local, 'publicWorker':not local, 'validWavFiles':True, 'beforeRaceBytes':254 * 1024 * 1024,
             'freeBeforeRaceBytes':2 * 1024 * 1024, 'race':results,
             'physicalDeletionRestoredCapacityBySuccessfulUpload':restored}
    write(evidence / 'capacity-validation.json', proof)
    # Remove only this exercise's assets so later acceptance flows have capacity.
    for item in occupied[1:]:author.json('/api/media/'+item['id'],method='DELETE')
    for attempt,result in zip(attempts,results):
        if result['status']==200:attempt[0].json('/api/media/'+result['id'],method='DELETE')
    author.json('/api/media/'+restored['id'],method='DELETE')
    proof['exerciseAssetDeletionRequestsCompleted']=True
    write(evidence / 'capacity-validation.json', proof)
    return proof


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 scripts/validate-capacity.py IMAGE PRIVATE_OPERATION_DIRECTORY')
    directory = Path(sys.argv[2]).resolve()
    try:
        if sys.argv[1] == '--public':
            import re
            journal=read(directory/'journal.json');origin=journal['target']['origin'];slug=journal['slug']
            evidence=private_dir(directory/'public-capacity-evidence')
            session=Session(origin,slug)
            require(session.json('/__demo/revision').get('revision')==journal['revision'],'Public capacity revision mismatch')
            require(session.json('/__demo/runtime').get('revision')==journal['revision'],'Capacity runtime mismatch')
            require(session.json('/api/actuator/health/readiness').get('status')=='UP','Capacity runtime is not healthy')
            credentials=session.json('/__demo/access.json')
            # Clean the explicitly recorded boundary asset from the preceding
            # example exercise; no seed asset or unrelated visitor file is touched.
            flow=directory/'public-functional-evidence/validation.json'
            if flow.exists():
                old=read(flow)['flows']['media']['boundaryUploadUrl']
                identifier=re.search(r'/(media_[A-Za-z0-9_-]+)/',old).group(1)
                account=credentials['accounts'][0];session=Session(origin,slug)
                session.json('/api/auth/login',{'email':account['email'],'password':account['password']})
                session.json('/api/media/'+identifier,method='DELETE')
                deadline=time.monotonic()+30
                while True:
                    try:session.request(old)
                    except PreviewError as error:
                        require('HTTP 404' in str(error),'Unexpected cleanup response');break
                    if time.monotonic()>deadline:raise PreviewError('Known acceptance upload deletion did not finish')
                    time.sleep(.25)
            exercise(origin,credentials,evidence,None,local=False,slug=slug)
            print('Public HTTP capacity validated with valid PCM WAV: one of two concurrent 2 MiB files fits; physical deletion permits a new 20 MiB upload.')
        else:
            validate_local(sys.argv[1], read(directory / 'journal.json'), private_dir(directory / 'capacity-evidence'), exercise=exercise)
            print('Local HTTP capacity validated with PCM WAV: one of two concurrent 2 MiB files fits, and deletion permits a new 20 MiB upload.')
    except PreviewError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

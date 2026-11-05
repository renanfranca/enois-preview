#!/usr/bin/env python3
"""Public fictional upload MIME/validation exercise; credentials stay private."""
import json
import os
from pathlib import Path
import struct
import sys
import time
import urllib.parse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.exercises import denied, require, png
from preview.state import PreviewError, private_dir, read, run, write
from preview.validation import Session


def pdf():
    objects=[b'<</Type /Catalog /Pages 2 0 R>>',b'<</Type /Pages /Kids [3 0 R] /Count 1>>',b'<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]>>',b'<</Author (private-metadata-marker)>>']
    raw=b'%PDF-1.4\n';offsets=[0]
    for number,obj in enumerate(objects,1):
        offsets.append(len(raw));raw+=str(number).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
    start=len(raw);raw+=b'xref\n0 5\n0000000000 65535 f \n'
    for offset in offsets[1:]:raw+=f'{offset:010d} 00000 n \n'.encode()
    return raw+f'trailer\n<</Size 5 /Root 1 0 R /Info 4 0 R>>\nstartxref\n{start}\n%%EOF\n'.encode()


def fixtures(image, root):
    def ffmpeg(name, source, extra):
        args=['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}','--cpus=2','--memory=512m','-v',str(root)+':/fixtures','--entrypoint','ffmpeg',image,
            '-nostdin','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',source,*extra,'-metadata','comment=private-metadata-marker','/fixtures/'+name]
        run(args,timeout=120,log_path=root/(name+'.generation.log'))
    for name,extra in [('jpeg.jpg',[]),('gif.gif',[]),('webp.webp',[]),('avif.avif',['-c:v','libaom-av1','-cpu-used','8'])]:
        ffmpeg(name,'color=c=green:s=64x64:d=0.1',['-frames:v','1',*extra])
    for name,extra in [('mp4.mp4',['-c:v','libx264','-pix_fmt','yuv420p']),('mov.mov',['-c:v','libx264','-pix_fmt','yuv420p']),('video.webm',['-c:v','libvpx-vp9'])]:
        ffmpeg(name,'color=c=green:s=64x64:r=10:d=0.2',extra)
    for name,extra in [('mp3.mp3',['-c:a','libmp3lame']),('ogg.ogg',['-c:a','libvorbis']),('wav.wav',['-c:a','pcm_s16le']),('audio.weba',['-c:a','libopus','-f','webm'])]:
        ffmpeg(name,'sine=frequency=440:duration=0.2',extra)
    (root/'png.png').write_bytes(png())
    (root/'document.pdf').write_bytes(pdf())


def check(directory):
    directory=Path(directory).resolve();journal=read(directory/'journal.json')
    require(all(a['id'].startswith('example_') for a in journal['inputs']['dataManifest']['accounts']), 'Fictional identities required')
    origin=journal['target']['origin'];slug=journal['slug'];session=Session(origin,slug)
    credentials=session.json('/__demo/access.json');account=credentials['accounts'][0]
    session.json('/api/auth/login',{'email':account['email'],'password':account['password']})
    evidence=private_dir(directory/'media-contract-evidence');generated=private_dir(evidence/'fixtures')
    fixtures(journal['checkpoints']['registry']['image'],generated)
    types={'jpeg.jpg':'image/jpeg','png.png':'image/png','gif.gif':'image/gif','webp.webp':'image/webp','avif.avif':'image/avif',
           'mp4.mp4':'video/mp4','mov.mov':'video/quicktime','video.webm':'video/webm', 'mp3.mp3':'audio/mpeg','ogg.ogg':'audio/ogg','wav.wav':'audio/wav','audio.weba':'audio/webm','document.pdf':'application/pdf'}
    results=[]
    for name,mime in types.items():
        raw=(generated/name).read_bytes()
        asset=session.json('/api/media/uploads',{'fileName':name,'mimeType':mime,'size':len(raw),'purpose':'RESUME' if mime=='application/pdf' else 'POST'})
        session.request(asset['uploadUrl'],method='PUT',raw=raw,content_type=mime)
        status,actual,stored=session.request(asset['cdnUrl'])
        require(status==200 and actual.split(';')[0]==mime and stored, 'Uploaded MIME is not readable with its declared content type')
        require(b'private-metadata-marker' not in stored,'Private metadata survived sanitization')
        target=evidence/('stored-'+name);target.write_bytes(stored);target.chmod(0o600)
        if mime!='application/pdf':
            run(['docker','run','--rm','--user',f'{os.getuid()}:{os.getgid()}','-v',str(evidence)+':/fixtures','--entrypoint','ffmpeg',journal['checkpoints']['registry']['image'],
                 '-nostdin','-hide_banner','-loglevel','error','-xerror','-i','/fixtures/'+target.name,'-f','null','-'],timeout=120,log_path=evidence/(name+'.decoding.log'))
        session.json('/api/media/'+asset['id'],method='DELETE')
        results.append({'mime':mime,'inputBytes':len(raw),'storedBytes':len(stored),'readable':True,'metadataMarkerRemoved':True,'decoded':mime!='application/pdf'})
    def allocate(raw,mime='image/png'):
        return session.json('/api/media/uploads',{'fileName':'invalid.png','mimeType':mime,'size':len(raw),'purpose':'POST'})
    raw=png();body=allocate(raw)
    denied(lambda:session.request(body['uploadUrl'],method='PUT',raw=raw+b'extra',content_type='image/png'),400)
    denied(lambda:session.request(body['cdnUrl']),404)
    short=allocate(raw)
    denied(lambda:session.request(short['uploadUrl'],method='PUT',raw=raw[:-1],content_type='image/png'),400)
    denied(lambda:session.request(short['cdnUrl']),404)
    mismatch=allocate(raw)
    denied(lambda:session.request(mismatch['uploadUrl'],method='PUT',raw=raw,content_type='image/jpeg'),400)
    denied(lambda:session.request(mismatch['cdnUrl']),404)
    unsupported={'fileName':'active.svg','mimeType':'image/svg+xml','size':100,'purpose':'POST'}
    denied(lambda:session.json('/api/media/uploads',unsupported),400)
    for path in ('/api/storage/uploads/%2e%2e/private','/api/storage/%2e%2e/%2e%2e/etc/passwd'):
        try:session.request(path)
        except PreviewError as error:require(any('HTTP '+str(status) in str(error) for status in (400,403,404)), 'Unexpected traversal response')
        else:raise PreviewError('Traversal returned a readable object')
    proof={'publicWorker':True,'revision':journal['revision'],'formats':results,'declaredAndActualSizeMismatchRejected400':True,
           'typeMismatchRejected400':True,'activeSvgUploadRejected400':True,'traversalRefused':True,'failedUploadsUnreadable404':True}
    write(evidence/'validation.json',proof)
    print('Public MIME matrix passed, metadata marker removed, body/type mismatch and traversal refused.')


if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: python3 scripts/validate-media-contracts.py PRIVATE_OPERATION_DIRECTORY')
    try:check(sys.argv[1])
    except PreviewError as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(1)

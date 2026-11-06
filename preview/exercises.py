"""Functional checks limited to the disposable fictional example."""
import json
import re
import struct
import time
import uuid
import zlib
from .validation import Session
from .state import PreviewError, write
from pathlib import Path

def require(condition,message):
    if not condition:raise PreviewError(message)

def denied(action,status):
    try:action()
    except PreviewError as error:
        observed=re.search(r'HTTP \d{3}(?: \([A-Z0-9_]+\))?',str(error))
        require(f'HTTP {status}' in str(error),f'Expected HTTP {status}; observed {observed[0] if observed else "a transport failure without HTTP status"}')
    else:raise PreviewError(f'Expected HTTP {status}, but operation succeeded')

def png(size=None):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    header=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))
    pixels=chunk(b'IDAT',zlib.compress((b'\x00'+b'\x44\x88\x77'*16)*16))
    end=chunk(b'IEND',b'')
    if size:
        count=size-len(header+pixels+end)-12
        pixels=chunk(b'tEXt',b'Comment\0'+b'x'*(count-8))+pixels
    result=header+pixels+end
    if size:require(len(result)==size,'Boundary fixture byte count differs')
    return result

def exercise(settings):
    fixture=uuid.uuid4().hex
    origin=settings['origin'];slug=settings.get('slug');local=settings.get('local',False)
    accounts=settings['credentials']['accounts']
    require(all(account['id'].startswith('example_') for account in accounts),'This exercise requires the fictional example identities')
    require(len(Session(origin,slug,local).json('/__demo/runtime').get('revision',''))==64,'A demo runtime identity is required before functional writes')
    author,reader=Session(origin,slug,local),Session(origin,slug,local)
    for session,account in zip((author,reader),accounts):session.json('/api/auth/login',{'email':account['email'],'password':account['password']})
    saved=author.json('/api/blogs/me',{'title':'Oficina de ideias','description':'Blog fictício de teste','themeHtml':''},method='PUT')
    blog=saved['slug']
    reader.json('/api/blogs/'+blog+'/subscription',{},method='POST')
    article=author.json('/api/blogs/me/posts',{'title':'Uma ideia compartilhada '+fixture[:8],'body':'Aprender e criar em comunidade. Ensaio fictício '+fixture+'.','format':'MARKDOWN'})['id']
    ids=lambda tab:[item['id'] for item in reader.json('/api/feed?tab='+tab+'&limit=20')['items']]
    require(article in ids('FOR_YOU'),'Subscriber did not receive the published article')
    require(article not in ids('ALL'),'Blog article appeared in the ALL tab')
    require('NEW_BLOG_POST' in json.dumps(reader.json('/api/notifications')),'Internal blog notification missing')
    denied(lambda:reader.json('/api/blogs/me/posts/'+article,{'title':'Forbidden','body':'Forbidden','format':'MARKDOWN'},method='PATCH'),403)
    denied(lambda:reader.json('/api/blogs/me/posts/'+article,method='DELETE'),403)
    reader.json('/api/blogs/'+blog+'/subscription',method='DELETE')
    require(article not in ids('FOR_YOU'),'Unsubscribe did not remove the article from the personalized feed')
    denied(lambda:author.json('/api/auth/signup',{}),403)
    blocked_integrations = ['/api/admin/support/github', '/api/admin/support/fictional/reply',
        '/api/identity/verification', '/api/me/github/sync', '/api/admin/github/pulls/review',
        '/api/admin/contributors/sync', '/api/admin/contributors/repositories',
        '/api/me/integrations/linkedin', '/api/webhooks/fictional']
    for path in blocked_integrations:
        denied(lambda path=path:author.json(path,{}),403)
    permissions=author.json('/api/moderation/me')
    blog_proof={'id':article,'positivePersonalizedFeed':True,'absentFromAll':True,'notification':True,'ownership':True,'unsubscribe':True}
    if settings.get('evidence'):write(Path(settings['evidence'])/'blog-validation.json',{'origin':origin,'publicWorker':not local,**blog_proof})

    def allocate(raw,mime='image/png'):
        return author.json('/api/media/uploads',{'fileName':'example.png','mimeType':mime,'size':len(raw),'purpose':'POST_IMAGE'})
    raw=png();upload=allocate(raw)
    denied(lambda:reader.request(upload['uploadUrl'],method='PUT',raw=raw,content_type='image/png'),403)
    denied(lambda:reader.json('/api/media/'+upload['id'],method='DELETE'),403)
    author.request(upload['uploadUrl'],method='PUT',raw=raw,content_type='image/png')
    status,mime,stored=author.request(upload['cdnUrl'])
    require(status==200 and mime.startswith('image/png') and stored.startswith(b'\x89PNG'),'Public disposable media read failed')
    post=author.json('/api/feed/posts',{'type':'INSIGHT','content':'Uma imagem para compartilhar. Ensaio fictício '+fixture+'.','topic':'TECNOLOGIA','mediaIds':[upload['id']]})['id']
    published=author.json('/api/feed/posts/'+post)
    require(published.get('id')==post and upload['id'] in json.dumps(published),'Uploaded media was not attached to a persisted post')
    author.json('/api/media/'+upload['id'],method='DELETE')
    deadline=time.monotonic()+20
    while True:
        try:author.request(upload['cdnUrl'])
        except PreviewError as error:
            require('HTTP 404' in str(error),'Unexpected deletion response');break
        if time.monotonic()>deadline:raise PreviewError('Physical media deletion was not observed')
        time.sleep(.25)
    invalid=allocate(b'not-an-image')
    denied(lambda:author.request(invalid['uploadUrl'],method='PUT',raw=b'not-an-image',content_type='image/png'),422)
    denied(lambda:author.request(invalid['cdnUrl']),404)
    if settings.get('evidence'):write(Path(settings['evidence'])/'basic-upload-validation.json',{'origin':origin,'publicWorker':not local,'post':post,'ownerUploadReadAttachDelete':True,'foreignWriteDeleteRejected':True,'malformedRejected':True})
    big=png(20_971_520);boundary=allocate(big)
    author.request(boundary['uploadUrl'],method='PUT',raw=big,content_type='image/png')
    boundary_status,boundary_mime,boundary_bytes=author.request(boundary['cdnUrl'])
    require(boundary_status==200 and boundary_bytes==png(),'Exact 20 MiB file did not retain valid pixels and remove text metadata')
    denied(lambda:author.json('/api/media/uploads',{'fileName':'large.png','mimeType':'image/png','size':20_971_521,'purpose':'POST_IMAGE'}),400)
    author.json('/api/media/example_media_1',method='DELETE')
    deadline=time.monotonic()+20
    while True:
        try:author.request('/example.local/post-1.svg')
        except PreviewError as error:
            require('HTTP 404' in str(error),'Unexpected seed deletion response');break
        if time.monotonic()>deadline:raise PreviewError('Disposable seed media deletion was not observed')
        time.sleep(.25)
    return {'origin':origin,'localOnly':local,'blog':blog_proof,
            'media':{'newUploadUrl':upload['cdnUrl'],'post':post,'ownerUploadReadAttachDelete':True,'foreignWriteDeleteRejected':True,'malformedRejected':True,
                     'boundaryUploadUrl':boundary['cdnUrl'],'boundaryInputBytes':len(big),'boundaryStoredBytes':len(boundary_bytes),'exact20MiBAccepted':True,'oneByteLargerRejected':True,'seedDeletionObserved':True},'signupBlocked':True,
            'externalIntegrationEndpoints':{'actorAdmin':permissions.get('admin') is True,'refused403':blocked_integrations}}

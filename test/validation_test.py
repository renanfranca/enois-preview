"""Independent negative checks for the public validation gate, using explicitly simulated transport."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError
from preview.validation import validate, external_read, Session

class CapacityTransportTests(unittest.TestCase):
    def test_http_failure_reports_safe_status_and_kind_without_response_secrets(self):
        import io
        from email.message import Message
        from urllib.error import HTTPError
        headers=Message()
        headers['Content-Type']='text/html; private=private-header-marker'
        headers['WWW-Authenticate']='Tunnel realm="private-realm-marker"'
        failure=HTTPError('http://localhost/private',401,'private-reason-marker',headers,io.BytesIO(b'private-body-marker'))
        session=Session('http://localhost',local=True)
        with patch.object(session.opener,'open',side_effect=failure):
            with self.assertRaises(PreviewError) as observed:
                session.request('/private?token=private-query-marker')
        message=str(observed.exception)
        self.assertIn('HTTP 401 [html; tunnel challenge]',message)
        self.assertNotIn('private-',message)

    def test_range_evidence_exposes_physical_extent_without_cookies(self):
        import http.server
        import threading
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.server.observed_range=self.headers.get('Range')
                self.send_response(206)
                self.send_header('Content-Type','audio/wav')
                self.send_header('Content-Range','bytes 0-3/20971520')
                self.send_header('Content-Length','4')
                self.send_header('Set-Cookie','fixture=private; HttpOnly')
                self.end_headers(); self.wfile.write(b'RIFF')
            def log_message(self,*args): pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever);thread.start()
        try:
            headers={}
            status,mime,body=Session('http://127.0.0.1:'+str(server.server_port),local=True).request(
                '/fixture.wav',byte_range='bytes=0-3',response_headers=headers)
            self.assertEqual((status,mime,body),(206,'audio/wav',b'RIFF'))
            self.assertEqual(server.observed_range,'bytes=0-3')
            self.assertEqual(headers,{'content-range':'bytes 0-3/20971520','content-length':'4'})
        finally: server.shutdown();server.server_close();thread.join()

class Cookie:
    def __init__(self,name):self.name=name;self.secure=True
    def has_nonstandard_attr(self,name):return name=='HttpOnly'

class ValidationGateTests(unittest.TestCase):
    def setUp(self):
        self.failure=None
        self.raw=b'DATA'
        self.mime='application/octet-stream'
        self.journal={'slug':'fixture-abc','revision':'a'*64,'inputs':{'data':'b'*64,'commits':{'enois-backend':'c'*40},'dataManifest':{
            'accounts':[{'id':'author','email':'author@enois.invalid','label':'Author'},{'id':'reader','email':'reader@enois.invalid','label':'Reader'}],
            'permissions':{'author':{'admin':True,'moderator':False},'reader':{'admin':False,'moderator':False}}, 'externalReads':[],
            'media':[{'url':'/fixture/','inventory':{'image.bin':{'bytes':4,'sha256':hashlib.sha256(b'DATA').hexdigest()}}}]}},
            'checkpoints':{'registry':{'image':'ghcr.io/fixture/image@sha256:'+'d'*64},'configuration':{'commit':'e'*40,'provenanceSha256':'f'*64}}}
        owner=self
        class SimulatedSession:
            def __init__(self,*args):self.cookies=[Cookie('enois_session'),Cookie('enois_refresh')];self.user=None
            def request(self,path,body=None):
                if path.startswith('/preview/'):
                    if owner.failure=='boot':raise PreviewError('Simulated boot refusal')
                    return 200,'text/html',b'Entry'
                return 200,owner.mime,b'FAIL' if owner.failure=='media' else owner.raw
            def json(self,path,body=None):
                j=owner.journal
                if path=='/__demo/revision':return {'revision':j['revision'],'image':j['checkpoints']['registry']['image'],'launcherCommit':j['checkpoints']['configuration']['commit'],'provenanceSha256':'0'*64 if owner.failure=='configuration' else j['checkpoints']['configuration']['provenanceSha256']}
                if path=='/__demo/runtime':return {'revision':'0'*64 if owner.failure=='runtime' else j['revision'],'dataVersion':j['inputs']['data'],'commits':j['inputs']['commits']}
                if path=='/api/actuator/health/readiness':
                    if owner.failure=='html':raise PreviewError('Simulated HTML 200 is not readiness')
                    return {'status':'DOWN' if owner.failure=='health' else 'UP'}
                if path=='/__demo/access.json':return {'accounts':[{**a,'password':'fixture-only'} for a in j['inputs']['dataManifest']['accounts']]}
                if path=='/api/auth/login':
                    self.user=body['email'].split('@')[0]
                    if owner.failure=='reader' and self.user=='reader':raise PreviewError('Simulated reader authentication failure')
                    return {'user':{'id':'other' if owner.failure=='identity' else self.user}}
                if path=='/api/me':return {'id':self.user}
                if path=='/api/moderation/me':return {**j['inputs']['dataManifest']['permissions'][self.user], 'admin':False if owner.failure=='permissions' else self.user=='author'}
                raise AssertionError(path)
        self.sessions=patch('preview.validation.Session',SimulatedSession);self.sessions.start();self.addCleanup(self.sessions.stop)
    def test_every_required_check_can_independently_prevent_success(self):
        for failure in ('boot','configuration','runtime','html','health','reader','identity','permissions','media'):
            self.failure=failure
            with self.subTest(failure=failure),patch('preview.validation.decode_images') as browser:
                with self.assertRaises(PreviewError):validate('https://preview.example.invalid',self.journal)
                browser.assert_not_called()
    def test_positive_simulation_requires_all_accounts_and_records_only_safe_metadata(self):
        with patch('preview.validation.decode_images',return_value=[{'width':1280,'images':[]},{'width':390,'images':[]}]):
            result=validate('https://preview.example.invalid',self.journal)
        self.assertEqual([x['id'] for x in result['accounts']],['author','reader'])
        serialized=json.dumps(result)
        self.assertNotIn('fixture-only',serialized)
        self.assertNotIn('password',serialized)
        self.assertTrue(result['identityVerified'])
    def test_image_decoding_failure_prevents_success_after_http_and_hash_checks(self):
        with patch('preview.validation.decode_images',side_effect=PreviewError('Simulated image decoding failure')):
            with self.assertRaisesRegex(PreviewError,'decoding'):validate('https://preview.example.invalid',self.journal)

    def test_external_references_are_excluded_and_private_addresses_or_credentials_are_not_requested(self):
        for url in ('http://127.0.0.1/private', 'https://user:original-secret@fixture.invalid/path?token=private-marker', 'https://[invalid'):
            with self.subTest(url=url),patch('preview.validation.urllib.request.build_opener') as network:
                result=external_read(url)
                self.assertTrue(result['excludedFromFrozenMediaGuarantee'])
                self.assertIn('not requested',result['result'])
                self.assertNotIn('original-secret',json.dumps(result))
                self.assertNotIn('private-marker',json.dumps(result))
                network.assert_not_called()

    def test_avif_with_matching_inventory_cannot_bypass_validation_with_incorrect_mime(self):
        self.raw=(Path(__file__).parent/'fixtures/images/valid.avif').read_bytes()
        self.journal['inputs']['dataManifest']['media'][0]['inventory']['image.bin']={'bytes':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest()}
        for mime in ('application/octet-stream','image/png'):
            self.mime=mime
            with self.subTest(mime=mime),patch('preview.validation.decode_images') as browser:
                with self.assertRaisesRegex(PreviewError,'MIME.*image/avif'):validate('https://preview.example.invalid',self.journal)
                browser.assert_not_called()

    def test_valid_avif_is_decoded_in_real_chromium_and_mime_parameters_are_normalized(self):
        self.raw=(Path(__file__).parent/'fixtures/images/valid.avif').read_bytes()
        self.mime='IMAGE/AVIF; fixture=1'
        self.journal['inputs']['dataManifest']['media'][0]['inventory']['image.bin']={'bytes':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest()}
        with self.image_origin(self.raw,'image/avif') as origin:
            result=validate(origin,self.journal,local=True)
        self.assertEqual(result['media'][0]['expectedContentType'],'image/avif')
        self.assertEqual(result['imageDecoding'],[{'width':width,'mobileEmulation':width==390,'images':[{'path':'/fixture/image.bin','width':64,'height':64}]} for width in (1280,390)])

    def test_invalid_recognized_image_with_matching_hash_and_mime_fails_real_chromium(self):
        self.raw=b'\x89PNG\r\n\x1a\ninvalid image body'
        self.mime='image/png'
        self.journal['inputs']['dataManifest']['media'][0]['inventory']['image.bin']={'bytes':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest()}
        with self.image_origin(self.raw,self.mime) as origin:
            with self.assertRaisesRegex(PreviewError,'image decoding failed'):validate(origin,self.journal,local=True)

    def test_unclassified_short_empty_and_binary_files_are_reported_without_decoded_images(self):
        for raw in (b'',b'GI',b'BINARY<svg >'):
            self.raw=raw
            self.journal['inputs']['dataManifest']['media'][0]['inventory']['image.bin']={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            with self.subTest(raw=raw),self.image_origin(raw,self.mime) as origin:
                result=validate(origin,self.journal,local=True)
                self.assertEqual(result['media'][0]['imageClassification'],'unclassified')
                self.assertEqual(result['media'][0]['sha256'],hashlib.sha256(raw).hexdigest())
                self.assertEqual([row['images'] for row in result['imageDecoding']],[[],[]])

    def test_incomplete_duplicate_or_unrelated_decoding_evidence_is_rejected(self):
        self.raw=(Path(__file__).parent/'fixtures/images/valid.avif').read_bytes();self.mime='image/avif'
        self.journal['inputs']['dataManifest']['media'][0]['inventory']['image.bin']={'bytes':len(self.raw),'sha256':hashlib.sha256(self.raw).hexdigest()}
        image={'path':'/fixture/image.bin','width':64,'height':64}
        for rows in ([],[{'width':1280,'images':[image]}],
                     [{'width':width,'images':images} for width,images in ((1280,[image]),(390,[]))],
                     [{'width':width,'images':[image,image]} for width in (1280,390)],
                     [{'width':width,'images':[{**image,'path':'/other'}]} for width in (1280,390)]):
            with self.subTest(rows=rows),patch('preview.validation.decode_images',return_value=rows):
                with self.assertRaisesRegex(PreviewError,'evidence'):validate('https://preview.example.invalid',self.journal)

    @contextmanager
    def image_origin(self,raw,mime):
        import http.server
        import threading
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body=raw if self.path=='/fixture/image.bin' else b'{}'
                self.send_response(200);self.send_header('Content-Type',mime if self.path=='/fixture/image.bin' else 'application/json')
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever);thread.start()
        try:yield 'http://127.0.0.1:'+str(server.server_port)
        finally:server.shutdown();server.server_close();thread.join()

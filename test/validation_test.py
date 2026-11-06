"""Independent negative checks for the public validation gate, using explicitly simulated transport."""
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
                return 200,'application/octet-stream',b'FAIL' if owner.failure=='media' else b'DATA'
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
            with self.subTest(failure=failure),patch('preview.validation.run') as browser:
                with self.assertRaises(PreviewError):validate('https://preview.example.invalid',self.journal)
                browser.assert_not_called()
    def test_positive_simulation_requires_all_accounts_and_records_only_safe_metadata(self):
        with patch('preview.validation.run',return_value=b'[]'):
            result=validate('https://preview.example.invalid',self.journal)
        self.assertEqual([x['id'] for x in result['accounts']],['author','reader'])
        serialized=json.dumps(result)
        self.assertNotIn('fixture-only',serialized)
        self.assertNotIn('password',serialized)
        self.assertTrue(result['identityVerified'])
    def test_image_decoding_failure_prevents_success_after_http_and_hash_checks(self):
        with patch('preview.validation.run',side_effect=PreviewError('Simulated image decoding failure')):
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

"""Validate the application through its public origin without persisting credentials or cookies."""
import hashlib
import http.cookiejar
import json
import re
import uuid
from pathlib import Path
import time
import urllib.request
import urllib.parse
import urllib.error
from .state import PreviewError, run
from .remote_http import NoRedirect

class Session:
    def __init__(self, origin, slug=None, local=False, timeout=30):
        self.origin = origin.rstrip('/')
        policy = http.cookiejar.DefaultCookiePolicy(secure_protocols=('https', 'http') if local else ('https',))
        self.cookies = http.cookiejar.CookieJar(policy)
        self.opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(self.cookies))
        self.slug = slug
        self.timeout = timeout
    def request(self, path, body=None, method=None, raw=None, content_type=None, byte_range=None, response_headers=None):
        headers = {'User-Agent':'enois-preview/0.1.0', 'Origin':self.origin, 'X-Client-Origin':self.origin, 'X-CSRF-Protection':'1', 'Sec-Fetch-Site':'same-origin'}
        if self.slug: headers['Cookie'] = '__Host-demo-scenario=' + self.slug + ('; ' + '; '.join(f'{c.name}={c.value}' for c in self.cookies) if self.cookies else '')
        method = method or ('POST' if body is not None or raw is not None else 'GET')
        if method not in ('GET','HEAD'): headers['Idempotency-Key'] = uuid.uuid4().hex
        if body is not None: headers['Content-Type'] = 'application/json'
        if content_type: headers['Content-Type'] = content_type
        if byte_range is not None: headers['Range'] = byte_range
        request = urllib.request.Request(self.origin + path, data=raw if raw is not None else json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if response_headers is not None:
                    response_headers.update({key:response.headers[key] for key in ('content-range','content-length') if key in response.headers})
                return response.status, response.headers.get('Content-Type', ''), response.read()
        except urllib.error.HTTPError as error:
            code = ''
            try:
                candidate = json.loads(error.read()).get('code', '')
                if isinstance(candidate,str) and re.fullmatch(r'[A-Z0-9_]{1,80}',candidate): code = ' (' + candidate + ')'
            except (ValueError,UnicodeError,AttributeError): pass
            raise PreviewError(f'Validation {method} {path.split("?",1)[0]} failed for HTTP {error.code}{code}; credentials and response were omitted.') from None
        except (OSError, urllib.error.URLError) as error:
            raise PreviewError(f'Validation {method} {path.split("?",1)[0]} did not respond through its origin ({type(error).__name__}).') from error
    def json(self, path, body=None, method=None):
        status, mime, raw = self.request(path, body, method=method)
        if not re.fullmatch(r'application/(?:json|[\w.+-]+\+json)(?:\s*;.*)?', mime, re.IGNORECASE): raise PreviewError('Application returned a non-JSON response; HTTP 200 alone is not readiness.')
        try: return json.loads(raw)
        except ValueError: raise PreviewError('Application returned malformed JSON.') from None


def validate(origin, journal, credentials=None, local=False, timeout=600, evidence=None, alive=None):
    started = time.monotonic()
    slug = None if local else journal['slug']
    session = Session(origin, slug, local)
    deadline = time.monotonic() + timeout
    # The initial GET is the only launch. Subsequent polling cannot renew or recreate the environment.
    if not local:
        status, mime, body = session.request('/preview/' + slug)
        while status == 202:
            if time.monotonic() >= deadline: raise PreviewError('Public boot timed out; resume this revision.')
            time.sleep(2)
            status, mime, body = session.request('/__demo/status/' + slug)
        if status != 200: raise PreviewError('Public boot did not become ready.')
        actual = session.json('/__demo/revision')
        expected = journal['checkpoints']['configuration']
        for key, value in {'revision':journal['revision'], 'image':journal['checkpoints']['registry']['image'],
                           'launcherCommit':expected['commit'], 'provenanceSha256':expected['provenanceSha256']}.items():
            if actual.get(key) != value: raise PreviewError('Public configuration identity mismatch.')
    else:
        while True:
            try:
                if session.json('/api/actuator/health/readiness').get('status') == 'UP': break
            except PreviewError: pass
            if alive and not alive(): raise PreviewError('Local runtime exited before readiness; inspect private runtime.log.')
            if time.monotonic() >= deadline: raise PreviewError('Local image readiness timed out.')
            time.sleep(1)
    if session.json('/api/actuator/health/readiness').get('status') != 'UP': raise PreviewError('Readiness is not UP.')
    runtime = session.json('/__demo/runtime')
    if runtime.get('revision') != journal['revision'] or runtime.get('dataVersion') != journal['inputs']['data'] or runtime.get('commits') != journal['inputs']['commits']:
        raise PreviewError('Running image input identity mismatch.')
    credentials = credentials or session.json('/__demo/access.json')
    accounts = credentials.get('accounts', [])
    selected = journal['inputs']['dataManifest']['accounts']
    if len(accounts) != len(selected): raise PreviewError('Selected account count mismatch.')
    account_results = []
    permissions = journal['inputs']['dataManifest'].get('permissions', {})
    if set(permissions) != {a['id'] for a in selected}:
        raise PreviewError('Frozen selected permission expectations are missing. Preserve this prototype and capture a new revision explicitly with --refresh-data.')
    for expected, account in zip(selected, accounts):
        if any(account.get(key) != expected[key] for key in ('id','email','label')): raise PreviewError('Demo account mapping mismatch.')
        independent = Session(origin, slug, local)
        login = independent.json('/api/auth/login', {'email':account['email'], 'password':account['password']})
        if login.get('user', {}).get('id') != expected['id']: raise PreviewError('Authenticated account identity mismatch.')
        me = independent.json('/api/me')
        if me.get('id') != expected['id']: raise PreviewError('Authenticated profile identity mismatch.')
        capabilities = independent.json('/api/moderation/me')
        expected_permissions = permissions[expected['id']]
        if any(capabilities.get(key) is not value for key,value in expected_permissions.items()):
            raise PreviewError('Authenticated permissions differ from the frozen selected identity.')
        required = {'enois_session', 'enois_refresh'}
        actual_cookies = {cookie.name for cookie in independent.cookies if cookie.secure and cookie.has_nonstandard_attr('HttpOnly')}
        if not required.issubset(actual_cookies): raise PreviewError('Secure HttpOnly session cookies missing.')
        account_results.append({'id':expected['id'], 'authenticated':True, 'permissions':expected_permissions})
    checked = []
    for mapping in journal['inputs']['dataManifest']['media']:
        for path, expected in mapping['inventory'].items():
            url = mapping['url'] + urllib.parse.quote(path, safe='/')
            status, mime, raw = session.request(url)
            if len(raw) != expected['bytes'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
                raise PreviewError('Public frozen media bytes differ from the recorded inventory.')
            checked.append({'path':url, 'bytes':len(raw), 'contentType':mime, 'sha256':expected['sha256']})
    decoded = json.loads(run(['node', Path(__file__).resolve().parents[1] / 'scripts/validate-decoding.mjs'], input=json.dumps({'origin':origin,'slug':slug,'paths':[item['path'] for item in checked if item['contentType'].startswith('image/')]}).encode(), log_path=Path(evidence) / 'decoding.log' if evidence else None))
    external = [external_read(url) for url in journal['inputs']['dataManifest'].get('externalReads', [])]
    return {'origin':origin, 'localOnly':local, 'elapsedSeconds':round(time.monotonic()-started,3), 'readiness':'UP', 'identityVerified':True, 'accounts':account_results, 'media':checked,
            'imageDecoding':decoded, 'externalReads':{'scope':'captured renderable URL references; excluded from the frozen local media guarantee', 'results':external}}


def external_read(url):
    """Observe external availability without cookies, redirects or public URL secrets."""
    import ipaddress
    import socket
    proof = {'referenceSha256':hashlib.sha256(url.encode()).hexdigest(), 'origin':None,
             'excludedFromFrozenMediaGuarantee':True}
    try: parsed = urllib.parse.urlsplit(url)
    except ValueError: return {**proof, 'result':'unsupported URL; not requested'}
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
        return {**proof, 'result':'unsupported URL; not requested'}
    proof['origin'] = parsed.scheme + '://' + parsed.hostname
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            return {**proof, 'result':'nonpublic address; not requested'}
        opener = urllib.request.build_opener(NoRedirect)
        request = urllib.request.Request(url, method='HEAD', headers={'User-Agent':'enois-preview-validation'})
        try:
            with opener.open(request, timeout=10) as response:
                return {**proof, 'result':'observed', 'status':response.status, 'contentType':response.headers.get('Content-Type','')}
        except urllib.error.HTTPError as error:
            return {**proof, 'result':'observed', 'status':error.code}
    except (OSError, ValueError, urllib.error.URLError):
        return {**proof, 'result':'unavailable'}

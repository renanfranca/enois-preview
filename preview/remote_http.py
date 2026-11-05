"""Bounded HTTP clients with errors that do not contain secret-bearing responses."""
import base64
import json
import urllib.request
import urllib.error
from .state import PreviewError, run

class RemoteFailure(PreviewError):
    def __init__(self, status):
        super().__init__(f'Remote request failed ({status}); no paid fallback attempted.')
        self.status = status

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        return None

def request(url, method='GET', body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    try:
        response = urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url, data=data, method=method,
            headers={**({'Content-Type':'application/json'} if data else {}), **(headers or {})}), timeout=30)
        with response: return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error: raise RemoteFailure(error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise PreviewError('Remote outcome ambiguous; reconcile the recorded intent before retrying.') from error

class GitHub:
    def __init__(self, repository):
        self.repository = repository
        self.token = run(['gh','auth','token']).decode().strip()
    def call(self, path, method='GET', body=None):
        status, headers, raw = request('https://api.github.com/repos/' + self.repository + '/' + path, method, body,
            {'Authorization':'Bearer ' + self.token, 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28','User-Agent':'enois-preview'})
        return json.loads(raw) if raw else None
    def optional(self, path):
        try: return self.call(path)
        except RemoteFailure as error:
            if error.status == 404: return None
            raise

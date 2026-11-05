"""Installation validates existing infrastructure; it never creates services or credentials."""
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit
from .state import PreviewError, read, run, write

REPOS = ('enois-backend', 'enois-frontend', 'enois-design-system')

def validate(config):
    if not isinstance(config, dict) or config.get('schema') != 1:
        raise PreviewError('Unsupported configuration. Run enois-preview setup --config PRIVATE_JSON.')
    if (Path(__file__).resolve().parents[1] / 'release/channel.json').exists() and not config.get('toolCommit'):
        raise PreviewError('Set toolCommit to the full public tool commit used by your private launcher, then repeat setup.')
    if config.get('toolCommit') is not None and (not isinstance(config['toolCommit'],str) or not re.fullmatch(r'[a-f0-9]{40}', config['toolCommit'])):
        raise PreviewError('Configure toolCommit as a full immutable public Git commit.')
    if not isinstance(config.get('leaseWaitSeconds',900),(int,float)) or not 0 <= config.get('leaseWaitSeconds',900) <= 3600:
        raise PreviewError('leaseWaitSeconds must be between 0 and 3600; no lease is removed on timeout.')
    for key in ('workspace', 'state', 'database', 'h2Jar'):
        if not isinstance(config.get(key),str) or not Path(config[key]).is_absolute():
            raise PreviewError(f'Configuration requires an absolute {key} path.')
    if not isinstance(config.get('repositories'),dict): raise PreviewError('Configure the three application repositories.')
    for repo in REPOS:
        if not isinstance(config['repositories'].get(repo),str) or not Path(config['repositories'][repo]).is_absolute():
            raise PreviewError(f'Configuration requires repositories.{repo}.')
    for key in ('repository',):
        if not isinstance(config.get(key),str) or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', config[key]):
            raise PreviewError('Configure an existing private launcher repository.')
    if not isinstance(config.get('registry'),str) or not re.fullmatch(r'ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+', config['registry']):
        raise PreviewError('Configure an existing private GHCR destination.')
    if not isinstance(config.get('branch'),str) or not re.fullmatch(r'[a-zA-Z0-9._-]+', config['branch']):
        raise PreviewError('Configure the launcher publication branch.')
    if not isinstance(config.get('origin'),str): raise PreviewError('Configure the public HTTPS Worker origin.')
    origin = urlsplit(config['origin'])
    if origin.scheme != 'https' or not origin.hostname or origin.path not in ('', '/') or origin.query or origin.fragment or origin.username is not None or origin.password is not None or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', origin.hostname):
        raise PreviewError('Configure the public HTTPS Worker origin without a path.')
    if origin.port is not None and not 1 <= origin.port <= 65535:
        raise PreviewError('Invalid public Worker port.')
    if not isinstance(config.get('cloudflareAccountId'),str) or not re.fullmatch(r'[a-f0-9]{32}', config['cloudflareAccountId']):
        raise PreviewError('Configure cloudflareAccountId.')
    service = config.get('service', {})
    if not isinstance(service,dict) or not isinstance(service.get('expectedIdentity'),str) or not service['expectedIdentity']:
        raise PreviewError('Configure service commands and expectedIdentity for the owned backend.')
    for key in ('status', 'stop', 'start', 'ready', 'released', 'identity'):
        command = service.get(key)
        if not isinstance(command, list) or not command or not all(isinstance(x, str) and x for x in command):
            raise PreviewError(f'Configure service.{key} as an argument array; no shell commands.')
    if not isinstance(service.get('timeout', 60), (int, float)) or service.get('timeout', 60) <= 0:
        raise PreviewError('Service timeout must be positive.')
    paths = [Path(config['state']).resolve()]
    for repo in (config['repositories'][name] for name in REPOS):
        if any(path == Path(repo).resolve() or Path(repo).resolve() in path.parents for path in paths):
            raise PreviewError('Private state must be outside application repositories.')
    if not isinstance(config.get('media',[]),list): raise PreviewError('Configure media as a list of root/URL mappings.')
    for item in config.get('media', []):
        if (not isinstance(item,dict) or not isinstance(item.get('root'),str) or not isinstance(item.get('url'),str)
                or not Path(item['root']).is_absolute() or not re.fullmatch(r'/[a-zA-Z0-9._/-]+/', item['url'])
                or '..' in item['url'].split('/') or '//' in item['url']):
            raise PreviewError('Media roots require absolute paths and safe public URL prefixes.')
    if config.get('accounts'):
        from .capture import validate_accounts
        validate_accounts(config['accounts'])
    urls = [x['url'] for x in config.get('media', [])]
    if len(set(urls)) != len(urls) or any(a != b and b.startswith(a) for a in urls for b in urls):
        raise PreviewError('Media URL roots must be distinct and nonoverlapping.')
    return config

def installed(config):
    record = config.get('installation', {})
    if not isinstance(record,dict): raise PreviewError('Malformed initial verification record. Run enois-preview setup interactively.')
    try:
        confirmed = datetime.fromisoformat(record.get('checkedAt', '').replace('Z', '+00:00'))
        if confirmed.tzinfo is None or confirmed > datetime.now(timezone.utc): raise ValueError()
    except (ValueError, TypeError):
        raise PreviewError('Malformed initial verification record. Run enois-preview setup interactively.') from None
    if (record.get('githubOwner') != config['repository'].split('/')[0]
        or record.get('cloudflareAccountId') != config['cloudflareAccountId']
        or record.get('freePlansAndSpendingBlocksConfirmed') is not True):
        raise PreviewError('Initial account verification missing or mismatched. Run enois-preview setup interactively.')


def legacy_confirmation(config, file):
    """Preserve a prior human confirmation; never advance its original timestamp."""
    old = read(file)
    if (not isinstance(old,dict) or old.get('githubOwner') != config['repository'].split('/')[0]
        or old.get('cloudflareAccountId') != config['cloudflareAccountId']
        or old.get('githubPlan') != 'free' or old.get('cloudflarePlan') != 'free'
        or old.get('githubCodespacesStopUsage') is not True or old.get('githubPackagesStopUsage') is not True):
        raise PreviewError('Prior initial confirmation does not cover this installation. Preserve it and complete interactive setup for the configured accounts.')
    result = {'githubOwner':old['githubOwner'], 'cloudflareAccountId':old['cloudflareAccountId'],
        'freePlansAndSpendingBlocksConfirmed':True, 'checkedAt':old.get('checkedAt'), 'source':'existing launcher initial confirmation'}
    installed({**config, 'installation':result})
    return result

def prerequisites(config):
    for name in ('git', 'node', 'npm', 'python3', 'java', 'javac', 'docker', 'gh', 'fuser'):
        if not shutil.which(name):
            raise PreviewError(f'Install {name}, then repeat enois-preview setup.')
    for repo in REPOS:
        run(['git', '-C', config['repositories'][repo], 'rev-parse', '--git-dir'])
    if not Path(config['h2Jar']).is_file():
        raise PreviewError('Configure the H2 driver jar matching the local database.')
    if not Path(config['database']).is_file(): raise PreviewError('Configure an existing local H2 file.')
    if shutil.disk_usage(Path(config['state']).parent).free < Path(config['database']).stat().st_size * 4:
        raise PreviewError('Insufficient private capture storage; free space and repeat setup.')
    run(['docker', 'info'])
    remote = __import__('json').loads(run(['gh', 'api', f'repos/{config["repository"]}']))
    if not remote.get('private') or not remote.get('permissions', {}).get('push'):
        raise PreviewError('Launcher must be private and writable by the authenticated operator.')
    owner, package = config['registry'].removeprefix('ghcr.io/').split('/', 1)
    package = __import__('urllib.parse', fromlist=['quote']).quote(package, safe='')
    owner_type = __import__('json').loads(run(['gh', 'api', f'users/{owner}']))['type']
    namespace = 'orgs' if owner_type == 'Organization' else 'users'
    remote = __import__('json').loads(run(['gh', 'api', f'{namespace}/{owner}/packages/container/{package}']))
    if remote.get('visibility') != 'private':
        raise PreviewError('GHCR package must already exist and be private.')
    run(['npx', '--no-install', 'wrangler', 'whoami', '--account', config['cloudflareAccountId']], cwd=Path(__file__).resolve().parents[1])
    expected = run(config['service']['identity'], timeout=config['service'].get('timeout', 60)).decode().strip()
    if expected != config['service'].get('expectedIdentity'):
        raise PreviewError('Backend service identity mismatch; configure its owner and database, not only a port.')

"""Canonical CLI, with no credentials in reports or exception text."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from .config import installed, legacy_confirmation, prerequisites, validate
from .state import PreviewError, lease, private_dir, read, write


def select_accounts(listing):
    if not sys.stdin.isatty():
        raise PreviewError('Account selection required. Run enois-preview publish SCENARIO in an interactive local terminal, or configure accounts.')
    rows = dict(line.split('\t', 1) for line in listing.strip().splitlines())
    print('Existing identities (private terminal only):', file=sys.stderr)
    for key, value in rows.items(): print(f'{key}: {value}', file=sys.stderr)
    ids = input('Stable IDs to make available, separated by commas: ').split(',')
    result = []
    for index, key in enumerate(ids):
        key = key.strip()
        if key not in rows: raise PreviewError('Unknown account ID; retry with a listed identity.')
        result.append({'id': key, 'email': f'account{index + 1}@enois.invalid', 'label': rows[key]})
    return result


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(prog='enois-preview', description='Publish immutable, disposable Énóis PR previews.')
    parser.add_argument('--home', type=Path, default=Path(os.environ.get('ENOIS_PREVIEW_HOME', Path.home() / '.config/enois-preview')),
                        help='Private installation directory, outside application repositories')
    sub = parser.add_subparsers(dest='command', required=True)
    setup = sub.add_parser('setup', help='Validate existing infrastructure and record initial Free plan verification')
    setup.add_argument('--config', type=Path, help='Private JSON configuration; preserved on repetition')
    setup.add_argument('--legacy-verification', type=Path, help='Migrate an existing matching launcher confirmation without renewing its timestamp')
    publish = sub.add_parser('publish', help='Publish current commits with frozen scenario data')
    publish.add_argument('scenario')
    publish.add_argument('--refresh-data', action='store_true')
    resume = sub.add_parser('resume', help='Continue exactly the recorded immutable revision')
    resume.add_argument('revision')
    args = parser.parse_args(argv)
    try:
        home = private_dir(args.home)
        with lease(home / 'installation.lock'):
            file = home / 'config.json'
            if args.command == 'setup':
                existing = read(file) if file.exists() else None
                supplied = read(args.config) if args.config else {}
                if not isinstance(supplied, dict) or (existing is not None and not isinstance(existing, dict)):
                    raise PreviewError('Private configuration must be a JSON object; existing files were preserved.')
                config = validate({**(existing or {}), **supplied})
                if existing:
                    # Preserve an initial verification only for the exact infrastructure identity.
                    config['installation'] = existing.get('installation', {})
                if args.legacy_verification:
                    try: installed(config)
                    except PreviewError: config['installation'] = legacy_confirmation(config, args.legacy_verification)
                prerequisites(config)
                try: installed(config)
                except PreviewError:
                    if not sys.stdin.isatty():
                        raise PreviewError('Initial Free plan verification required. Run enois-preview setup --config PRIVATE_JSON in an interactive local terminal.')
                    print('Verify GitHub Free and Cloudflare Workers Free, with additional spending blocked. No command will request a card or enable paid services.', file=sys.stderr)
                    if input('Confirmed for the configured accounts? Type yes: ').strip().lower() != 'yes':
                        raise PreviewError('Installation verification declined; configuration and secrets were preserved.')
                    config['installation'] = {'githubOwner': config['repository'].split('/')[0],
                        'cloudflareAccountId': config['cloudflareAccountId'], 'freePlansAndSpendingBlocksConfirmed': True,
                        'checkedAt': datetime.now(timezone.utc).isoformat()}
                private_dir(config['state'])
                write(file, config)
                print('Installation verified. Configuration preserved privately. Publish and resume require no financial renewal.')
                return 0
            if not file.exists(): raise PreviewError('Run enois-preview setup --config PRIVATE_JSON first.')
            config = validate(read(file))
            installed(config)
        from .publication import publish_revision, resume_revision
        if args.command == 'publish':
            if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.scenario):
                raise PreviewError('Invalid scenario: use lowercase letters, digits and single separating hyphens.')
            report = publish_revision(config, args.scenario, args.refresh_data, select_accounts)
        else:
            if not re.fullmatch(r'[a-f0-9]{64}', args.revision): raise PreviewError('Resume requires the full 64 character revision ID.')
            report = resume_revision(config, args.revision)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (PreviewError, OSError, ValueError, KeyError, KeyboardInterrupt) as error:
        # Unexpected OS/JSON failures may contain private filenames or source content.
        message = str(error) if isinstance(error, PreviewError) else 'Invalid or unavailable private input. Inspect local configuration and durable recovery state.'
        print(f'Publication incomplete: {message}', file=sys.stderr)
        return 1

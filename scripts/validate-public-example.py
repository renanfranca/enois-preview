#!/usr/bin/env python3
"""Exercise the frozen fictional revision through its actual public Worker."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.exercises import exercise, require
from preview.state import PreviewError, private_dir, read, run, write
from preview.validation import Session, validate


def check(directory):
    directory=Path(directory).resolve()
    journal=read(directory/'journal.json')
    require(journal['inputs']['scenario'].startswith('exemplo-') or journal['inputs']['scenario'].startswith('fictional-'), 'This check requires a fictional scenario')
    require(all(a['id'].startswith('example_') for a in journal['inputs']['dataManifest']['accounts']), 'This check only modifies fictional identities')
    origin=journal['target']['origin'];slug=journal['slug']
    evidence=private_dir(directory/'public-functional-evidence')
    basic=validate(origin,journal,evidence=evidence)
    credentials=Session(origin,slug).json('/__demo/access.json')
    write(evidence/'credentials.json',credentials)
    browser=json.loads(run(['node',Path(__file__).resolve().parent/'validate-example-browser.mjs'],
        input=json.dumps({'origin':origin,'slug':slug,'accounts':credentials['accounts'],'account':credentials['accounts'][0],'evidence':str(evidence)}).encode(),
        log_path=evidence/'browser.log',timeout=600))
    write(evidence/'browser.json',browser)
    flow=exercise({'origin':origin,'slug':slug,'credentials':credentials,'local':False,'evidence':str(evidence)})
    result={'origin':origin,'revision':journal['revision'],'publicWorker':True,'basic':basic,'browser':browser,'flows':flow}
    write(evidence/'validation.json',result)
    print('Public fictional example validated: both entry accounts, real login, desktop/mobile emulation, blog distribution/ownership, upload/read/attach/delete and exact 20 MiB boundary.')


if __name__ == '__main__':
    if len(sys.argv)!=2: raise SystemExit('Usage: python3 scripts/validate-public-example.py PRIVATE_OPERATION_DIRECTORY')
    try:check(sys.argv[1])
    except PreviewError as error:
        print(str(error),file=sys.stderr)
        raise SystemExit(1)

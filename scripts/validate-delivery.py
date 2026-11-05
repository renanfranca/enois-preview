#!/usr/bin/env python3
"""Probe actual packaged demo email services with an observed transport double."""
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, private_dir, run, write


def check(image, evidence):
    evidence=private_dir(evidence)
    container=run(['docker','create',image]).decode().strip()
    try:
        with tempfile.TemporaryDirectory(dir=evidence) as temp:
            root=Path(temp)
            run(['docker','cp',f'{container}:/opt/render-demo/backend',root/'backend'])
            classpath=str(root/'backend/rede.jar')+':'+str(root/'backend/lib/*')
            run(['javac','-cp',classpath,'-d',root,Path(__file__).with_name('DeliveryProbe.java')])
            output=run(['java','-cp',str(root)+':'+classpath,'DeliveryProbe'],log_path=evidence/'delivery-probe.log')
            proof=json.loads(next(line.removeprefix('DELIVERY_PROOF=') for line in output.decode().splitlines() if line.startswith('DELIVERY_PROOF=')))
            proof.update(image=image,actualPackagedServices=True,externalTransport='recording double with positive control; no SMTP delivery',localOnly=True)
            write(evidence/'delivery-validation.json',proof)
            print('Packaged demo email validated: positive control detected; direct send and eligible asynchronous newsletter preserve local effects with zero observed external sends.')
    finally:run(['docker','rm',container])


if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: python3 scripts/validate-delivery.py IMAGE PRIVATE_EVIDENCE_DIRECTORY')
    try:check(sys.argv[1],sys.argv[2])
    except (PreviewError,StopIteration,ValueError) as error:
        print(str(error) if isinstance(error,PreviewError) else 'Invalid packaged delivery probe evidence.',file=sys.stderr)
        raise SystemExit(1)

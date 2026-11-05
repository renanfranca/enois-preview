#!/usr/bin/env python3
"""Inspect every distributed image layer for private synthetic control values.

Values arrive in a private JSON file; reports identify categories, never values.
This is evidence alongside database/schema verification, not a general secret detector.
"""
import argparse
import json
from pathlib import Path
import sys
import tarfile
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.state import PreviewError, private_dir, read, run, write


def scan(archive, values):
    patterns={category:[value.encode() for value in entries if isinstance(value,str) and len(value)>=12] for category,entries in values.items()}
    if not patterns or any(not entries for entries in patterns.values()):raise PreviewError('Provide explicit synthetic control categories with nonempty values of at least 12 characters.')
    overlap=max(len(value) for entries in patterns.values() for value in entries)-1
    found=set();files=0;count=0
    with tarfile.open(archive,'r') as image:
        manifest=json.load(image.extractfile('manifest.json'))
        layers=manifest[0]['Layers']
        for name in layers:
            with tarfile.open(fileobj=image.extractfile(name),mode='r|*') as layer:
                for item in layer:
                    if not item.isfile():continue
                    files+=1;stream=layer.extractfile(item);tail=b''
                    while True:
                        raw=stream.read(1024*1024)
                        if not raw:break
                        count+=len(raw);window=tail+raw
                        for category,entries in patterns.items():
                            if any(value in window for value in entries):found.add(category)
                        tail=window[-overlap:] if overlap else b''
    return {'layers':len(layers),'files':files,'scannedBytes':count,'controlCategories':sorted(patterns),'matchedCategories':sorted(found),
            'allDistributedLayersScanned':True,'deletedFilesIncluded':True,'scope':'literal synthetic control values plus separately verified sanitized database; not a universal secret scan'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image');parser.add_argument('--values',type=Path,required=True);parser.add_argument('--evidence',type=Path,required=True)
    args=parser.parse_args();evidence=private_dir(args.evidence)
    with tempfile.TemporaryDirectory(dir=evidence) as temporary:
        archive=Path(temporary)/'image.tar'
        run(['docker','save','--output',archive,args.image],timeout=1800);archive.chmod(0o600)
        proof=scan(archive,read(args.values));proof['image']=args.image
        write(evidence/'layer-validation.json',proof)
        if proof['matchedCategories']:raise PreviewError('An original synthetic authentication control remains in a distributed image layer; image acceptance failed.')
    print('Every distributed layer inspected: original synthetic authentication controls absent, including deleted lower-layer files.')


if __name__=='__main__':
    try:main()
    except PreviewError as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)

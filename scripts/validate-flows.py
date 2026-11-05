#!/usr/bin/env python3
"""Exercise fictional demo HTTP contracts; credentials arrive only on private stdin."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from preview.exercises import exercise
from preview.state import PreviewError
if __name__ == '__main__':
    try: print(json.dumps(exercise(json.load(sys.stdin))))
    except PreviewError as error: print(str(error),file=sys.stderr);raise SystemExit(1)

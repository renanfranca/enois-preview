import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('image_secrets',ROOT/'scripts/verify-image-secrets.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ImageLayerTests(unittest.TestCase):
    def test_original_credentials_deleted_by_a_later_layer_are_still_detected(self):
        secret='synthetic-original-credential-control'
        def tar(files):
            output=io.BytesIO()
            with tarfile.open(fileobj=output,mode='w') as archive:
                for name,raw in files.items():
                    item=tarfile.TarInfo(name);item.size=len(raw);archive.addfile(item,io.BytesIO(raw))
            return output.getvalue()
        # Split the control across scanner read boundaries in a lower layer.
        lower=tar({'removed-private-file':b'x'*(1024*1024-7)+secret.encode()})
        upper=tar({'.wh.removed-private-file':b''})
        manifest=json.dumps([{'Layers':['lower/layer.tar','upper/layer.tar']}]).encode()
        with tempfile.TemporaryDirectory() as temporary:
            image=Path(temporary)/'image.tar';image.write_bytes(tar({'manifest.json':manifest,'lower/layer.tar':lower,'upper/layer.tar':upper}))
            proof=module.scan(image,{'credentials':[secret]})
        self.assertEqual(proof['matchedCategories'],['credentials'])
        self.assertEqual(proof['layers'],2)
        self.assertNotIn(secret,json.dumps(proof))

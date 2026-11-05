"""Private durable records, verified inventories and cooperative process leases."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

class PreviewError(Exception):
    pass

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()

def identity(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def sha(path):
    with Path(path).open('rb') as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
        return digest.hexdigest()

def private_dir(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path

def write(path, value):
    path = Path(path)
    private_dir(path.parent)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(canonical(value) + b'\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def read(path):
    with Path(path).open() as stream:
        return json.load(stream)

@contextlib.contextmanager
def lease(path):
    path = Path(path)
    private_dir(path.parent)
    with os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'w') as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        yield

def run(args, cwd=None, timeout=600, env=None, input=None, log_path=None):
    """Never include output, command arguments or environment in shareable exceptions."""
    log = None
    try:
        if log_path:
            log = os.fdopen(os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb')
        result = subprocess.run([str(x) for x in args], cwd=cwd, env=env, input=input,
                                stdout=log if log else subprocess.PIPE, stderr=subprocess.STDOUT if log else subprocess.PIPE,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PreviewError(f'{Path(args[0]).name} unavailable or timed out; inspect private diagnostics.') from error
    finally:
        if log: log.close()
    if log_path: result.stdout = Path(log_path).read_bytes()
    if result.returncode:
        raise PreviewError(f'{Path(args[0]).name} failed (exit {result.returncode}); inspect the configured service or authentication.')
    return result.stdout

def inventory(root):
    root = Path(root)
    result = {}
    if root.is_symlink() or not root.is_dir():
        raise PreviewError('Inventory root is missing or is a symlink.')
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise PreviewError('Symlinks are not allowed in frozen inputs.')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = {'bytes': path.stat().st_size, 'sha256': sha(path)}
        elif not path.is_dir():
            raise PreviewError('Unsupported object in frozen inputs.')
    return result

def verify(root, expected):
    if inventory(root) != expected:
        raise PreviewError('Frozen input integrity failure; restore the recorded artifact. No live recapture was attempted.')

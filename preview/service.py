#!/usr/bin/env python3
"""PID-owned adapter for the fictional workspace; never discovers a service by port alone."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request


def main():
    config = json.loads(Path(sys.argv[1]).read_text())
    action = sys.argv[2]
    pidfile = Path(config['pidfile'])
    pid = int(pidfile.read_text()) if pidfile.exists() else None
    alive = bool(pid and Path(f'/proc/{pid}').exists())
    database = str(Path(config['database']).with_suffix('').with_suffix(''))
    if alive and Path(f'/proc/{pid}/stat').read_text().split()[2] == 'Z': alive = False
    if alive:
        command = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        cwd = Path(f'/proc/{pid}/cwd').resolve()
        expected_db = f'--spring.datasource.url=jdbc:h2:file:{database};MODE=MySQL'.encode()
        if str(config['jar']).encode() not in command or expected_db not in command or cwd != Path(config['cwd']).resolve():
            raise SystemExit('Backend ownership mismatch; no process was signalled.')
    if action == 'identity': print(config['database'])
    elif action == 'status': print('running' if alive else 'stopped')
    elif action == 'released':
        result = subprocess.run(['fuser',config['database']],capture_output=True)
        print('released' if result.returncode == 1 else 'locked')
    elif action == 'ready':
        if not alive: raise SystemExit('Owned backend is not running.')
        with urllib.request.urlopen(f'http://127.0.0.1:{config["port"]}/api/actuator/health/readiness',timeout=5) as response:
            print('ready' if json.load(response).get('status') == 'UP' else 'not-ready')
    elif action == 'stop' and alive:
        os.kill(pid, signal.SIGTERM)
        for attempt in range(600):
            if not Path(f'/proc/{pid}').exists() or Path(f'/proc/{pid}/stat').read_text().split()[2] == 'Z': break
            time.sleep(.1)
        else: raise SystemExit('Owned backend did not stop; no force kill was used.')
        pidfile.unlink(missing_ok=True)
    elif action == 'start' and not alive:
        environment = dict(os.environ)
        if config.get('environmentFile'):
            extra = json.loads(Path(config['environmentFile']).read_text())
            if not isinstance(extra,dict) or not all(isinstance(k,str) and isinstance(v,str) for k,v in extra.items()):
                raise SystemExit('Invalid private service environment.')
            environment.update(extra)
        args = ['java','-Xmx384m','-jar',config['jar'],'--spring.profiles.active=dev',
            '--server.address=127.0.0.1',f'--server.port={config["port"]}','--server.servlet.context-path=/api',
            f'--spring.datasource.url=jdbc:h2:file:{database};MODE=MySQL','--spring.mail.host=127.0.0.1','--spring.mail.port=9',
            f'--rede.cors.allowed-origins=http://localhost:{config["port"]}', f'--rede.origins.trusted=http://localhost:{config["port"]}',
            '--rede.jobs.import.jobradar.enabled=false','--rede.jobs.import.external-listing-enabled=false',
            '--rede.jobs.import.external-refresh-enabled=false','--rede.emotes.refresh-enabled=false',
            '--rede.github.sync-enabled=false','--rede.github.sync-on-link-enabled=false',
            '--rede.linkedin.contact-invites.worker-enabled=false','--rede.moderation.ai.triage-enabled=false',
            '--rede.moderation.ai.auto-penalty-enabled=false','--rede.media.migration.enabled=false']
        with Path(config['log']).open('ab') as log:
            process = subprocess.Popen(args,cwd=config['cwd'],env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        pidfile.write_text(str(process.pid)); pidfile.chmod(0o600)
    elif action not in ('start','stop'): raise SystemExit('Unknown service action')

if __name__ == '__main__': main()

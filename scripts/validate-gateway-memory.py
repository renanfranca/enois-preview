#!/usr/bin/env python3
"""Observe a real isolated gateway under a 128 MiB Docker limit; no application runs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
SIZE=256*1024*1024

def command(*args):
    return subprocess.check_output([str(arg) for arg in args],stderr=subprocess.PIPE).decode().strip()

def proof(output, old_commit=None):
    report={'memoryLimit':128*1024*1024,'memorySwapLimit':128*1024*1024,'fileBytes':SIZE,'oldCommit':old_commit}
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory);(root/'media/seed').mkdir(parents=True)
        shutil.copytree(ROOT/'runtime',root/'runtime')
        if old_commit:
            (root/'runtime/gateway.mjs').write_text(command('git','-C',ROOT,'show',old_commit+':runtime/gateway.mjs')+'\n')
        with (root/'media/seed/large.bin').open('wb') as file:file.truncate(SIZE)
        digest=hashlib.sha256()
        for _ in range(256):digest.update(bytes(1024*1024))
        expected=digest.hexdigest();report['expectedSha256']=expected
        (root/'manifest.json').write_text(json.dumps({'media':[{'url':'/seed/','directory':'seed','inventory':{'large.bin':{'bytes':SIZE,'sha256':expected}}}]}))
        (root/'serve.mjs').write_text("""
import fs from 'node:fs';
import { createGateway } from './runtime/gateway.mjs';
let readBytes=0, streamedBytes=0;
const mediaFds=new Set();
const open=fs.openSync, close=fs.closeSync, read=fs.readSync, readFile=fs.readFileSync;
fs.openSync=(file,...args)=>{const fd=open(file,...args);if(String(file).startsWith('/proof/media/'))mediaFds.add(fd);return fd;};
fs.closeSync=fd=>{mediaFds.delete(fd);return close(fd);};
fs.readSync=(fd,...args)=>{const count=read(fd,...args);if(mediaFds.has(fd))readBytes+=count;return count;};
fs.readFileSync=(file,...args)=>{const before=readBytes;const result=readFile(file,...args);if(String(file).startsWith('/proof/media/')&&readBytes===before)readBytes+=result.length;return result;};
const asyncRead=fs.read;
fs.read=(fd,...args)=>{const callback=args.pop();return asyncRead(fd,...args,(error,count,...rest)=>{streamedBytes+=count||0;callback(error,count,...rest);});};
const server=createGateway({writable:true,mediaRoot:'/proof/media',manifestPath:'/proof/manifest.json'});
const handler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',(req,res)=>{
 if(req.url!=='/__proof__/metrics')return handler(req,res);
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({readBytes,streamedBytes,descriptors:fs.readdirSync('/proc/self/fd').length,memoryPeak:Number(readFile('/sys/fs/cgroup/memory.peak','utf8')),memoryStat:readFile('/sys/fs/cgroup/memory.stat','utf8')}));
});server.listen(3000,'0.0.0.0');
""")
        container=command('docker','run','-d','--memory=128m','--memory-swap=128m','-p','127.0.0.1::3000','--mount',f'type=bind,src={root},dst=/proof,readonly','node:24-bookworm-slim','node','/proof/serve.mjs')
        try:
            port=int(command('docker','port',container,'3000/tcp').rsplit(':',1)[1]);origin='http://127.0.0.1:'+str(port)
            for _ in range(100):
                try:
                    urllib.request.urlopen(origin+'/__demo/runtime',timeout=1).close();break
                except OSError:time.sleep(.1)
            def stats():
                with urllib.request.urlopen(origin+'/__proof__/metrics',timeout=5) as response:return json.load(response)
            before=stats();report['before']=before
            def head(_=None):
                with urllib.request.urlopen(urllib.request.Request(origin+'/seed/large.bin',method='HEAD'),timeout=30) as response:
                    body=response.read()
                    assert response.status==200 and response.headers['Content-Length']==str(SIZE) and not body
                    return {'status':response.status,'contentLength':int(response.headers['Content-Length']),'bodyBytes':len(body)}
            report['head']=head();after=stats();report['headReadBytes']=after['readBytes']-before['readBytes']
            assert report['headReadBytes']<=4096,report['headReadBytes']
            digest=hashlib.sha256();received=0
            with urllib.request.urlopen(origin+'/seed/large.bin',timeout=60) as response:
                while block:=response.read(1024*1024):digest.update(block);received+=len(block)
            report['get']={'bytes':received,'sha256':digest.hexdigest()}
            assert received==SIZE and digest.hexdigest()==expected
            start=stats()
            connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
            connection.request('GET','/seed/large.bin');response=connection.getresponse();response.read(1024)
            time.sleep(1)
            stalled=stats();report['slowClientStreamedBytes']=stalled['streamedBytes']-start['streamedBytes']
            time.sleep(1)
            settled=stats();report['slowClientAdditionalBytes']=settled['streamedBytes']-stalled['streamedBytes']
            assert report['slowClientStreamedBytes']<SIZE and report['slowClientAdditionalBytes']==0
            response.close();connection.close()
            for _ in range(20):
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
                connection.request('GET','/seed/large.bin');response=connection.getresponse();response.read(1024);response.close();connection.close()
            time.sleep(.5)
            after_aborts=stats();report['afterAborts']=after_aborts
            assert after_aborts['descriptors']<=before['descriptors']+2
            with ThreadPoolExecutor(max_workers=8) as pool:report['concurrentHeadCount']=len(list(pool.map(head,range(64))))
            after_heads=stats();report['concurrentHeadReadBytes']=after_heads['readBytes']-after_aborts['readBytes']
            assert report['concurrentHeadReadBytes']<=64*4096
            report['finalHead']=head();report['after']=stats()
            report['passed']=True
        except Exception as error:
            report['passed']=False;report['error']=type(error).__name__+': '+str(error)
        finally:
            report['containerState']=json.loads(command('docker','inspect',container))[0]['State']
            report['containerLimits']=json.loads(command('docker','inspect',container))[0]['HostConfig']
            report['containerLimits']={key:report['containerLimits'][key] for key in ('Memory','MemorySwap')}
            report['logs']=command('docker','logs',container)
            command('docker','rm','-f',container)
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({key:report[key] for key in ('passed','oldCommit','headReadBytes','get','error') if key in report}))
    return 0 if report['passed'] else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);parser.add_argument('--old-commit')
    args=parser.parse_args();raise SystemExit(proof(args.output,args.old_commit))

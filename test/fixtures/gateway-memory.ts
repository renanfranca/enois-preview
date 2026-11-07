import fs from 'node:fs';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { createGateway } from '../../runtime/gateway.js';

let readBytes=0,streamedBytes=0;const mediaFds=new Set<number>();
const originalOpen=fs.openSync,originalClose=fs.closeSync,originalRead=fs.readSync,originalReadFile=fs.readFileSync,originalAsyncRead=fs.read;
fs.openSync=((file:fs.PathLike,...args:unknown[])=>{const fd=Reflect.apply(originalOpen,fs,[file,...args]) as number;if(String(file).startsWith('/proof/media/'))mediaFds.add(fd);return fd;}) as typeof fs.openSync;
fs.closeSync=(fd:number)=>{mediaFds.delete(fd);return originalClose(fd);};
fs.readSync=((fd:number,...args:unknown[])=>{const count=Reflect.apply(originalRead,fs,[fd,...args]) as number;if(mediaFds.has(fd))readBytes+=count;return count;}) as typeof fs.readSync;
fs.readFileSync=((file:fs.PathOrFileDescriptor,...args:unknown[])=>{const before=readBytes;const result=Reflect.apply(originalReadFile,fs,[file,...args]) as string|Buffer;if(String(file).startsWith('/proof/media/')&&readBytes===before)readBytes+=result.length;return result;}) as typeof fs.readFileSync;
fs.read=((fd:number,...args:unknown[])=>{const callback=args.pop();if(typeof callback!=='function')throw new Error('Missing read callback');return Reflect.apply(originalAsyncRead,fs,[fd,...args,(error:NodeJS.ErrnoException|null,count:number,buffer:unknown)=>{streamedBytes+=count||0;callback(error,count,buffer);}]);}) as typeof fs.read;
const server=createGateway({mediaRoot:'/proof/media',manifestPath:'/proof/manifest.json'});
const handler=server.listeners('request')[0];if(typeof handler!=='function')throw new Error('Missing gateway listener');server.removeAllListeners('request');
server.on('request',(request:IncomingMessage,response:ServerResponse)=>{
  if(request.url!=='/__proof__/metrics'){handler(request,response);return;}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({readBytes,streamedBytes,descriptors:fs.readdirSync('/proc/self/fd').length,memoryPeak:Number(originalReadFile('/sys/fs/cgroup/memory.peak','utf8')),memoryStat:originalReadFile('/sys/fs/cgroup/memory.stat','utf8')}));
});server.listen(3000,'0.0.0.0');

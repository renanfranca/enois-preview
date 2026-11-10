import { cp, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from '../preview/project.js';
import { object, privateDir, PreviewError, run, writeRecord, invokedDirectly } from '../preview/state.js';

function require(condition:unknown,message:string):asserts condition{if(!condition)throw new PreviewError(message);}
function response(url:string,method='GET'):Promise<http.IncomingMessage>{return new Promise((done,reject)=>{const request=http.request(url,{method,agent:false,timeout:30_000},done);request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('Memory proof HTTP timeout')));request.end();});}
async function bytes(incoming:http.IncomingMessage):Promise<Buffer>{const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
interface Metrics {readBytes:number;streamedBytes:number;descriptors:number;memoryPeak:number;memoryStat:string}
export async function proof(output:string):Promise<boolean>{
  const size=268_435_456,limit=134_217_728;const expected='a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484';
  const report:Record<string,unknown>={memoryLimit:limit,memorySwapLimit:limit,fileBytes:size,expectedSha256:expected};
  const root=await mkdtemp(join(tmpdir(),'enois-memory-runtime-'));let container:string|undefined;
  try{
    await privateDir(join(root,'media/seed'));const file=await open(join(root,'media/seed/large.bin'),'wx');try{await file.truncate(size);}finally{await file.close();}
    await cp(join(ROOT,'dist'),join(root,'dist'),{recursive:true});await writeFile(join(root,'package.json'),'{"type":"module"}');
    await writeRecord(join(root,'manifest.json'),{media:[{url:'/seed/',directory:'seed',inventory:{'large.bin':{bytes:size,sha256:expected}}}]});
    container=(await run(['docker','run','-d','--memory=128m','--memory-swap=128m','-p','127.0.0.1::3000','--mount',`type=bind,src=${root},dst=/proof,readonly`,'node:24-bookworm-slim','node','/proof/dist/test/fixtures/gateway-memory.js'])).toString().trim();
    const port=(await run(['docker','port',container,'3000/tcp'])).toString().trim().split(':').at(-1);require(port&&/^\d+$/.test(port),'Docker did not expose the memory proof port.');const origin=`http://127.0.0.1:${port}`;
    const metrics=async():Promise<Metrics>=>{const incoming=await response(origin+'/__proof__/metrics');require(incoming.statusCode===200,'Gateway metrics unavailable.');return JSON.parse((await bytes(incoming)).toString()) as Metrics;};
    let before:Metrics|undefined;
    for(let attempt=0;attempt<100;attempt++){try{before=await metrics();break;}catch{await delay(100);}}
    require(before,'Gateway did not become ready for the memory proof.');report.before=before;
    const head=async()=>{const incoming=await response(origin+'/seed/large.bin','HEAD');const body=await bytes(incoming);require(incoming.statusCode===200&&incoming.headers['content-length']===String(size)&&body.length===0,'HEAD did not preserve full length and an empty body.');return {status:200,contentLength:size,bodyBytes:0};};
    report.head=await head();report.headReadBytes=(await metrics()).readBytes-before.readBytes;require(report.headReadBytes===4096,'HEAD exceeded or failed the literal 4096-byte prefix inspection.');
    const incoming=await response(origin+'/seed/large.bin');const hash=createHash('sha256');let received=0;
    for await(const chunk of incoming){received+=chunk.length;hash.update(chunk);}const digest=hash.digest('hex');report.get={bytes:received,sha256:digest};require(received===size&&digest===expected,'Streaming GET changed the frozen bytes.');
    const start=await metrics();const slow=await response(origin+'/seed/large.bin');await once(slow,'readable');slow.read(1024);slow.pause();
    await delay(1000);const stalled=await metrics();await delay(1000);const settled=await metrics();
    report.slowClientStreamedBytes=stalled.streamedBytes-start.streamedBytes;report.slowClientAdditionalBytes=settled.streamedBytes-stalled.streamedBytes;
    require(Number(report.slowClientStreamedBytes)<size&&report.slowClientAdditionalBytes===0,'Gateway did not stop reading while the client stalled.');slow.destroy();
    for(let attempt=0;attempt<20;attempt++){const aborted=await response(origin+'/seed/large.bin');await once(aborted,'readable');aborted.read(1024);aborted.destroy();}
    await delay(500);const afterAborts=await metrics();report.afterAborts=afterAborts;require(afterAborts.descriptors<=before.descriptors+2,'Interrupted responses leaked file descriptors.');
    let heads=0;for(let batch=0;batch<8;batch++)heads+=(await Promise.all(Array.from({length:8},head))).length;
    report.concurrentHeadCount=heads;report.concurrentHeadReadBytes=(await metrics()).readBytes-afterAborts.readBytes;require(report.concurrentHeadReadBytes===262144,'Concurrent HEAD prefix reads exceeded the literal bound.');
    report.finalHead=await head();report.after=await metrics();report.passed=true;
  }catch(error:unknown){report.passed=false;report.error=error instanceof Error?error.message:'Memory proof failed';}
  finally{
    try{if(container){const inspected:unknown=JSON.parse((await run(['docker','inspect',container])).toString());require(Array.isArray(inspected),'Docker state unavailable.');const entry=object(inspected[0]);report.containerState=entry.State;const host=object(entry.HostConfig);report.containerLimits={Memory:host.Memory,MemorySwap:host.MemorySwap};report.logs=(await run(['docker','logs',container])).toString();}}
    finally{try{if(container)await run(['docker','rm','-f',container]);}finally{await rm(root,{recursive:true,force:true});}}
  }
  await writeRecord(resolve(output),report);console.log(JSON.stringify({passed:report.passed,headReadBytes:report.headReadBytes,get:report.get,...(report.error?{error:report.error}:{})}));return report.passed===true;
}
if(await invokedDirectly(import.meta.url)){try{require(process.argv.length===3&&process.argv[2],'Usage: node dist/scripts/validate-gateway-memory.js NEW_PRIVATE_REPORT');process.exitCode=await proof(process.argv[2])?0:1;}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Gateway memory verification failed.');process.exitCode=1;}}

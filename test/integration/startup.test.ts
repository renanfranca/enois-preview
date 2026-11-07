import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { object, readRecord, run, string } from '../../preview/state.js';

test('successful callback process completion keeps the actual application runtime alive',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input,'Set ENOIS_PREVIEW_EXAMPLE_WORKSPACE to the prepared example with a local image receipt');
  const receipt=await readRecord(join(resolve(input),'.preview/local-image-receipt.json'));const image=string(receipt.image);
  const container=(await run(['docker','run','-d','--cpus=2','--memory=2g','-p','127.0.0.1::3000','--mount',`type=bind,src=${resolve('dist/test/fixtures/registration-success.js')},dst=/opt/render-demo/runtime/register-codespace.js,readonly`,'-e','CODESPACES=true','-e','DEMO_PUBLIC_ORIGIN=http://localhost:3000','-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,image])).toString().trim();
  const state=async()=>{const result:unknown=JSON.parse((await run(['docker','inspect',container])).toString());assert.ok(Array.isArray(result));return object(object(result[0]).State);};
  try{
    const deadline=Date.now()+120_000;let registered=false;
    while(Date.now()<deadline){const logs=(await run(['docker','logs',container])).toString();if(logs.includes('Controlled registration success')){registered=true;break;}if((await state()).Running!==true)break;await delay(250);}
    assert.equal(registered,true,'Controlled registration child must finish successfully');

    await delay(1000);

    assert.equal((await state()).Running,true,'A successful callback child must not terminate the application supervisor');
    const port=(await run(['docker','port',container,'3000/tcp'])).toString().trim().split(':').at(-1);const response=await fetch(`http://127.0.0.1:${port}/api/actuator/health/readiness`);
    assert.equal(response.status,200);assert.equal(object(await response.json()).status,'UP');
  }finally{await run(['docker','rm','-f',container]);}
});

test('the Node daemon survives lifecycle hook exit and SIGHUP, supplies forwarding context and stops its owned children',async()=>{
  const input=process.env.ENOIS_PREVIEW_EXAMPLE_WORKSPACE;assert.ok(input);
  const receipt=await readRecord(join(resolve(input),'.preview/local-image-receipt.json'));const image=string(receipt.image);
  const container=(await run(['docker','run','-d','--cpus=2','--memory=2g','-p','127.0.0.1::3000','--entrypoint','sleep','--mount',`type=bind,src=${resolve('dist/test/fixtures/registration-success.js')},dst=/opt/render-demo/runtime/register-codespace.js,readonly`,'-e','CODESPACES=true','-e','GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN=app.github.dev','-e','CODESPACE_PORT_FORWARDING_DOMAIN=','-e',`REDE_SECURITY_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,image,'infinity'])).toString().trim();
  try{
    await run(['docker','cp',resolve('dist/test/fixtures/supervisor-observer.js'),`${container}:/tmp/observer.mjs`]);
    const hookStarted=Date.now();

    await run(['docker','exec',container,'node','/opt/render-demo/runtime/start.js','--daemon','--slug','music','--origin','https://demo.example.invalid'],{timeout:5});

    assert.ok(Date.now()-hookStarted<5000,'Lifecycle hook must return while its daemon runs');
    const port=(await run(['docker','port',container,'3000/tcp'])).toString().trim().split(':').at(-1);const origin=`http://127.0.0.1:${port}`;
    const deadline=Date.now()+120_000;let healthy=false;
    while(Date.now()<deadline){try{const response=await fetch(origin+'/api/actuator/health/readiness',{signal:AbortSignal.timeout(1000)});if(response.ok&&object(await response.json()).status==='UP'){healthy=true;break;}}catch{}await delay(250);}
    assert.equal(healthy,true,'Actual backend must become ready after hook exit');
    const observed=JSON.parse((await run(['docker','exec',container,'node','/tmp/observer.mjs','hup'])).toString());
    assert.deepEqual(observed.selected,{DEMO_SLUG:'music',DEMO_PUBLIC_ORIGIN:'https://demo.example.invalid',DEMO_WORKER_URL:'https://demo.example.invalid',CODESPACE_PORT_FORWARDING_DOMAIN:'app.github.dev'});
    assert.deepEqual(observed.owned.map((item:{role:string})=>item.role).sort(),['backend','frontend','gateway','supervisor']);
    await delay(1000);assert.equal((await fetch(origin+'/api/actuator/health/readiness')).status,200);

    await run(['docker','exec',container,'node','/tmp/observer.mjs','stop']);

    let remaining:unknown[]=[];for(let attempt=0;attempt<100;attempt++){remaining=JSON.parse((await run(['docker','exec',container,'node','/tmp/observer.mjs'])).toString()).owned;if(remaining.length===0)break;await delay(100);}
    assert.deepEqual(remaining,[],'Supervisor must terminate all and only its application children');
  }finally{await run(['docker','rm','-f',container]);}
});

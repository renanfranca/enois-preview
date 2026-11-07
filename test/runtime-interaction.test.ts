import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trackDemoActivity } from '../runtime/demo-activity.js';

test('only visible trusted human input sends throttled activity and background failures wait for another human action',async()=>{
  const handlers=new Map<string,(event:{isTrusted:boolean})=>void>();let sent=0,now=100000,refuse=false;
  const target={visibilityState:'visible',addEventListener:(name:string,handler:(event:{isTrusted:boolean})=>void)=>{handlers.set(name,handler);},removeEventListener:(name:string)=>{handlers.delete(name);}};
  const stop=trackDemoActivity(target,async()=>{sent++;if(refuse)throw new Error('Controlled rejection');},()=>now);
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

  await settle();assert.equal(sent,0);handlers.get('pointermove')!({isTrusted:false});await settle();assert.equal(sent,0);
  handlers.get('keydown')!({isTrusted:true});await settle();assert.equal(sent,1);
  handlers.get('pointermove')!({isTrusted:true});await settle();assert.equal(sent,1);
  now+=15000;target.visibilityState='hidden';handlers.get('touchstart')!({isTrusted:true});await settle();assert.equal(sent,1);
  target.visibilityState='visible';refuse=true;handlers.get('touchstart')!({isTrusted:true});await settle();assert.equal(sent,2);
  await settle();assert.equal(sent,2,'A rejected activity request must not retry in the background');refuse=false;
  handlers.get('wheel')!({isTrusted:true});await settle();assert.equal(sent,3);
  stop();assert.equal(handlers.size,0);
});

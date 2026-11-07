import { Scenario } from '../../src/scenario.js';
import type { Lifecycle } from '../../src/scenario.js';
import { GitHubFailure } from '../../src/github.js';
import type { Credentials, Environment, ScenarioConfig, Storage } from '../../src/contracts.js';

export const scenario:ScenarioConfig={format:'enois-preview-ts-v1',repository:'owner/launcher',launcherCommit:'a'.repeat(40),image:`ghcr.io/owner/demo@sha256:${'b'.repeat(64)}`,devcontainerPath:'.devcontainer/music/devcontainer.json',provenanceSha256:'c'.repeat(64),revision:'f'.repeat(64),accounts:[{id:'author',email:'author@enois.invalid',label:'Author'}]};
export const access:Credentials={format:'enois-preview-ts-v1',accounts:[{id:'author',email:'author@enois.invalid',label:'Author',password:'d'.repeat(32)}]};
export const ready:Lifecycle={format:'enois-preview-ts-v1',config:scenario,name:'demo-one',phase:'ready',displayName:'demo-owned',origin:'https://demo-one-3000.app.github.dev',portToken:'private-port-token',credentials:access,lastActivity:1_000_000};
export function setup(existing?:unknown){
  const map=new Map<string,unknown>(existing===undefined?[]:[['state',structuredClone(existing)]]);let alarm:number|undefined;
  const storage:Storage={get:async key=>structuredClone(map.get(key)),put:async(key,value)=>{map.set(key,structuredClone(value));},delete:async key=>map.delete(key),setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=undefined;}};
  const env:Environment={LAUNCH_ENABLED:'true',GITHUB_TOKEN:'management',CALLBACK_SECRET:'callback',GITHUB_OWNER:'owner',GITHUB_REPOSITORY:'owner/launcher'};
  const instance=new Scenario({storage},env);let now=1_000_000;instance.now=()=>now;
  const calls={creates:0,deletes:0};let removed=false;
  instance.github={verifyConfig:async()=>{},smallestMachine:async()=>'two-core',create:async()=>{calls.creates++;return {name:'demo-one'};},remove:async()=>{calls.deletes++;removed=true;},find:async()=>[],get:async()=>{if(removed)throw new GitHubFailure(404);return {name:'demo-one',owner:{login:'owner'},repository:{full_name:scenario.repository},machine:{cpus:2},git_status:{ref:scenario.launcherCommit}};}};
  const request=(action:string,path='/',options:RequestInit={})=>{const headers=new Headers(options.headers);headers.set('X-Demo-Action',action);return instance.fetch(new Request(`https://demo.example${path}`,{...options,headers}));};
  return {instance,storage,calls,env,map,request,tick:(ms:number)=>{now+=ms;},get alarm(){return alarm;}};
}

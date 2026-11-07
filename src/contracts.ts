import type { Account } from '../shared/accounts.js';
import { accounts } from '../shared/accounts.js';
import { FORMAT, object, requireFormat, string } from '../shared/records.js';

export type Transport = (input:string|URL, init?:RequestInit & {duplex?:'half'})=>Promise<Response>;
export interface ScenarioConfig {
  format:typeof FORMAT; repository:string; launcherCommit:string; image:string; devcontainerPath:string;
  provenanceSha256:string; revision:string; accounts:Account[]; provenancePath?:string;
}
export interface Credentials { format:typeof FORMAT; accounts:(Account & {password:string})[] }
export function credentials(value:unknown):Credentials {
  requireFormat(value);const selected=accounts(value.accounts);
  if(!Array.isArray(value.accounts))throw new Error('Invalid credentials');
  const result=value.accounts.map((entry:unknown,index:number)=>{
    const password=string(object(entry).password);const account=selected[index];
    if(!account||!/^[A-Za-z0-9_-]{32}$/.test(password))throw new Error('Invalid credentials');
    return {...account,password};
  });
  if(new Set(result.map(account=>account.password)).size!==result.length)throw new Error('Invalid credentials');
  return {format:FORMAT,accounts:result};
}
export interface Storage {
  get(key:string):Promise<unknown>; put(key:string,value:unknown):Promise<unknown>;
  delete(key:string):Promise<unknown>;setAlarm(instant:number):Promise<unknown>;deleteAlarm():Promise<unknown>;
  transaction?<T>(work:(storage:Storage)=>Promise<T>):Promise<T>;
}
export interface Context {storage:Storage}
export interface Environment {
  LAUNCH_ENABLED?:string;GITHUB_TOKEN?:string;CALLBACK_SECRET?:string;GITHUB_OWNER?:string;GITHUB_REPOSITORY:string;
  SCENARIOS?:{idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>}};
}

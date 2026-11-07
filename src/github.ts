import { object, string } from '../shared/records.js';
import type { Environment, ScenarioConfig, Transport } from './contracts.js';

export class GitHubFailure extends Error {constructor(readonly status:number,readonly reason='UNCLASSIFIED'){super(`GitHub ${status} (${reason})`);}}
export function failureReason(value:unknown):string {
  const body=value&&typeof value==='object'&&!Array.isArray(value)?object(value):{};const message=typeof body.message==='string'?body.message:'';
  if(/rate limit/i.test(message))return 'RATE_LIMIT';if(/billing|quota|spending|included usage|usage limit/i.test(message))return 'QUOTA_OR_BILLING';if(/maximum|max number|too many|concurrent|active codespaces|running codespaces/i.test(message))return 'CONCURRENCY_LIMIT';if(/not accessible|permission|bad credentials/i.test(message))return 'ACCESS';return 'UNCLASSIFIED';
}
export interface RemoteSpace {name:string;state?:string;owner?:{login?:string};repository?:{full_name?:string};machine?:{cpus?:number};git_status?:{ref?:string}}
function remoteSpace(value:unknown):RemoteSpace {
  const data=object(value);return {name:string(data.name),...(data.state===undefined?{}:{state:string(data.state)}),...(data.owner===undefined?{}:{owner:{login:string(object(data.owner).login)}}),...(data.repository===undefined?{}:{repository:{full_name:string(object(data.repository).full_name)}}),...(data.machine===undefined?{}:{machine:{cpus:typeof object(data.machine).cpus==='number'?object(data.machine).cpus as number:0}}),...(data.git_status===undefined?{}:{git_status:typeof object(data.git_status).ref==='string'?{ref:string(object(data.git_status).ref)}:{}})};
}
export class GitHub {
  constructor(readonly env:Pick<Environment,'GITHUB_TOKEN'>,readonly transport:Transport=(input,init)=>fetch(input,init)){}
  async request(path:string,method='GET',body?:unknown):Promise<unknown>{
    const response=await this.transport(`https://api.github.com${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${this.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'enois-demo-launcher','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!response.ok){let body:unknown;try{body=await response.json();}catch{}throw new GitHubFailure(response.status,failureReason(body));}
    if(response.status===204||method==='DELETE'){await response.body?.cancel();return null;}const value:unknown=await response.json();return value;
  }
  async smallestMachine(config:ScenarioConfig):Promise<string>{
    const data=object(await this.request(`/repos/${config.repository}/codespaces/machines?ref=${config.launcherCommit}`));
    if(!Array.isArray(data.machines))throw new Error('Invalid machines');
    const machines=data.machines.map((value:unknown)=>object(value)).filter(m=>m.cpus===2&&typeof m.memory_in_bytes==='number').sort((a,b)=>Number(a.memory_in_bytes)-Number(b.memory_in_bytes));
    if(!machines[0])throw new Error('No two core machine available');return string(machines[0].name);
  }
  async verifyConfig(config:ScenarioConfig):Promise<void>{
    const data=object(await this.request(`/repos/${config.repository}/contents/${config.devcontainerPath}?ref=${config.launcherCommit}`));const dev=object(JSON.parse(atob(string(data.content).replace(/\s/g,''))));
    if(dev.image!==config.image||dev.overrideCommand!==true||!Array.isArray(dev.forwardPorts)||!dev.forwardPorts.includes(3000))throw new Error('Launcher configuration mismatch');
  }
  async create(config:ScenarioConfig,machine:string,displayName:string):Promise<RemoteSpace>{return remoteSpace(await this.request(`/repos/${config.repository}/codespaces`,'POST',{ref:config.launcherCommit,machine,devcontainer_path:config.devcontainerPath,display_name:displayName,idle_timeout_minutes:240,retention_period_minutes:0,multi_repo_permissions_opt_out:true}));}
  async get(name:string):Promise<RemoteSpace>{return remoteSpace(await this.request(`/user/codespaces/${encodeURIComponent(name)}`));}
  async remove(name:string):Promise<void>{await this.request(`/user/codespaces/${encodeURIComponent(name)}`,'DELETE');}
  async find(config:ScenarioConfig,displayName:string):Promise<RemoteSpace[]>{
    const result:RemoteSpace[]=[];for(let page=1;;page++){const data=object(await this.request(`/repos/${config.repository}/codespaces?per_page=100&page=${page}`));if(!Array.isArray(data.codespaces))throw new Error('Invalid codespace listing');result.push(...data.codespaces.filter((value:unknown)=>object(value).display_name===displayName).map(remoteSpace));if(data.codespaces.length<100)return result;}
  }
}

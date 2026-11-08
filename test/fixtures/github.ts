import {existsSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { RemoteFailure } from '../../preview/remote_http.js';
export class GitHubFixture {
  constructor(readonly bare:string){}
  private git(args:string[],input?:string):string{
    const result=spawnSync('/usr/bin/git',['-C',this.bare,...args],{encoding:'utf8',...(input===undefined?{}:{input})});
    if(result.status!==0)throw new Error('Fixture Git command failed');return result.stdout.trim();
  }
  async call(path:string,method='GET',body?:unknown):Promise<unknown>{
    const data=body as {ref?:string;sha?:string;tree?:string;parents?:string[];message?:string}|undefined;
    if(path.startsWith('git/ref/')){
      const result=spawnSync('/usr/bin/git',['-C',this.bare,'rev-parse','--verify',`refs/${path.slice('git/ref/'.length)}`],{encoding:'utf8'});
      if(result.status!==0)throw new RemoteFailure(404);return {object:{sha:result.stdout.trim()}};
    }
    if(path.startsWith('git/commits/')){const output=this.git(['show','-s','--format=%T%n%B',path.slice('git/commits/'.length)]).split('\n');return {tree:{sha:output[0]},message:output.slice(1).join('\n').trim()};}
    if(path==='git/commits'){
      if(!data?.tree||!data.parents?.[0]||!data.message)throw new Error('Invalid fixture commit');
      return {sha:this.git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',data.tree,'-p',data.parents[0]],data.message)};
    }
    if(path==='git/refs'){
      if(!data?.ref||!data.sha)throw new Error('Invalid fixture ref');
      const result=spawnSync('/usr/bin/git',['-C',this.bare,'update-ref',data.ref,data.sha,'']);if(result.status!==0)throw new RemoteFailure(422);return {object:{sha:data.sha}};
    }
    if(path.startsWith('git/refs/')&&method==='DELETE'){
      const root=dirname(this.bare),hold=join(root,'hold-delete');if(existsSync(hold)){writeFileSync(join(root,'delete-paused'),String(process.pid));const deadline=Date.now()+15000;while(existsSync(hold)&&Date.now()<deadline)await delay(10);}
      this.git(['update-ref','-d',`refs/${path.slice('git/refs/'.length)}`]);return null;}
    throw new Error('Unexpected fixture GitHub route');
  }
}

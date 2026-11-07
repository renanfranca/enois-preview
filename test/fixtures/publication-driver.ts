import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../preview/cli.js';
import { Publisher } from '../../preview/remote.js';
import { GitHub } from '../../preview/remote_http.js';
import { inventory, PreviewError, writeRecord } from '../../preview/state.js';
import { GitHubFixture } from './github.js';

const rootArgument=process.argv[2];if(!rootArgument)throw new Error('Missing fixture root');const root:string=rootArgument;
process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0=`url.${join(root,'remote.git')}.insteadOf`;process.env.GIT_CONFIG_VALUE_0='https://github.com/fixture/launcher.git';
process.env.PATH=`${join(root,'bin')}:${process.env.PATH??''}`;process.env.FIXTURE_LOST_GIT_ACK=join(root,'fail-once');
const github=new GitHubFixture(join(root,'remote.git'));GitHub.prototype.call=github.call.bind(github);
interface Platform {builds:Record<string,number>;images:Record<string,{image:string;digest:string;evidence:Record<string,unknown>}>;deployments:Record<string,unknown>;validations:Record<string,number>}
const file=join(root,'platform.json');
const read=():Platform=>JSON.parse(readFileSync(file,'utf8')) as Platform;
const save=(value:Platform):void=>writeFileSync(file,JSON.stringify(value));
function fail(stage:string):void{const marker=join(root,'fail-once');if(existsSync(marker)&&readFileSync(marker,'utf8')===stage){unlinkSync(marker);throw new PreviewError(`Simulated lost acknowledgement after ${stage}`);}}
Object.assign(Publisher.prototype,{
  async buildAndValidate(this:Publisher):Promise<void>{
    await this.intent('localImage');if(this.journal.checkpoints.localImage)return;
    const state=read();state.builds[this.journal.revision]=(state.builds[this.journal.revision]??0)+1;save(state);
    await writeRecord(join(this.directory,'adjusted-sources.json'),{files:await inventory(join(this.directory,'frozen/sources'))});
    await this.complete('localImage',{id:`sha256:${this.journal.revision}`,transport:'controlled build/runtime double'});
  },
  async registry(this:Publisher):Promise<void>{
    await this.intent('registry');const state=read();const revision=this.journal.revision;
    if(!state.images[revision]){state.images[revision]={image:`${this.config.registry}@sha256:${revision}`,digest:`sha256:${revision}`,evidence:{transport:'controlled registry double'}};save(state);fail('registry');}
    await this.complete('registry',state.images[revision]);
  },
  async deploy(this:Publisher):Promise<void>{
    await this.intent('deployment');const state=read();const revision=this.journal.revision;
    if(!state.deployments[revision]){state.deployments[revision]={identity:revision,transport:'controlled Cloudflare double'};save(state);fail('deployment');}
    await this.complete('deployment',state.deployments[revision]);
  },
  async validatePublic(this:Publisher):Promise<Record<string,unknown>>{
    await this.intent('publicValidation');fail('beforePublicValidation');const state=read();state.validations[this.journal.revision]=(state.validations[this.journal.revision]??0)+1;save(state);fail('publicValidation');
    const result={identityVerified:true,readiness:'UP',transport:'controlled public validation double'};await this.complete('publicValidation',result);return result;
  }
});
process.exitCode=await main(process.argv.slice(3));

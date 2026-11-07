import { accounts } from '../shared/accounts.js';
import { object, requireFormat, string } from '../shared/records.js';
import type { ScenarioConfig } from './contracts.js';

export function validateScenario(slug:string,value:unknown,repository:string):ScenarioConfig {
  requireFormat(value);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid scenario');
  const launcherCommit=string(value.launcherCommit),image=string(value.image),devcontainerPath=string(value.devcontainerPath),provenanceSha256=string(value.provenanceSha256),revision=string(value.revision);
  if(!/^[a-f0-9]{40}$/.test(launcherCommit)||!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image)||value.repository!==repository||devcontainerPath!==`.devcontainer/${slug}/devcontainer.json`||!/^[a-f0-9]{64}$/.test(provenanceSha256)||!/^[a-f0-9]{64}$/.test(revision))throw new Error('Invalid immutable scenario');
  return {format:value.format,repository,launcherCommit,image,devcontainerPath,provenanceSha256,revision,accounts:accounts(value.accounts),...(value.provenancePath===undefined?{}:{provenancePath:string(value.provenancePath)})};
}
export function catalogRecord(value:unknown):Record<string,unknown>{requireFormat(value);return object(value.scenarios);}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateScenario } from '../src/catalog.js';
import { object,PreviewError,readRecord,string,invokedDirectly } from '../preview/state.js';

export async function check(directory:string=process.cwd()):Promise<void>{
  const config=object(JSON.parse(await readFile(join(directory,'wrangler.jsonc'),'utf8'))),vars=object(config.vars);
  if(vars.LAUNCH_ENABLED!=='true')throw new PreviewError('Launch is disabled; complete initial installation and configured access before deployment.');
  const catalog=object((await readRecord(join(directory,'catalog/scenarios.json'))).scenarios);
  if(!Object.keys(catalog).length)throw new PreviewError('Publish a private image and pin a scenario before deployment.');
  for(const [slug,item]of Object.entries(catalog))validateScenario(slug,item,string(vars.GITHUB_REPOSITORY));
  console.log('Pinned catalog validated. Financial verification is recorded only during initial setup.');
}
if(await invokedDirectly(import.meta.url)){try{await check();}catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Invalid release configuration; no deployment attempted.');process.exitCode=1;}}

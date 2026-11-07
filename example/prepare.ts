import { cp, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ROOT, REPOSITORIES } from '../preview/capture.js';
import { exists, inventory, object, PreviewError, privateDir, readRecord, run, sha, string, writeRecord } from '../preview/state.js';

export async function prepare(destinationInput:string):Promise<void>{
  const destination=resolve(destinationInput);if(await exists(destination))throw new PreviewError('Example destination must not exist. Choose a new empty location.');
  const root=join(ROOT,'example');const lock=await readRecord(join(root,'sources.json'));const pins=object(lock.sources);
  if(Object.keys(pins).length!==3)throw new PreviewError('Example sources must pin exactly three applications.');
  await privateDir(destination);
  for(const name of REPOSITORIES){
    const source=object(pins[name]);const url=string(source.url);const commit=string(source.commit);
    if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url)||!/^[a-f0-9]{40}$/.test(commit))throw new PreviewError('Example requires immutable public application sources.');
    await run(['git','-c','credential.helper=','clone','--no-checkout',url,join(destination,name)],{timeout:1800,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    await run(['git','-C',join(destination,name),'checkout','--detach',commit]);
  }
  const state=await privateDir(join(destination,'.preview'));await cp(join(root,'media'),join(destination,'media'),{recursive:true});
  const backend=join(destination,'enois-backend');
  await run(['./mvnw','-B','-Dmaven.test.skip=true','package'],{cwd:backend,timeout:1800,logPath:join(state,'backend-build.log')});
  const extracted=join(state,'backend');const jar=join(backend,'target/rede-0.0.1-SNAPSHOT.jar');
  await run(['java','-Djarmode=tools','-jar',jar,'extract','--destination',extracted,'--application-filename','rede.jar']);
  const classes=await privateDir(join(state,'tools'));const classpath=`${extracted}/lib/*`;
  await run(['javac','-cp',classpath,'-d',classes,join(root,'ExampleSeed.java'),join(root,'VerifyExample.java')]);
  await privateDir(join(state,'data'));
  await run(['java','-cp',`${classes}:${classpath}`,'ExampleSeed',join(state,'data/rede'),join(backend,'src/main/resources/db/migration'),join(root,'seed.sql')],{timeout:600,logPath:join(state,'seed.log')});
  const h2=(await readdir(join(extracted,'lib'))).find(name=>/^h2-.*\.jar$/.test(name));if(!h2)throw new PreviewError('Packaged H2 driver missing.');
  const observed=object(JSON.parse((await run(['java','-cp',`${classes}:${classpath}`,'VerifyExample',join(state,'data/rede'),join(state,'canonical-data.txt')])).toString()));
  const service={database:join(state,'data/rede.mv.db'),jar,cwd:backend,port:18081,pidfile:join(state,'backend.pid'),log:join(state,'backend.log'),environmentFile:join(state,'service-environment.json')};
  await writeRecord(service.environmentFile,{environment:{REDE_SECURITY_ENCRYPTION_KEY:randomBytes(32).toString('base64')}});await writeRecord(join(state,'service.json'),service);
  const commands:Record<string,unknown>=Object.fromEntries(['identity','status','start','stop','released','ready'].map(action=>[action,[process.execPath,join(ROOT,'dist/preview/service.js'),join(state,'service.json'),action]]));
  commands.expectedIdentity=service.database;commands.timeout=120;
  await writeRecord(join(state,'config.json'),{workspace:destination,state:join(state,'publication'),repositories:Object.fromEntries(REPOSITORIES.map(name=>[name,join(destination,name)])),database:service.database,h2Jar:join(extracted,'lib',h2),service:commands,media:[{root:join(destination,'media'),url:'/example.local/'}],accounts:[{id:'example_lia',email:'lia@enois.invalid',label:'Lia · autora'},{id:'example_rui',email:'rui@enois.invalid',label:'Rui · leitor'}],repository:'YOUR_OWNER/YOUR_PRIVATE_LAUNCHER',branch:'YOUR_BRANCH',registry:'ghcr.io/YOUR_OWNER/YOUR_PRIVATE_IMAGE',origin:'https://YOUR_WORKER.workers.dev',cloudflareAccountId:'YOUR_ACCOUNT_ID',toolCommit:'YOUR_FULL_PUBLIC_TOOL_COMMIT'});
  await writeRecord(join(destination,'example-manifest.json'),{sources:pins,media:await inventory(join(destination,'media')),observed,canonicalDataSha256:await sha(join(state,'canonical-data.txt')),recipeSha256:await sha(join(root,'seed.sql'))});
  console.log(`Fictional workspace prepared at ${destination}. Configure existing private infrastructure in .preview/config.json, then run enois-preview setup --config ${join(state,'config.json')}. No preview was published.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{if(process.argv.length!==3||!process.argv[2])throw new PreviewError('Usage: npm run example:prepare -- /ABSOLUTE/NEW_WORKSPACE');await prepare(process.argv[2]);}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Example preparation failed; inspect private workspace diagnostics.');process.exitCode=1;}
}

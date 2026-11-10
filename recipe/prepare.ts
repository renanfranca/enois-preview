import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { accounts } from '../preview/config.js';
import { invokedDirectly, object, PreviewError, readRecord, string } from '../preview/state.js';

export async function prepare(rootInput:string):Promise<void>{
  const root=resolve(rootInput);const recipe=join(root,'recipe');const backend=join(root,'sources/enois-backend');const frontend=join(root,'sources/enois-frontend');const java=join(backend,'src/main/java/com/socialcoisa/rede');
  async function replace(file:string,old:string,replacement:string):Promise<void>{
    let text:string;try{text=await readFile(file,'utf8');}catch{throw new PreviewError(`Demo recipe does not support the captured source contract: ${basename(file)}`);}
    if(!text.includes(old))throw new PreviewError(`Demo recipe does not support the captured source contract: ${basename(file)}`);
    await writeFile(file,text.replaceAll(old,()=>replacement));
  }
  const manifest=await readRecord(join(root,'runtime-manifest.json'));
  if(!Array.isArray(manifest.media))throw new PreviewError('Invalid runtime media manifest.');
  const mappings=manifest.media.map((entry:unknown)=>{const value=object(entry);const url=string(value.url);const directory=string(value.directory);const paths=Object.keys(object(value.inventory));if(!/^\/[a-zA-Z0-9._/-]+\/$/.test(url)||url.includes('//')||url.split('/').includes('..')||!/^\d+$/.test(directory)||paths.some(path=>path.startsWith('/')||path.split('/').includes('..')||/[\t\r\n]/.test(path)))throw new PreviewError('Unsafe runtime media mapping.');return {url,directory,paths};});
  await copyFile(join(recipe,'application-demo.properties'),join(backend,'src/main/resources/application-demo.properties'));
  for(const name of await readdir(join(recipe,'java')))if(name.endsWith('.java'))await copyFile(join(recipe,'java',name),join(java,'media/adapters/out/storage',name));
  for(const name of ['DevMediaStorageGateway.java','DevStorageUrlFactory.java'])await replace(join(java,'media/adapters/out/storage',name),'@Component\n','@Component\n@org.springframework.context.annotation.Profile("!demo")\n');
  await replace(join(java,'media/application/MediaService.java'),'500L * 1024L * 1024L','20L * 1024L * 1024L');
  const controller=join(java,'media/adapters/in/web/MediaStorageProxyController.java');
  await replace(controller,'\t\ttry {\n\t\t\tif (length >',`\t\ttry (var reservation = (store() instanceof com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore local ? local.reserve(objectKey, length) : (com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore.Reservation) () -> {})) {
            if (store() instanceof com.socialcoisa.rede.media.adapters.out.storage.DemoLocalStore && (contentType == null || !contentType.split(";", 2)[0].strip().equalsIgnoreCase(mime)))
                throw new ApiException(400, "MEDIA_TYPE_MISMATCH", "Tipo enviado difere do declarado.");
\t\t\tif (length >`);
  await replace(controller,'byte[] raw = request.getInputStream().readAllBytes();',`byte[] raw = request.getInputStream().readNBytes(Math.toIntExact(length + 1));
                if (raw.length != length) throw new ApiException(400, "MEDIA_SIZE_MISMATCH", "Corpo enviado difere do tamanho declarado.");`);
  await copyFile(join(recipe,'StrictMediaSanitizer.java'),join(java,'media/application/StrictMediaSanitizer.java'));
  await replace(join(java,'identity/application/EmailService.java'),'this.mailSender = mailSender;',`this.mailSender = new org.springframework.mail.javamail.JavaMailSenderImpl() {
            @Override public void send(jakarta.mail.internet.MimeMessage... messages) { /* demo: local effects only */ }
            @Override public void send(org.springframework.mail.SimpleMailMessage... messages) { /* demo */ }
        };`);
  const prefixes=[...mappings.map(mapping=>mapping.url),'/api/storage/'];
  await replace(join(frontend,'src/lib/api/media.ts'),'  const cleaned = url.replace(/%2F/g, "/");',`  const cleaned = url.replace(/%2F/g, "/");\n  if (${JSON.stringify(prefixes)}.some(prefix => cleaned.startsWith(prefix))) return cleaned;`);
  await writeFile(join(frontend,'src/lib/api/demo-media.test.ts'),'import { describe, it, expect } from "vitest";\nimport { resolveCdnUrl, withImageKitOriginal } from "./media";\ndescribe("demo same origin media", () => {\n'+prefixes.map(prefix=>`it(${JSON.stringify(prefix)}, () => { expect(resolveCdnUrl(${JSON.stringify(prefix+'image.png')})).toBe(${JSON.stringify(prefix+'image.png')}); expect(withImageKitOriginal(${JSON.stringify(prefix+'image.png')})).toBe(${JSON.stringify(prefix+'image.png')}); });\n`).join('')+'it("retains external read URLs", () => { expect(resolveCdnUrl("https://example.org/image.png")).toBe("https://example.org/image.png"); });\n});\n');
  await replace(join(frontend,'src/lib/api/client-origin.ts'),'  return import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";','  return (typeof process !== "undefined" ? process.env.DEMO_PUBLIC_ORIGIN : undefined) ?? import.meta.env.VITE_SITE_URL ?? "https://enois.ia.br";');
  await replace(join(frontend,'src/constants/account.ts'),'export const SIGNUP_OPEN = true;','export const SIGNUP_OPEN = false;');
  const auth=join(frontend,'src/routes/entrar.tsx');
  await replace(auth,'type ReactNode, useRef, useState','type ReactNode, useEffect, useRef, useState');
  await replace(auth,'function LoginForm({ onDone, onForgot }: LoginFormProps) {','function LoginForm({ onDone, onForgot }: LoginFormProps) {\n  const [demoReady, setDemoReady] = useState(false);\n  useEffect(() => setDemoReady(true), []);');
  await replace(auth,'<form onSubmit={submit}','<form method="post" onSubmit={submit}');
  const text=await readFile(auth,'utf8');const start=text.indexOf('function LoginForm(');const end=text.indexOf('function TwoFactorForm(',start);
  if(start<0||end<0)throw new PreviewError('Unsupported demo login form contract.');
  const login=text.slice(start,end).replaceAll('<form method="post" onSubmit={submit}','<form method="post" data-demo-ready={demoReady} aria-busy={!demoReady} onSubmit={submit}').replaceAll('disabled={loading}','disabled={loading || !demoReady}');
  await writeFile(auth,text.slice(0,start)+login+text.slice(end));
  await replace(join(frontend,'src/lib/api-client.legacy.test.ts'),'    vi.stubGlobal("document", { addEventListener: vi.fn() });','    vi.stubGlobal("document", { addEventListener: vi.fn() });\n    vi.stubGlobal("navigator", {});');
  const selected=accounts((await readRecord(join(root,'data/seed/accounts.json'))).accounts);
  await writeFile(join(root,'data/seed/accounts.tsv'),selected.map(account=>`${account.id}\t${account.email}\t${Buffer.from(account.label).toString('base64')}\n`).join(''),{mode:0o600});
  const packagePath=join(frontend,'package.json');const packageInfo=object(JSON.parse(await readFile(packagePath,'utf8')));object(packageInfo.dependencies)['@rede-enois/design-system']='file:../design-system.tgz';await writeFile(packagePath,JSON.stringify(packageInfo,null,2)+'\n');
  await writeFile(join(root,'media-mappings.tsv'),mappings.flatMap(mapping=>mapping.paths.map(path=>`${mapping.url}${path}\t${mapping.directory}/${path}\n`)).join(''),{mode:0o600});
  for(const name of await readdir(join(recipe,'test'))){if(!name.endsWith('.java'))continue;const source=join(recipe,'test',name);const packageName=/^package ([\w.]+);/m.exec(await readFile(source,'utf8'))?.[1];if(!packageName)throw new PreviewError('Invalid demo Java contract test.');const target=join(backend,'src/test/java',packageName.replaceAll('.','/'));await mkdir(target,{recursive:true});await copyFile(source,join(target,name));}
}
if(await invokedDirectly(import.meta.url)){
  try{if(!process.argv[2]||process.argv.length!==3)throw new PreviewError('Usage: node dist/recipe/prepare.js FROZEN_BUILD_CONTEXT');await prepare(process.argv[2]);}
  catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Demo recipe input unavailable; inspect private build diagnostics.');process.exitCode=1;}
}

import { CookieJar } from 'tough-cookie';
import { randomUUID } from 'node:crypto';
import { PreviewError } from './state.js';

export interface RequestOptions { method?: string; body?: unknown; raw?: Uint8Array; contentType?: string; range?: string }
export class Session {
  readonly cookies: CookieJar;
  readonly origin: string;
  constructor(origin: string, readonly options: { local?: boolean; slug?: string; timeout?: number } = {}) {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(options.local && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new PreviewError('Validation requires a public HTTPS origin or explicit local loopback verification.');
    this.origin = url.origin;
    this.cookies = new CookieJar(undefined, { allowSecureOnLocal: options.local === true });
  }
  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !path.startsWith('/')) throw new PreviewError('Validation paths must stay within the configured origin.');
    const headers = new Headers({ 'User-Agent': 'enois-preview/0.2.0', Origin: this.origin, 'X-Client-Origin': this.origin, 'X-CSRF-Protection': '1', 'Sec-Fetch-Site': 'same-origin' });
    const cookies = await this.cookies.getCookieString(url.href);
    const selected = this.options.slug ? `__Host-demo-scenario=${this.options.slug}` : '';
    if (selected || cookies) headers.set('Cookie', [selected, cookies].filter(Boolean).join('; '));
    const method = options.method ?? (options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET');
    if (!['GET','HEAD'].includes(method)) headers.set('Idempotency-Key', randomUUID());
    let body: string | Uint8Array | undefined;
    if (options.body !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(options.body); }
    if (options.raw !== undefined) body = options.raw;
    if (options.contentType) headers.set('Content-Type', options.contentType);
    if (options.range) headers.set('Range', options.range);
    let response: Response;
    try {
      response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout((this.options.timeout ?? 30) * 1000), ...(body === undefined ? {} : { body: typeof body === 'string' ? body : Buffer.from(body) }) });
    } catch { throw new PreviewError(`Validation ${method} ${url.pathname} did not respond through its origin.`); }
    for (const cookie of response.headers.getSetCookie()) await this.cookies.setCookie(cookie, url.href);
    if (!response.ok) {
      const mime = (response.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const kind = /^application\/(?:json|[\w.+-]+\+json)$/.test(mime) ? 'json' : mime === 'text/html' ? 'html' : mime ? 'other' : 'unspecified';
      const challenge = /tunnel/i.test(response.headers.get('WWW-Authenticate') ?? '') ? '; tunnel challenge' : '';
      await response.body?.cancel();
      throw new PreviewError(`Validation ${method} ${url.pathname} failed for HTTP ${response.status} [${kind}${challenge}]; credentials and response were omitted.`);
    }
    return response;
  }
  async json(path: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.request(path, options);
    if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;.*)?$/i.test(response.headers.get('Content-Type') ?? '')) { await response.body?.cancel(); throw new PreviewError('Application returned a non-JSON response; HTTP 200 alone is not readiness.'); }
    try { const value: unknown = await response.json(); return value; } catch { throw new PreviewError('Application returned malformed JSON.'); }
  }
}

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Journal } from './publication.js';
import { ROOT } from './capture.js';
import { canonical, object, requireFormat, run, string } from './state.js';
import { IMAGE_PREFIX_BYTES, imageType } from '../runtime/image-type.js';
import type { DecodingRow } from '../scripts/validate-decoding.js';

export interface ValidationResult {
  origin: string; localOnly: boolean; elapsedSeconds: number; readiness:'UP'; identityVerified:true;
  accounts:{id:string;authenticated:true;permissions:{admin:boolean;moderator:boolean}}[];
  media:{path:string;bytes:number;contentType:string;sha256:string;expectedContentType:string;imageClassification:'image'|'unclassified'}[];
  imageDecoding: DecodingRow[];
  externalReads:{scope:string;results:Record<string,unknown>[]};
}
export async function validate(origin:string,journal:Journal,options:{credentials?:unknown;local?:boolean;timeout?:number;evidence?:string;alive?:()=>Promise<boolean>}={}):Promise<ValidationResult>{
  const start=performance.now();const deadline=start+(options.timeout??600)*1000;
  const slug=options.local?undefined:journal.slug;
  const sessionOptions={local:options.local===true,...(slug?{slug}:{})};
  const session=new Session(origin,sessionOptions);
  if(!options.local){
    let response=await session.request(`/preview/${journal.slug}`);let status=response.status;await response.body?.cancel();
    while(status===202){
      if(performance.now()>=deadline)throw new PreviewError('Public boot timed out; resume this revision.');
      await delay(2000);response=await session.request(`/__demo/status/${journal.slug}`);status=response.status;await response.body?.cancel();
    }
    if(status!==200)throw new PreviewError('Public boot did not become ready.');
    const actual=object(await session.json('/__demo/revision'));requireFormat(actual);
    const expected=object(journal.checkpoints.configuration);const registry=object(journal.checkpoints.registry);
    for(const [key,value]of Object.entries({revision:journal.revision,image:registry.image,launcherCommit:expected.commit,provenanceSha256:expected.provenanceSha256}))if(actual[key]!==value)throw new PreviewError('Public configuration identity mismatch.');
  }else{
    for(;;){
      try{if(object(await session.json('/api/actuator/health/readiness')).status==='UP')break;}catch(error:unknown){if(!(error instanceof PreviewError))throw error;}
      if(options.alive&&!await options.alive())throw new PreviewError('Local runtime exited before readiness; inspect private runtime.log.');
      if(performance.now()>=deadline)throw new PreviewError('Local image readiness timed out.');
      await delay(1000);
    }
  }
  if(object(await session.json('/api/actuator/health/readiness')).status!=='UP')throw new PreviewError('Readiness is not UP.');
  const runtime=object(await session.json('/__demo/runtime'));requireFormat(runtime);
  if(runtime.revision!==journal.revision||runtime.dataVersion!==journal.inputs.data||canonical(runtime.commits)!==canonical(journal.inputs.commits))throw new PreviewError('Running image input identity mismatch.');
  const credentials=options.credentials??await session.json('/__demo/access.json');requireFormat(credentials);
  if(!Array.isArray(credentials.accounts)||credentials.accounts.length!==journal.inputs.dataManifest.accounts.length)throw new PreviewError('Selected account count mismatch.');
  const accountResults:ValidationResult['accounts']=[];
  for(const [index,expected]of journal.inputs.dataManifest.accounts.entries()){
    const account=object(credentials.accounts[index]);
    if(account.id!==expected.id||account.email!==expected.email||account.label!==expected.label||typeof account.password!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(account.password))throw new PreviewError('Demo account mapping mismatch.');
    const independent=new Session(origin,sessionOptions);
    const login=object(await independent.json('/api/auth/login',{body:{email:account.email,password:account.password}}));
    if(object(login.user).id!==expected.id||object(await independent.json('/api/me')).id!==expected.id)throw new PreviewError('Authenticated account identity mismatch.');
    const capabilities=object(await independent.json('/api/moderation/me'));const permission=journal.inputs.dataManifest.permissions[expected.id];
    if(!permission||capabilities.admin!==permission.admin||capabilities.moderator!==permission.moderator)throw new PreviewError('Authenticated permissions differ from the frozen selected identity.');
    const secure=new Set((await independent.cookies.getCookies(`${origin}/`)).filter(cookie=>cookie.secure&&cookie.httpOnly).map(cookie=>cookie.key));
    if(!secure.has('enois_session')||!secure.has('enois_refresh'))throw new PreviewError('Secure HttpOnly session cookies missing.');
    accountResults.push({id:expected.id,authenticated:true,permissions:permission});
  }
  const media:ValidationResult['media']=[];const imagePaths:string[]=[];
  for(const mapping of journal.inputs.dataManifest.media){
    for(const [path,expected]of Object.entries(mapping.inventory)){
      const url=mapping.url+path.split('/').map(encodeURIComponent).join('/');const response=await session.request(url);const reader=response.body?.getReader();
      const digest=createHash('sha256');let bytes=0;let prefix:Buffer=Buffer.alloc(0);
      if(reader){try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;digest.update(chunk.value);if(prefix.length<IMAGE_PREFIX_BYTES)prefix=Buffer.concat([prefix,Buffer.from(chunk.value.subarray(0,IMAGE_PREFIX_BYTES-prefix.length))]);if(bytes>expected.bytes){await reader.cancel();throw new PreviewError('Public frozen media bytes differ from the recorded inventory.');}}}finally{reader.releaseLock();}}
      if(bytes!==expected.bytes||digest.digest('hex')!==expected.sha256)throw new PreviewError('Public frozen media bytes differ from the recorded inventory.');
      const recognized=imageType(prefix);const expectedContentType=recognized??'application/octet-stream';const contentType=response.headers.get('Content-Type')??'';
      if(contentType.split(';')[0]?.trim().toLowerCase()!==expectedContentType)throw new PreviewError(`Frozen media MIME mismatch for ${url}: expected ${expectedContentType}.`);
      if(recognized)imagePaths.push(url);
      media.push({path:url,bytes,contentType,sha256:expected.sha256,expectedContentType,imageClassification:recognized?'image':'unclassified'});
    }
  }
  let decoded:unknown;
  try{decoded=JSON.parse((await run([process.execPath,join(ROOT,'dist/scripts/validate-decoding.js')],{input:JSON.stringify({origin,slug:slug??null,paths:imagePaths}),...(options.evidence?{logPath:join(options.evidence,'decoding.log')}:{})})).toString());}
  catch{throw new PreviewError('Recognized frozen image decoding failed; inspect private decoding evidence.');}
  if(!Array.isArray(decoded)||decoded.length!==2)throw new PreviewError('Image decoding evidence must cover widths 1280 and 390 exactly.');
  const imageDecoding:DecodingRow[]=[];
  for(const [index,value]of decoded.entries()){
    const row=object(value);if(row.width!==[1280,390][index]||row.mobileEmulation!==(index===1)||!Array.isArray(row.images)||row.images.length!==imagePaths.length)throw new PreviewError('Image decoding evidence does not cover the required viewports and images.');
    const images=row.images.map((entry:unknown)=>{const image=object(entry);if(typeof image.width!=='number'||!Number.isInteger(image.width)||image.width<=0||typeof image.height!=='number'||!Number.isInteger(image.height)||image.height<=0)throw new PreviewError('Image dimensions are invalid.');return {path:string(image.path),width:image.width,height:image.height};});
    if(canonical(images.map(image=>image.path).sort())!==canonical([...imagePaths].sort()))throw new PreviewError('Image decoding evidence does not cover exactly the recognized images.');
    imageDecoding.push({width:row.width as number,mobileEmulation:index===1,images});
  }
  return {origin,localOnly:options.local===true,elapsedSeconds:Math.round((performance.now()-start))/1000,readiness:'UP',identityVerified:true,accounts:accountResults,media,imageDecoding,externalReads:{scope:'captured renderable URL references; excluded from the frozen local media guarantee',results:await Promise.all(journal.inputs.dataManifest.externalReads.map(externalRead))}};
}
function publicAddress(address:string):boolean{
  if(isIP(address)===4){const [a=0,b=0,c=0]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&c===113));}
  const first=parseInt(address.split(':')[0]??'',16);return isIP(address)===6&&first>=0x2000&&first<0x4000&&!address.toLowerCase().startsWith('2001:db8:');
}
export async function externalRead(value:string):Promise<Record<string,unknown>>{
  const proof={referenceSha256:createHash('sha256').update(value).digest('hex'),origin:null as string|null,excludedFromFrozenMediaGuarantee:true};
  let url:URL;try{url=new URL(value);}catch{return {...proof,result:'unsupported URL; not requested'};}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {...proof,result:'unsupported URL; not requested'};
  proof.origin=`${url.protocol}//${url.hostname}`;
  try{
    const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))return {...proof,result:'nonpublic address; not requested'};
    const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{'User-Agent':'enois-preview-validation'}});await response.body?.cancel();
    return {...proof,result:'observed',status:response.status,contentType:response.headers.get('Content-Type')?.split(';')[0]??''};
  }catch{return {...proof,result:'unavailable'};}
}

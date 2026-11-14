import { CookieJar } from 'tough-cookie';
import { randomUUID } from 'node:crypto';
import { PreviewError } from './state.js';

export interface RequestOptions { method?: string; body?: unknown; raw?: Uint8Array; contentType?: string; range?: string }
export class Session {
  readonly cookies: CookieJar;
  readonly origin: string;
  constructor(origin: string, readonly options: { local?: boolean; slug?: string; timeout?: number; signal?: AbortSignal | undefined } = {}) {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(options.local && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new PreviewError('Validation requires a public HTTPS origin or explicit local loopback verification.');
    this.origin = url.origin;
    this.cookies = new CookieJar(undefined, { allowSecureOnLocal: options.local === true });
  }
  async request(path: string, options: RequestOptions = {}): Promise<Response> {
    this.options.signal?.throwIfAborted();
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !path.startsWith('/')) throw new PreviewError('Validation paths must stay within the configured origin.');
    const headers = new Headers({ 'User-Agent': 'enois-preview/0.3.1', Origin: this.origin, 'X-Client-Origin': this.origin, 'X-CSRF-Protection': '1', 'Sec-Fetch-Site': 'same-origin' });
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
      response = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout((this.options.timeout ?? 30) * 1000),...(this.options.signal?[this.options.signal]:[])]), ...(body === undefined ? {} : { body: typeof body === 'string' ? body : Buffer.from(body) }) });
    } catch { this.options.signal?.throwIfAborted(); throw new PreviewError(`Validation ${method} ${url.pathname} did not respond through its origin.`); }
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
    try { const value: unknown = await response.json(); return value; } catch { this.options.signal?.throwIfAborted(); throw new PreviewError('Application returned malformed JSON.'); }
  }
}

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Journal } from './publication.js';
import { ROOT } from './capture.js';
import { canonical, object, requireFormat, run, string, commandRunner } from './state.js';
import { IMAGE_PREFIX_BYTES, imageType } from '../runtime/image-type.js';
import { warn } from './warnings.js';
import type { Warning } from './warnings.js';
import type { DecodingRow } from '../scripts/validate-decoding.js';

export interface ValidationResult {
  origin: string; localOnly: boolean; elapsedSeconds: number; readiness:'UP'; identityVerified:true;
  accounts:{id:string;authenticated:true;permissions:{admin:boolean;moderator:boolean}|null;permissionsMatch:boolean;secureCookies:boolean}[];
  media:{path:string;bytes:number;contentType:string;sha256:string;expectedContentType:string;imageClassification:'image'|'unclassified';matches:boolean}[];
  imageDecoding: DecodingRow[];
  externalReads:{scope:string;results:Record<string,unknown>[]};
  /** Checks that ran and differed; they never stop validation. */
  warnings: Warning[];
}
export async function validate(origin:string,journal:Journal,options:{credentials?:unknown;local?:boolean;timeout?:number;evidence?:string;alive?:()=>Promise<boolean>;signal?:AbortSignal|undefined}={}):Promise<ValidationResult>{
  options.signal?.throwIfAborted();
  const run=commandRunner(options.signal);
  const start=performance.now();const deadline=start+(options.timeout??600)*1000;
  const slug=options.local?undefined:journal.slug;
  const sessionOptions={signal:options.signal,local:options.local===true,...(slug?{slug}:{})};
  const session=new Session(origin,sessionOptions);
  if(!options.local){
    let response=await session.request(`/preview/${journal.slug}`);let status=response.status;await response.body?.cancel();
    while(status===202){
      if(performance.now()>=deadline)throw new PreviewError('Public boot timed out; resume this revision.');
      await delay(2000,undefined,{signal:options.signal});response=await session.request(`/__demo/status/${journal.slug}`);status=response.status;await response.body?.cancel();
    }
    if(status!==200)throw new PreviewError('Public boot did not become ready.');
    const actual=object(await session.json('/__demo/revision'));requireFormat(actual);
    const expected=object(journal.checkpoints.configuration);const registry=object(journal.checkpoints.registry);
    for(const [key,value]of Object.entries({revision:journal.revision,image:registry.image,launcherCommit:expected.commit,provenanceSha256:expected.provenanceSha256}))if(actual[key]!==value)throw new PreviewError('Public configuration identity mismatch.');
  }else{
    for(;;){
      try{if(object(await session.json('/api/actuator/health/readiness')).status==='UP')break;}catch(error:unknown){options.signal?.throwIfAborted();if(!(error instanceof PreviewError))throw error;}
      if(options.alive&&!await options.alive())throw new PreviewError('Local runtime exited before readiness; inspect private runtime.log.');
      if(performance.now()>=deadline)throw new PreviewError('Local image readiness timed out.');
      await delay(1000,undefined,{signal:options.signal});
    }
  }
  if(object(await session.json('/api/actuator/health/readiness')).status!=='UP')throw new PreviewError('Readiness is not UP.');
  const runtime=object(await session.json('/__demo/runtime'));requireFormat(runtime);
  if(runtime.revision!==journal.revision||runtime.dataVersion!==journal.inputs.data||canonical(runtime.commits)!==canonical(journal.inputs.commits))throw new PreviewError('Running image input identity mismatch.');
  const credentials=options.credentials??await session.json('/__demo/access.json');requireFormat(credentials);
  if(!Array.isArray(credentials.accounts)||credentials.accounts.length!==journal.inputs.dataManifest.accounts.length)throw new PreviewError('Selected account count mismatch.');
  const observed:Warning[]=[];
  const note=(code:string,message:string)=>{if(!observed.some(item=>item.code===code&&item.message===message))observed.push({code,message});warn(code,message);};
  const accountResults:ValidationResult['accounts']=[];
  for(const [index,expected]of journal.inputs.dataManifest.accounts.entries()){
    const account=object(credentials.accounts[index]);
    if(account.id!==expected.id||account.email!==expected.email||account.label!==expected.label||typeof account.password!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(account.password))throw new PreviewError('Demo account mapping mismatch.');
    const independent=new Session(origin,sessionOptions);
    const login=object(await independent.json('/api/auth/login',{body:{email:account.email,password:account.password}}));
    if(object(login.user).id!==expected.id||object(await independent.json('/api/me')).id!==expected.id)throw new PreviewError('Authenticated account identity mismatch.');
    const permission=journal.inputs.dataManifest.permissions[expected.id];let actual:{admin:boolean;moderator:boolean}|null=null;
    try{const capabilities=object(await independent.json('/api/moderation/me'));if(typeof capabilities.admin==='boolean'&&typeof capabilities.moderator==='boolean')actual={admin:capabilities.admin,moderator:capabilities.moderator};}
    catch(error:unknown){options.signal?.throwIfAborted();if(!(error instanceof PreviewError))throw error;}
    const permissionsMatch=actual!==null&&permission!==undefined&&actual.admin===permission.admin&&actual.moderator===permission.moderator;
    if(!permissionsMatch)note('permissions-differ',`Account ${expected.id} permissions differ from the frozen record or could not be read.`);
    const secure=new Set((await independent.cookies.getCookies(`${origin}/`)).filter(cookie=>cookie.secure&&cookie.httpOnly).map(cookie=>cookie.key));
    const secureCookies=secure.has('enois_session')&&secure.has('enois_refresh');
    if(!secureCookies)note('session-cookies-missing',`Account ${expected.id} did not receive secure HttpOnly session cookies.`);
    accountResults.push({id:expected.id,authenticated:true,permissions:actual,permissionsMatch,secureCookies});
  }
  const media:ValidationResult['media']=[];const imagePaths:string[]=[];
  for(const mapping of journal.inputs.dataManifest.media){
    for(const [path,expected]of Object.entries(mapping.inventory)){
      const url=mapping.url+path.split('/').map(encodeURIComponent).join('/');
      let response:Response;
      try{response=await session.request(url);}
      catch(error:unknown){options.signal?.throwIfAborted();if(!(error instanceof PreviewError))throw error;note('media-unavailable',`Frozen media ${url} did not respond.`);continue;}
      const reader=response.body?.getReader();
      const digest=createHash('sha256');let bytes=0;let prefix:Buffer=Buffer.alloc(0);
      if(reader){try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;digest.update(chunk.value);if(prefix.length<IMAGE_PREFIX_BYTES)prefix=Buffer.concat([prefix,Buffer.from(chunk.value.subarray(0,IMAGE_PREFIX_BYTES-prefix.length))]);}}finally{reader.releaseLock();}}
      const sha256=digest.digest('hex');
      const recognized=imageType(prefix);const expectedContentType=recognized??'application/octet-stream';const contentType=response.headers.get('Content-Type')??'';
      const sameBytes=bytes===expected.bytes&&sha256===expected.sha256;const sameType=contentType.split(';')[0]?.trim().toLowerCase()===expectedContentType;
      if(!sameBytes)note('media-bytes-differ',`Frozen media ${url} bytes differ from the recorded inventory.`);
      if(!sameType)note('media-mime-differs',`Frozen media ${url} MIME differs: expected ${expectedContentType}.`);
      if(recognized&&sameBytes)imagePaths.push(url);
      media.push({path:url,bytes,contentType,sha256,expectedContentType,imageClassification:recognized?'image':'unclassified',matches:sameBytes&&sameType});
    }
  }
  const imageDecoding:DecodingRow[]=[];
  let decoded:unknown;
  try{decoded=JSON.parse((await run([process.execPath,join(ROOT,'dist/scripts/validate-decoding.js')],{input:JSON.stringify({origin,slug:slug??null,paths:imagePaths}),...(options.evidence?{logPath:join(options.evidence,'decoding.log')}:{})})).toString());}
  catch{options.signal?.throwIfAborted();note('image-decoding-skipped','Image decoding in Chromium did not run or failed; decoding was skipped. Inspect private decoding evidence.');}
  if(decoded!==undefined)try{
    if(!Array.isArray(decoded)||decoded.length!==2)throw new PreviewError('Image decoding evidence must cover widths 1280 and 390 exactly.');
    for(const [index,value]of decoded.entries()){
      const row=object(value);if(row.width!==[1280,390][index]||row.mobileEmulation!==(index===1)||!Array.isArray(row.images)||row.images.length!==imagePaths.length)throw new PreviewError('Image decoding evidence does not cover the required viewports and images.');
      const images=row.images.map((entry:unknown)=>{const image=object(entry);if(typeof image.width!=='number'||!Number.isInteger(image.width)||image.width<=0||typeof image.height!=='number'||!Number.isInteger(image.height)||image.height<=0)throw new PreviewError('Image dimensions are invalid.');return {path:string(image.path),width:image.width,height:image.height};});
      if(canonical(images.map(image=>image.path).sort())!==canonical([...imagePaths].sort()))throw new PreviewError('Image decoding evidence does not cover exactly the recognized images.');
      imageDecoding.push({width:row.width as number,mobileEmulation:index===1,images});
    }
  }catch(error:unknown){if(!(error instanceof PreviewError))throw error;imageDecoding.length=0;note('image-decoding-incomplete',error.message);}
  const externalResults=await Promise.all(journal.inputs.dataManifest.externalReads.map(value=>externalRead(value,options.signal)));
  if(externalResults.length)note('external-reads',`${externalResults.length} external URL references were observed; they are outside the frozen media guarantee.`);
  return {origin,localOnly:options.local===true,elapsedSeconds:Math.round((performance.now()-start))/1000,readiness:'UP',identityVerified:true,accounts:accountResults,media,imageDecoding,externalReads:{scope:'captured renderable URL references; excluded from the frozen local media guarantee',results:externalResults},warnings:observed};
}
function publicAddress(address:string):boolean{
  if(isIP(address)===4){const [a=0,b=0,c=0]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&c===113));}
  const first=parseInt(address.split(':')[0]??'',16);return isIP(address)===6&&first>=0x2000&&first<0x4000&&!address.toLowerCase().startsWith('2001:db8:');
}
export async function externalRead(value:string,signal?:AbortSignal):Promise<Record<string,unknown>>{
  signal?.throwIfAborted();
  const proof={referenceSha256:createHash('sha256').update(value).digest('hex'),origin:null as string|null,excludedFromFrozenMediaGuarantee:true};
  let url:URL;try{url=new URL(value);}catch{return {...proof,result:'unsupported URL; not requested'};}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {...proof,result:'unsupported URL; not requested'};
  proof.origin=`${url.protocol}//${url.hostname}`;
  try{
    const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))return {...proof,result:'nonpublic address; not requested'};
    const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(10_000),...(signal?[signal]:[])]),headers:{'User-Agent':'enois-preview-validation'}});await response.body?.cancel();
    return {...proof,result:'observed',status:response.status,contentType:response.headers.get('Content-Type')?.split(';')[0]??''};
  }catch{signal?.throwIfAborted();return {...proof,result:'unavailable'};}
}

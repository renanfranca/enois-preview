import { FORMAT, object, requireFormat, string } from '../shared/records.js';
import { validateScenario } from './catalog.js';
import { credentials as parseCredentials } from './contracts.js';
import type { Context, Environment, Credentials, ScenarioConfig, Storage, Transport } from './contracts.js';
import { GitHub, GitHubFailure } from './github.js';
import { json, message, sameOrigin } from './responses.js';
import { forwardUpload } from './upload-transport.js';

export const IDLE_MS = 600_000;
const RETRY_MS = 30_000;
const PRIVATE_COOKIE = /^(?:\.AspNet|\.?tunnel|github|__Host-demo-scenario)/i;

// Only lifecycle transitions are serialized. Streaming responses never hold this queue.
type Phase='creating'|'starting'|'ready'|'failed'|'refused'|'deleting';
export interface Lifecycle {
 format:typeof FORMAT;config:ScenarioConfig;phase:Phase;lastActivity:number;displayName:string;
 name?:string|undefined;origin?:string|undefined;portToken?:string|undefined;credentials?:Credentials|undefined;
 lastCheck?:number|undefined;failureUntil?:number|undefined;
}
export class Scenario {
 github:Pick<GitHub,'verifyConfig'|'smallestMachine'|'create'|'get'|'remove'|'find'>;
 now:()=>number;transport:Transport;private queue:Promise<unknown>;
 async state():Promise<Lifecycle|undefined>{
  const value=await this.ctx.storage.get('state');if(value===undefined)return;
  requireFormat(value);const config=object(value.config);const path=string(config.devcontainerPath);
  const slug=/^\.devcontainer\/([a-z0-9-]+)\/devcontainer\.json$/.exec(path)?.[1];if(!slug)throw new Error('Invalid stored scenario');
  const checked=validateScenario(slug,config,this.env.GITHUB_REPOSITORY);
  if(!['creating','starting','ready','failed','refused','deleting'].includes(string(value.phase))||typeof value.lastActivity!=='number'||!Number.isFinite(value.lastActivity)||typeof value.displayName!=='string')throw new Error('Invalid stored lifecycle');
  for(const key of ['name','origin','portToken'])if(value[key]!==undefined&&typeof value[key]!=='string')throw new Error('Invalid stored lifecycle');
  for(const key of ['lastCheck','failureUntil'])if(value[key]!==undefined&&(typeof value[key]!=='number'||!Number.isFinite(value[key])))throw new Error('Invalid stored lifecycle');
  const credentials=value.credentials===undefined?undefined:parseCredentials(value.credentials);
  if(value.phase==='ready'&&(!value.name||!value.origin||!value.portToken||!credentials))throw new Error('Incomplete stored ready lifecycle');
  return {...value,config:checked,credentials} as Lifecycle;
 }
  constructor(readonly ctx:Context, readonly env:Environment) {
    this.ctx = ctx; this.env = env; this.github = new GitHub(env);
    this.now = () => Date.now(); this.transport = (input, init) => fetch(input, init);
    this.queue = Promise.resolve();
  }
  serialized<T>(work:()=>Promise<T>):Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  async save(state:Lifecycle, alarm?:number):Promise<void> {
    const write = async (storage:Storage) => {
      await storage.put('state', state);
      if (alarm !== undefined) await storage.setAlarm(alarm);
    };
    if (this.ctx.storage.transaction) await this.ctx.storage.transaction(write);
    else await write(this.ctx.storage);
  }
  async remove(state:Lifecycle):Promise<boolean> {
    // Retain the identifier until deletion is confirmed; errors are retried by alarm.
    await this.save({ ...state, phase: 'deleting', portToken: undefined, credentials: undefined }, this.now() + RETRY_MS);
    let gone = false;
    try { await this.github.remove(state.name??''); }
    catch (error) { if (error instanceof GitHubFailure && error.status === 404) gone = true; else throw error; }
    if (!gone) {
      // DELETE returns 202 Accepted. A new Codespace must wait for confirmed absence.
      try { await this.github.get(state.name??''); return false; }
      catch (error) { if (!(error instanceof GitHubFailure && error.status === 404)) throw error; }
    }
    await this.ctx.storage.delete('state');
    await this.ctx.storage.deleteAlarm();
    console.info('demo_lifecycle', JSON.stringify({ event: 'deleted', name: state.name, scenario: state.config.devcontainerPath }));
    return true;
  }
  async recover(state:Lifecycle):Promise<Lifecycle> {
    if (!state.name) {
      const matches = await this.github.find(state.config, state.displayName);
      if (matches.length > 1) throw new Error('Ambiguous creation requires operator review');
      if (!matches.length) {
        await this.ctx.storage.setAlarm(this.now() + RETRY_MS);
        return state; // Never repeat a POST whose result may have been lost.
      }
      state = { ...state, name: matches[0]!.name, phase: 'starting' };
      await this.save(state, Math.max(this.now() + 1000, state.lastActivity + IDLE_MS));
    }
    return state;
  }
  async expire(state:Lifecycle|undefined):Promise<Lifecycle|undefined> {
    if (!state) return;
    if (state.phase === 'refused') {
      if (this.now() < (state.failureUntil ?? 0)) return state;
      await this.ctx.storage.delete('state');
      await this.ctx.storage.deleteAlarm();
      return;
    }
    state = await this.recover(state);
    if (state.name && (state.phase === 'deleting' || this.now() >= state.lastActivity + IDLE_MS)) {
      if (await this.remove(state)) return;
      return { ...state, phase: 'deleting', portToken: undefined, credentials: undefined };
    }
    return state;
  }
  async launch(config:ScenarioConfig):Promise<Lifecycle> {
    let state = await this.expire(await this.state());
    if (state) {
      if (state.phase === 'starting' && this.now() - (state.lastCheck ?? 0) >= 10_000) {
        try {
          const remote = await this.github.get(state.name??'');
          state = { ...state, lastCheck: this.now() };
          if (['Failed', 'Unavailable', 'Shutdown', 'Archived', 'Deleted'].includes(remote.state??'')) state.phase = 'failed';
          await this.save(state, state.lastActivity + IDLE_MS);
        } catch (error) {
          if (error instanceof GitHubFailure && error.status === 404) {
            await this.ctx.storage.delete('state');
            await this.ctx.storage.deleteAlarm();
            return { ...state, phase: 'failed' };
          }
          throw error;
        }
      }
      return state;
    }
    if (this.env.LAUNCH_ENABLED !== 'true' || !this.env.GITHUB_TOKEN || !this.env.CALLBACK_SECRET) throw new Error('Launch disabled');
    await this.github.verifyConfig(config);
    const machine = await this.github.smallestMachine(config);
    state = { format:FORMAT, config, phase: 'creating', lastActivity: this.now(), displayName: `demo-${crypto.randomUUID()}` };
    await this.save(state, this.now() + RETRY_MS);
    try {
      const created = await this.github.create(config, machine, state.displayName);
      if (!/^[a-z0-9-]+$/.test(created.name)) throw new Error('Invalid codespace name');
      state = { ...state, name: created.name, phase: 'starting' };
      await this.save(state, state.lastActivity + IDLE_MS);
      console.info('demo_lifecycle', JSON.stringify({ event: 'created', name: state.name, scenario: config.devcontainerPath, commit: config.launcherCommit }));
      return state;
    } catch (error) {
      if (error instanceof GitHubFailure && [400, 401, 403, 404, 422].includes(error.status)) {
        // Definite refusal: keep a failure cooldown; do not retry on each page refresh.
        await this.save({ ...state, phase: 'refused', failureUntil: this.now() + IDLE_MS }, this.now() + IDLE_MS);
        console.info('demo_lifecycle', JSON.stringify({event:'creation_refused',status:error.status,reason:error.reason,scenario:config.devcontainerPath}));
      }
      throw error;
    }
  }
  async alarm() {
    return this.serialized(async () => {
      const state = await this.state();
      if (!state) return;
      try {
        if (state.phase === 'refused') {
          await this.ctx.storage.delete('state');
          await this.ctx.storage.deleteAlarm();
          return;
        }
        const remaining = await this.expire(state);
        if (remaining?.name) await this.ctx.storage.setAlarm(remaining.phase === 'deleting' ? this.now() + RETRY_MS : remaining.lastActivity + IDLE_MS);
      } catch {
        await this.ctx.storage.setAlarm(this.now() + RETRY_MS);
        throw new Error('Scenario cleanup failed; retry scheduled');
      }
    });
  }
  async fetch(request:Request):Promise<Response> {
    const action = request.headers.get('X-Demo-Action');
    try {
      if (action === 'launch') {
        const raw=object(await request.json());const slug=/^\.devcontainer\/([a-z0-9-]+)\/devcontainer\.json$/.exec(string(raw.devcontainerPath))?.[1];if(!slug)throw new Error('Invalid scenario');const config=validateScenario(slug,raw,this.env.GITHUB_REPOSITORY);
        const state = await this.serialized(() => this.launch(config));
        return json({ phase: state.phase });
      }
      if (action === 'register') {
        const body = object(await request.json());
        return await this.serialized(async () => {
          let state = await this.state();
          if (!state || state.phase === 'refused') return message('Ambiente não aguardado.', 409);
          state = await this.recover(state);
          if (state.name !== body.name || this.now() >= state.lastActivity + IDLE_MS) return message('Ambiente não aguardado.', 409);
          const remote = await this.github.get(state.name??'');
          // GitHub reports detached SHA checkouts as HEAD. This name was recorded
          // from our creation request, whose ref is the catalog's immutable SHA.
          const expectedRef = remote.git_status?.ref === state.config.launcherCommit || remote.git_status?.ref === 'HEAD';
          if (remote.owner?.login !== this.env.GITHUB_OWNER || remote.repository?.full_name !== this.env.GITHUB_REPOSITORY ||
              !expectedRef ||
              !/^[a-z0-9-]+$/.test(state.name??'') || body.domain !== 'app.github.dev' ||
              typeof body.portToken !== 'string' || body.portToken.length < 20) return message('Registro recusado.', 403);
          if (remote.machine?.cpus !== 2) console.log(`Codespace ${state.name} reports ${remote.machine?.cpus ?? 'unknown'} CPUs; registering anyway.`);
          let credentials:Credentials;
          try { credentials=parseCredentials(body.credentials); } catch {return message('Credenciais inválidas.',403);}
          if(credentials.accounts.length!==state.config.accounts.length||credentials.accounts.some((account,index)=>{const expected=state.config.accounts[index];return !expected||account.id!==expected.id||account.email!==expected.email||account.label!==expected.label;}))return message('Credenciais inválidas.',403);
          const origin = `https://${state.name}-3000.${body.domain}`;
          const health = await this.transport(`${origin}/api/actuator/health/readiness`, {
            redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'X-Github-Token': body.portToken },
          });
          // Spring Actuator uses application/vnd.spring-boot.actuator.v3+json.
          const jsonHealth = /^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(health.headers.get('content-type') ?? '');
          if (!health.ok || !jsonHealth) return message('Aplicação indisponível.', 503);
          const healthData = object(await health.json());
          if (healthData.status !== 'UP') return message('Aplicação indisponível.', 503);
          await this.save({ ...state, phase: 'ready', origin, portToken: body.portToken, credentials }, state.lastActivity + IDLE_MS);
          console.info('demo_lifecycle', JSON.stringify({ event: 'ready', name: state.name, scenario: state.config.devcontainerPath }));
          return json({ registered: true });
        });
      }
      const state = await this.serialized(async () => {
        const current = await this.state();
        if (current?.phase === 'refused') return current;
        return this.expire(current);
      });
      if (action === 'status') return json({ phase: state?.phase ?? 'expired' });
      if (!state || state.phase !== 'ready') return message('Demonstração encerrada ou iniciando. Abra novamente o link do cenário.', 410);
      if (action === 'credentials') return json(state.credentials);
      if (action === 'activity') {
        if (request.method !== 'POST' || !sameOrigin(request) || request.headers.get('X-Demo-Activity') !== '1') return message('Atividade recusada.', 403);
        return await this.serialized(async () => {
          const latest = await this.state();
          if (latest?.phase !== 'ready' || this.now() >= latest.lastActivity + IDLE_MS) return message('Demonstração encerrada.', 410);
          latest.lastActivity = this.now();
          await this.save(latest, latest.lastActivity + IDLE_MS);
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        });
      }
      if (action !== 'proxy') return message('Rota desconhecida.', 404);
      return await this.proxy(request, state);
    } catch {
      return message('Demonstração indisponível. Verifique acesso, imagem e franquia gratuita. Nenhum plano será contratado.');
    }
  }
  async proxy(request:Request, state:Lifecycle):Promise<Response> {
    const url = new URL(request.url);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) return message('Origem recusada.', 403);
    if(!state.origin||!state.portToken)throw new Error('Missing private forwarding identity');
    const target = new URL(url.pathname + url.search, state.origin);
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (/^(?:x-demo-|x-github-|x-tunnel-|x-forwarded-|cf-|sec-fetch-)/i.test(key) || ['authorization', 'host', 'forwarded'].includes(key)) headers.delete(key);
    }
    const cookies = (headers.get('Cookie') ?? '').split(';').map(s => s.trim()).filter(s => s && !PRIVATE_COOKIE.test(s));
    if (cookies.length) headers.set('Cookie', cookies.join('; '));
    else headers.delete('Cookie');
    headers.set('X-Github-Token', state.portToken);
    // The visitor is already entering our catalogued application. Avoid serving
    // the tunnel's interstitial HTML instead of the application's login page.
    headers.set('X-Tunnel-Skip-AntiPhishing-Page', '1');
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');
    // Keep the original Origin, Referer and application CSRF headers.
    const fragmented = request.method === 'PUT' &&
      /^\/api\/storage\/uploads\/[a-f0-9-]+\/media_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(url.pathname) && Number(request.headers.get('Content-Length'))>8_388_608;
    const response = fragmented ? await forwardUpload(request,state.origin,headers,this.transport,this.env.CALLBACK_SECRET??'') : await this.transport(target, {
      method: request.method, headers, ...(['GET','HEAD'].includes(request.method)?{}:{body:request.body}),
      redirect: 'manual', signal: AbortSignal.timeout(30_000), duplex: 'half',
    });
    if (response.status === 401 && response.headers.get('WWW-Authenticate')?.toLowerCase().includes('tunnel')) {
      // Diagnose only with a read. Never retry a visitor's write after an
      // ambiguous response, and never confuse infrastructure with bad passwords.
      let healthStatus:number|null = null;
      try {
        const probe = await this.transport(new URL('/api/actuator/health/readiness', state.origin), {
          redirect:'manual', signal:AbortSignal.timeout(10_000), headers:{'X-Github-Token':state.portToken},
        });
        healthStatus = probe.status;
        await probe.body?.cancel();
      } catch { /* bounded diagnostic, no credentials or response bodies */ }
      console.info('demo_lifecycle', JSON.stringify({event:'private_port_authentication_failed', scenario:state.config.devcontainerPath, healthStatus}));
      return message('Autenticação da porta privada indisponível. A publicação precisa de recuperação.', 502);
    }
    const outgoing = new Headers(response.headers);
    const location = outgoing.get('Location');
    if (location) {
      const destination = new URL(location, target);
      if (destination.origin === state.origin) outgoing.set('Location', url.origin + destination.pathname + destination.search + destination.hash);
      else if (destination.origin !== url.origin) return message('O encaminhamento da demonstração está indisponível.', 502);
    }
    const setCookies = response.headers.getSetCookie();
    outgoing.delete('Set-Cookie');
    for (const cookie of setCookies) {
      // Never expose GitHub's tunnel session cookies to the visitor.
      if (PRIVATE_COOKIE.test(cookie)) continue;
      let value = cookie.replace(/;\s*Domain=[^;]+/ig, '');
      if (!/;\s*Secure(?:;|$)/i.test(value)) value += '; Secure';
      outgoing.append('Set-Cookie', value);
    }
    outgoing.delete('x-github-token'); outgoing.delete('authorization');
    outgoing.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers: outgoing });
  }
}

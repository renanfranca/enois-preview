import catalog from '../catalog/scenarios.json' with { type: 'json' };
import { validateScenario } from './catalog.mjs';
import { message, page, credentialsPage } from './responses.mjs';
export { Scenario } from './scenario.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function createWorker(scenarios) {
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        if (url.protocol !== 'https:' && url.hostname !== 'localhost') return message('HTTPS obrigatório.', 400);
        const preview = /^\/preview\/([a-z0-9-]+)\/?$/.exec(url.pathname);
        const status = /^\/__demo\/status\/([a-z0-9-]+)\/?$/.exec(url.pathname);
        if (url.search && (preview || url.pathname.startsWith('/__demo/'))) return message('Parâmetros não são aceitos no lançador.', 400);
        let slug;
        if (preview) slug = preview[1];
        else if (status) slug = status[1];
        else if (url.pathname === '/__demo/register') {
          if (request.method !== 'POST' || !env.CALLBACK_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CALLBACK_SECRET}`) return message('Registro recusado.', 403);
          if (Number(request.headers.get('Content-Length')) > 16_384) return message('Registro inválido.', 413);
          const body = await request.clone().json();
          slug = body.slug;
        } else {
          slug = /(?:^|;\s*)__Host-demo-scenario=([a-z0-9-]+)(?:;|$)/.exec(request.headers.get('Cookie') ?? '')?.[1];
        }
        if (!slug || !Object.hasOwn(scenarios, slug)) return page(404, 'Cenário desconhecido. Use o link recebido.');
        const config = validateScenario(slug, scenarios[slug], env.GITHUB_REPOSITORY);
        if (url.pathname === '/__demo/revision' && request.method === 'GET') return Response.json({ ...config, catalogSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(scenarios)))))].map(byte => byte.toString(16).padStart(2, '0')).join('') }, { headers: { 'Cache-Control': 'no-store' } });
        const object = env.SCENARIOS.get(env.SCENARIOS.idFromName(slug));
        const headers = new Headers(request.headers);
        headers.delete('X-Demo-Action');
        if (preview || status) {
          if (request.method !== 'GET') return message('Método recusado.', 405);
          if (preview && env.LAUNCH_ENABLED !== 'true') return page(503, 'Demonstração indisponível até a verificação da franquia gratuita e dos acessos.');
          headers.set('X-Demo-Action', preview ? 'launch' : 'status');
          const result = await object.fetch(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(config) }));
          if (!result.ok) return page(503, 'Não foi possível iniciar. Verifique acesso, imagem e franquia gratuita. Nenhum plano será contratado.');
          const data = await result.json();
          if (data.phase === 'refused') return page(503, 'O GitHub recusou a criação. Verifique os acessos e a franquia gratuita. Tente novamente em dez minutos.');
          if (data.phase === 'failed') return page(503, 'O ambiente não iniciou. Verifique a imagem privada, os acessos e a configuração do cenário.');
          if (data.phase === 'expired') return page(410, `O ambiente foi encerrado. <a href="/preview/${slug}">Iniciar novamente a demonstração</a>.`);
          if (data.phase !== 'ready') return page(202, 'Preparando o cenário. Esta página será atualizada automaticamente.', `/__demo/status/${slug}`);
          headers.set('X-Demo-Action', 'credentials');
          const credentials = await object.fetch(new Request(request.url, { headers }));
          if (!credentials.ok) return credentials;
          const accessPage = credentialsPage(await credentials.json());
          const resultHeaders = new Headers(accessPage.headers);
          resultHeaders.append('Set-Cookie', `__Host-demo-scenario=${slug}; Path=/; Secure; HttpOnly; SameSite=Lax`);
          const selected = /(?:^|;\s*)__Host-demo-scenario=([a-z0-9-]+)(?:;|$)/.exec(request.headers.get('Cookie') ?? '')?.[1];
          if (selected !== slug) {
            for (const cookie of ['enois_session', 'enois_refresh']) resultHeaders.append('Set-Cookie', `${cookie}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
          }
          return new Response(accessPage.body, { status: accessPage.status, headers: resultHeaders });
        }
        headers.set('X-Demo-Action', url.pathname === '/__demo/register' ? 'register' : url.pathname === '/__demo/activity' ? 'activity' : ['/__demo/credentials', '/__demo/access.json'].includes(url.pathname) ? 'credentials' : 'proxy');
        const result = await object.fetch(new Request(request, { headers }));
        if (url.pathname === '/__demo/credentials' && result.ok) return credentialsPage(await result.json());
        return result;
      } catch {
        return message('Configuração ou serviço de demonstração indisponível.');
      }
    },
  };
}

export default createWorker(catalog);

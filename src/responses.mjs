export function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}
export function message(text, status = 503) { return json({ error: text }, status); }
export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin &&
    !['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'));
}
export function page(status, text, refreshPath) {
  return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refreshPath ? `<meta http-equiv="refresh" content="5;url=${refreshPath}">` : ''}<title>Demonstração Énóis</title><body><main style="max-width:36rem;margin:15vh auto;padding:1rem;font:1.15rem system-ui"><h1>Demonstração Énóis</h1><p>${text}</p></main></body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
  });
}

export function credentialsPage(credentials) {
  const accounts = credentials?.accounts ?? (credentials?.email ? [credentials] : []);
  if (!accounts.length) return page(503, 'Credenciais ainda indisponíveis. Aguarde a preparação do cenário.');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const entries = accounts.map(account => `<section><h2>${escape(account.label ?? 'Conta de demonstração')}</h2><strong>Usuário:</strong> <code>${escape(account.email)}</code><br><strong>Senha:</strong> <code style="overflow-wrap:anywhere">${escape(account.password)}</code></section>`).join('');
  return page(200, `Este cenário é compartilhado. Use um dos acessos abaixo para entrar.${entries}<p>As senhas mudam quando um novo ambiente é iniciado. Depois de dez minutos sem interação, o ambiente e as alterações são apagados.</p><a href="/entrar?tab=login">Entrar na demonstração</a>`);
}

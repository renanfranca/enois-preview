import { PreviewError, run } from './state.js';

export class RemoteFailure extends PreviewError {
  constructor(readonly status: number) { super(`Remote request failed (${status}); no paid fallback attempted.`); }
}
export async function request(url: string, method = 'GET', body?: unknown, headers: Record<string,string> = {}, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...headers }, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(30_000),...(signal?[signal]:[])]), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { signal?.throwIfAborted(); throw new PreviewError('Remote outcome ambiguous; reconcile the recorded intent before retrying.'); }
  if (!response.ok) { await response.body?.cancel(); throw new RemoteFailure(response.status); }
  return response;
}
export class GitHub {
  private token: string | undefined;
  constructor(readonly repository: string, readonly signal?: AbortSignal) {}
  async credentials(): Promise<string> {
    this.token ??= (await run(['gh','auth','token'],{signal:this.signal})).toString().trim(); return this.token;
  }
  async call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    this.signal?.throwIfAborted();
    const response = await request(`https://api.github.com/repos/${this.repository}/${path}`,method,body,{ Authorization: `Bearer ${await this.credentials()}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'enois-preview' },this.signal);
    if (response.status === 204 || method === 'DELETE') { await response.body?.cancel(); return null; }
    const result: unknown = await response.json(); return result;
  }
  async optional(path: string): Promise<unknown | null> {
    try { return await this.call(path); } catch (error: unknown) { if (error instanceof RemoteFailure && error.status === 404) return null; throw error; }
  }
}

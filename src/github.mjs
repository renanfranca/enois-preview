export class GitHubFailure extends Error {
  constructor(status, reason='UNCLASSIFIED') { super(`GitHub ${status} (${reason})`); this.status = status; this.reason = reason; }
}

export function failureReason(body) {
  const message=typeof body?.message==='string'?body.message:'';
  if(/rate limit/i.test(message))return 'RATE_LIMIT';
  if(/billing|quota|spending|included usage|usage limit/i.test(message))return 'QUOTA_OR_BILLING';
  if(/maximum|max number|too many|concurrent|active codespaces|running codespaces/i.test(message))return 'CONCURRENCY_LIMIT';
  if(/not accessible|permission|bad credentials/i.test(message))return 'ACCESS';
  return 'UNCLASSIFIED';
}

export class GitHub {
  constructor(env, transport = (input, init) => fetch(input, init)) { this.env = env; this.transport = transport; }
  async request(path, method = 'GET', body) {
    const response = await this.transport(`https://api.github.com${path}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'enois-demo-launcher',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let body;
      try { body=await response.json(); } catch { /* never persist an error body */ }
      throw new GitHubFailure(response.status,failureReason(body));
    }
    return response.status === 204 || method === 'DELETE' ? null : response.json();
  }
  async smallestMachine(config) {
    const data = await this.request(`/repos/${config.repository}/codespaces/machines?ref=${config.launcherCommit}`);
    const machines = data.machines.filter(m => m.cpus === 2).sort((a, b) => a.memory_in_bytes - b.memory_in_bytes);
    if (!machines.length) throw new Error('No two core machine available');
    return machines[0].name;
  }
  async verifyConfig(config) {
    const data = await this.request(`/repos/${config.repository}/contents/${config.devcontainerPath}?ref=${config.launcherCommit}`);
    const text = atob(data.content.replace(/\s/g, ''));
    const dev = JSON.parse(text);
    if (dev.image !== config.image || dev.overrideCommand !== true || !dev.forwardPorts?.includes(3000)) throw new Error('Launcher configuration mismatch');
  }
  create(config, machine, displayName) {
    return this.request(`/repos/${config.repository}/codespaces`, 'POST', {
      ref: config.launcherCommit, machine, devcontainer_path: config.devcontainerPath,
      display_name: displayName, idle_timeout_minutes: 240, retention_period_minutes: 0,
      multi_repo_permissions_opt_out: true,
    });
  }
  get(name) { return this.request(`/user/codespaces/${encodeURIComponent(name)}`); }
  remove(name) { return this.request(`/user/codespaces/${encodeURIComponent(name)}`, 'DELETE'); }
  async find(config, displayName) {
    const found = [];
    for (let page = 1; ; page++) {
      const data = await this.request(`/repos/${config.repository}/codespaces?per_page=100&page=${page}`);
      found.push(...data.codespaces.filter(c => c.display_name === displayName));
      if (data.codespaces.length < 100) return found;
    }
  }
}

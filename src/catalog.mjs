export function validateScenario(slug, item, repository) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !item) throw new Error('Invalid scenario');
  if (!/^[a-f0-9]{40}$/.test(item.launcherCommit)) throw new Error('Unpinned launcher');
  if (!/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(item.image)) throw new Error('Unpinned image');
  if (item.repository !== repository || item.devcontainerPath !== `.devcontainer/${slug}/devcontainer.json`) throw new Error('Invalid launcher');
  if (!/^[a-f0-9]{64}$/.test(item.provenanceSha256)) throw new Error('Missing provenance');
  if (item.revision !== undefined) {
    if (item.uploadTransport !== undefined && item.uploadTransport !== true) throw new Error('Invalid upload transport');
    if (!/^[a-f0-9]{64}$/.test(item.revision) || !Array.isArray(item.accounts) || !item.accounts.length || item.accounts.length > 20) throw new Error('Invalid revision accounts');
    const ids = new Set(), emails = new Set();
    for (const account of item.accounts) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(account.id) || !/^[a-z0-9._-]+@enois\.invalid$/.test(account.email) ||
          typeof account.label !== 'string' || account.label.length < 1 || account.label.length > 100 || ids.has(account.id) || emails.has(account.email)) throw new Error('Invalid revision identity');
      ids.add(account.id); emails.add(account.email);
    }
  }
  return item;
}

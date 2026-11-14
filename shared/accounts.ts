import { object, PreviewError, string } from './records.js';
export interface Account { id: string; email: string; label: string }
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
/** At least one account. A missing email becomes a unique disposable login `account<N>@enois.invalid`. */
export function accounts(value: unknown): Account[] {
  if (!Array.isArray(value) || value.length < 1) throw new PreviewError('Select at least one existing account.');
  const parsed = value.map((entry: unknown) => {
    const item = object(entry); const id = string(item.id); const label = string(item.label);
    const email = item.email === undefined ? undefined : string(item.email);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || label.length < 1 || label.length > 100) throw new PreviewError('Accounts require a stable id and a label.');
    if (email !== undefined && (email.length > 254 || !EMAIL.test(email))) throw new PreviewError('Account emails must be valid addresses.');
    return { id, email, label };
  });
  const used = new Set(parsed.flatMap(account => account.email === undefined ? [] : [account.email.toLowerCase()]));
  let next = 1;
  const result = parsed.map(account => {
    if (account.email !== undefined) return { id: account.id, email: account.email, label: account.label };
    while (used.has(`account${next}@enois.invalid`)) next++;
    const email = `account${next}@enois.invalid`; used.add(email);
    return { id: account.id, email, label: account.label };
  });
  if (new Set(result.map(a => a.id)).size !== result.length || new Set(result.map(a => a.email.toLowerCase())).size !== result.length) throw new PreviewError('Select distinct accounts and demo logins.');
  return result;
}

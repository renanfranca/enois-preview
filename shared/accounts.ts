import { object, PreviewError, string } from './records.js';
export interface Account { id: string; email: string; label: string }
export function accounts(value: unknown): Account[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new PreviewError('Select one to twenty existing accounts.');
  const result = value.map((entry: unknown) => {
    const item = object(entry); const id = string(item.id); const email = string(item.email); const label = string(item.label);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^[a-z0-9._-]+@enois\.invalid$/.test(email) || label.length < 1 || label.length > 100) throw new PreviewError('Accounts require stable id, label and disposable @enois.invalid email.');
    return { id, email, label };
  });
  if (new Set(result.map(a => a.id)).size !== result.length || new Set(result.map(a => a.email)).size !== result.length) throw new PreviewError('Select distinct accounts and demo logins.');
  return result;
}

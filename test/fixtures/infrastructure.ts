#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const executable = basename(process.argv[1] ?? '');
if (process.env.FIXTURE_PREFLIGHT_LOG) appendFileSync(process.env.FIXTURE_PREFLIGHT_LOG, `${executable} ${process.argv.slice(2).join(' ')}\n`);
if (executable === 'gh') {
  const endpoint = process.argv[3] ?? '';
  if (endpoint.startsWith('repos/')) console.log(JSON.stringify({ private: true, permissions: { push: true } }));
  else if (endpoint.startsWith('users/') && !endpoint.includes('/packages/')) console.log('{"type":"User"}');
  else console.log('{"visibility":"private"}');
}

import fs from 'node:fs';
// Executed in the Codespace after readiness. Tokens are never printed or baked into the image.
const required = ['DEMO_WORKER_URL', 'DEMO_CALLBACK_SECRET', 'CODESPACE_NAME', 'GITHUB_TOKEN', 'CODESPACE_PORT_FORWARDING_DOMAIN', 'DEMO_SLUG'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const origin = new URL(process.env.DEMO_WORKER_URL);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Worker origin');
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(new URL('/__demo/register', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${process.env.DEMO_CALLBACK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: process.env.DEMO_SLUG, name: process.env.CODESPACE_NAME,
        domain: process.env.CODESPACE_PORT_FORWARDING_DOMAIN, portToken: process.env.GITHUB_TOKEN,
        credentials: JSON.parse(fs.readFileSync('/tmp/demo-credentials.json', 'utf8')),
      }),
    });
    if (response.ok) { process.stdout.write('Demo private port registered\n'); process.exit(0); }
    if ([401, 403, 404].includes(response.status)) break;
  } catch { /* bounded startup retries, without response or token logging */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error('Private port registration failed');

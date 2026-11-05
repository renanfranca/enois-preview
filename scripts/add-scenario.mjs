import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [slug, image, publicOrigin, repository = 'renanfranca/enois-demo-launcher'] = process.argv.slice(2);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '') || !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(image ?? '') || !publicOrigin) throw new Error('Usage: node scripts/add-scenario.mjs SLUG ghcr.io/OWNER/IMAGE@sha256:DIGEST https://WORKER [OWNER/REPO]');
const origin = new URL(publicOrigin);
if (origin.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(origin.hostname) || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use the HTTPS Worker origin');
const directory = `.devcontainer/${slug}`;
if (fs.existsSync(directory)) throw new Error('Scenario already exists; choose a new slug for a changed snapshot');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'devcontainer.json'), JSON.stringify({
  name: `Énóis ${slug}`, image, overrideCommand: true, remoteUser: 'demo', containerUser: 'demo',
  hostRequirements: { cpus: 2, memory: '4gb', storage: '16gb' },
  forwardPorts: [3000], portsAttributes: { '3000': { label: 'Énóis demo', onAutoForward: 'silent' } },
  // Ignore SIGHUP before the shell backgrounds the service. The legacy image
  // expects the shorter variable name, so map GitHub's actual variable here.
  postStartCommand: ['nohup', 'bash', '-c', `export DEMO_SLUG=${slug}; export DEMO_PUBLIC_ORIGIN=${origin.origin}; export CODESPACE_PORT_FORWARDING_DOMAIN="$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"; /opt/render-demo/start.sh > /tmp/enois-demo.log 2>&1 < /dev/null &`],
}, null, 2) + '\n');
const provenanceSha256 = createHash('sha256').update(fs.readFileSync('catalog/provenance/snapshot.json')).digest('hex');
fs.writeFileSync(`${directory}/scenario.json`, JSON.stringify({ repository, image, devcontainerPath: `${directory}/devcontainer.json`, provenanceSha256 }, null, 2) + '\n');
console.log('Devcontainer prepared. Commit and push these files, then run pin-scenario.mjs with that commit SHA.');

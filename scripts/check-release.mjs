import fs from 'node:fs';
import { validateScenario } from '../src/catalog.mjs';

const config = JSON.parse(fs.readFileSync('wrangler.jsonc'));
if (config.vars.LAUNCH_ENABLED !== 'true') throw new Error('Launch is disabled; complete account and billing verification before deployment.');
// Initial financial confirmation belongs to `enois-preview setup`. Deployment
// never renews that confirmation, including legacy launcher deployment.
const catalog = JSON.parse(fs.readFileSync('catalog/scenarios.json'));
if (!Object.keys(catalog).length) throw new Error('Publish a private image and pin a scenario before deployment.');
for (const [slug, scenario] of Object.entries(catalog)) validateScenario(slug, scenario, config.vars.GITHUB_REPOSITORY);
console.log('Pinned catalog validated. Financial verification is recorded only during initial setup.');

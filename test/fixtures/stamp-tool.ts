import { stampInstallation } from '../../preview/installation.js';
const [root, commit] = process.argv.slice(2);
if (!root || !commit) throw new Error('Stamp fixture arguments missing');
await stampInstallation(root, commit);

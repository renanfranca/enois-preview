import { runInstaller } from '../../scripts/install-tool.js';

const archives = process.argv[2]; if (!archives) throw new Error('Missing fixture archive origin');
process.exitCode = await runInstaller(process.argv.slice(3), archives);

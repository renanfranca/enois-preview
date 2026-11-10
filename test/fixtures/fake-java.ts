import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Stands in for the owned Spring JVM. It records its start and every SIGTERM it receives under FAKE_JAVA_ROOT;
// while ROOT/hold exists it only exits after the test writes ROOT/release-<pid>.
const root = process.env.FAKE_JAVA_ROOT;
if (!root) throw new Error('FAKE_JAVA_ROOT is required');
writeFileSync(join(root, `started-${process.pid}`), process.argv.slice(2).join('\n'));
process.on('SIGTERM', () => {
  writeFileSync(join(root, `sigterm-${process.pid}`), 'received');
  if (!existsSync(join(root, 'hold'))) process.exit(0);
  setInterval(() => { if (existsSync(join(root, `release-${process.pid}`))) process.exit(0); }, 10);
});
setInterval(() => {}, 1000);

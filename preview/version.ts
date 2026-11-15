import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './project.js';

/** The `version` of the running tool's own package.json: a release version when installed from npm, 0.0.0-SNAPSHOT in a checkout. */
export const VERSION: string = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
export const USER_AGENT = `enois-preview/${VERSION}`;

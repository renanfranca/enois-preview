import { build } from 'esbuild';
import { join } from 'node:path';
import { ROOT } from '../preview/project.js';

await build({entryPoints:[join(ROOT,'runtime/activity-entry.ts')],outfile:join(ROOT,'dist/runtime/activity-bundle.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
await build({entryPoints:[join(ROOT,'runtime/reset-worker.ts')],outfile:join(ROOT,'dist/runtime/reset-worker-bundle.js'),bundle:true,format:'iife',platform:'browser',target:'es2022'});

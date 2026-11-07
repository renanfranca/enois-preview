import { capture } from '../../preview/capture.js';
import { readRecord } from '../../preview/state.js';
const file = process.argv[2];
if (!file) throw new Error('Missing capture configuration');
await capture(await readRecord(file));

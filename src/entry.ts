import catalog from '../catalog/scenarios.json' with {type:'json'};
import { createWorker } from './worker.js';
export { Scenario } from './scenario.js';
export default createWorker(catalog);

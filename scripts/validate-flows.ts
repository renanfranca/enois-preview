import { readFileSync } from 'node:fs';
import { exercise } from '../preview/exercises.js';
import { PreviewError } from '../preview/state.js';

try{const value:unknown=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(await exercise(value)));}
catch(error:unknown){console.error(error instanceof PreviewError?error.message:'Fictional HTTP exercise failed; inspect private evidence.');process.exitCode=1;}

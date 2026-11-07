import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { object, string } from '../preview/state.js';

export interface DecodingRow { width: number; mobileEmulation: boolean; images: { path: string; width: number; height: number }[] }
export async function decodeImages(value: unknown): Promise<DecodingRow[]> {
  const input=object(value);const origin=new URL(string(input.origin));
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!['https:','http:'].includes(origin.protocol))throw new Error('Invalid image origin');
  const slug=input.slug===null||input.slug===undefined?undefined:string(input.slug);
  if(slug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid image scenario');
  if(!Array.isArray(input.paths)||!input.paths.every((path:unknown)=>typeof path==='string'&&path.startsWith('/')&&new URL(path,origin).origin===origin.origin))throw new Error('Invalid image paths');
  const paths=input.paths as string[];const browser=await chromium.launch({headless:true});const result:DecodingRow[]=[];
  try{
    for(const width of [1280,390]){
      const context=await browser.newContext({viewport:{width,height:900},...(width===390?{isMobile:true,hasTouch:true}:{})});
      try{
        if(slug)await context.addCookies([{name:'__Host-demo-scenario',value:slug,url:origin.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
        const page=await context.newPage();const navigation=await page.goto(origin.origin+(slug?'/__demo/revision':'/__demo/runtime'),{waitUntil:'domcontentloaded'});
        if(!navigation?.ok())throw new Error('Image origin unavailable');
        const images:DecodingRow['images']=[];
        for(const path of paths){
          const dimensions=await page.evaluate(async pathname=>{const image=new Image();image.src=pathname;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};},path);
          if(!(dimensions.width>0&&dimensions.height>0))throw new Error('Image dimensions invalid');
          images.push({path,...dimensions});
        }
        result.push({width,mobileEmulation:width===390,images});
      }finally{await context.close();}
    }
    return result;
  }finally{await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const input:unknown=JSON.parse(readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(await decodeImages(input)));}
  catch{console.error('Recognized frozen image decoding failed; inspect private browser evidence.');process.exitCode=1;}
}

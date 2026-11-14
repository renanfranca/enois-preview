import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { credentials } from '../src/contracts.js';
import { FORMAT,object,string } from '../shared/records.js';
interface DecodedImage {path:string;width:number;height:number}
function inputRecord(){
 try{
 const raw:unknown=JSON.parse(fs.readFileSync(0,'utf8'));const value=object(raw);const origin=new URL(string(value.origin));
 if((origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Invalid origin');
 const accounts=credentials({format:FORMAT,accounts:value.accounts??[value.account]}).accounts;const wanted=object(value.account);const account=accounts.find(account=>account.id===wanted.id&&account.email===wanted.email&&account.password===wanted.password);
 if(!account)throw new Error('Missing selected account');const slug=value.slug===undefined?undefined:string(value.slug);if(slug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('Invalid slug');
 return {origin:origin.origin,slug,account,accounts,evidence:string(value.evidence)};
 }catch{throw new Error('Invalid private browser input.');}
}
const input = inputRecord();
const browser = await chromium.launch({ headless: true });
const devices = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    try {
      if (input.slug) await context.addCookies([{ name: '__Host-demo-scenario', value: input.slug, url: input.origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const externalMedia:string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if ((url.pathname.includes('/example.local/') || url.pathname.includes('/api/storage/')) && url.origin !== input.origin) externalMedia.push(url.origin);
      });
      if (input.slug) {
        await page.goto(input.origin + '/preview/' + input.slug, { waitUntil:'domcontentloaded' });
        for (const account of input.accounts ?? [input.account]) {
          await page.getByText(account.email, { exact:true }).waitFor({ state:'visible' });
          await page.getByText(account.label, { exact:true }).waitFor({ state:'visible' });
        }
      }
      await page.goto(input.origin + '/entrar?tab=login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
      // Without a recipe patch, hydration is observed through the page itself: React attaches its props to the
      // login form only after hydrating it, so a click can no longer trigger a native submission.
      const form = page.locator('form').filter({ has: page.locator('input[name="password"]') }).first();
      await form.waitFor({ state:'visible', timeout:120_000 });
      await page.waitForFunction(() => { const element = document.querySelector('input[name="password"]')?.closest('form'); return element !== null && element !== undefined && Object.keys(element).some(key => key.startsWith('__reactProps$')); }, undefined, { timeout:120_000 });
      await form.locator('button[type="submit"]').last().waitFor({ state:'visible', timeout:30_000 });
      assert.equal(await form.locator('button[type="submit"]').last().isEnabled(), true);
      await page.locator('input[name="email"]').first().fill(input.account.email);
      await page.locator('input[name="password"]').first().fill(input.account.password);
      await page.getByRole('button', { name: /entrar/i }).last().click();
      await page.waitForURL(url => url.pathname.startsWith('/feed'), { timeout: 120_000 });
      await page.locator('article').first().waitFor({ timeout: 60_000 });
      const feed = await context.request.get(input.origin + '/api/feed?tab=ALL&limit=20', { headers: { 'X-Client-Origin': input.origin } });
      assert.equal(feed.status(), 200);
      const body:unknown=await feed.json();const items=object(body).items;assert.ok(Array.isArray(items));const posts=items.map((item:unknown)=>object(item));
      assert.equal(posts.filter(post => string(post.id).startsWith('example_post_')).length, 8);
      const checkImages = async ():Promise<DecodedImage[]> => {
        const images = page.locator('img[src^="/example.local/"]:visible');
        await images.first().waitFor({ timeout: 60_000 });
        const decoded:DecodedImage[] = [];
        const paths = [...new Set(await images.evaluateAll(elements => elements.map(img => img.getAttribute('src')).filter((value):value is string=>value!==null)))];
        for (const src of paths) {
          // Hydration and feed updates may replace DOM nodes. Resolve by the
          // stable asset path for each operation instead of retaining handles.
          const image = page.locator(`img[src=${JSON.stringify(src)}]:visible`).first();
          await image.scrollIntoViewIfNeeded();
          decoded.push(await image.evaluate(async img => { if(!(img instanceof HTMLImageElement))throw new Error('Expected image');await img.decode(); return { path: new URL(img.currentSrc).pathname, width: img.naturalWidth, height: img.naturalHeight }; }));
        }
        assert.ok(decoded.length > 0 && decoded.every(item => item.width > 0 && item.height > 0));
        return decoded;
      };
      await page.locator('article img[src^="/example.local/"]:visible').first().waitFor({ timeout: 60_000 });
      const illustrated = [];
      for (const number of [1, 2, 3]) {
        const picture = page.locator(`article img[src="/example.local/post-${number}.svg"]`).first();
        await picture.waitFor({ state:'attached', timeout:60_000 });
        await picture.scrollIntoViewIfNeeded();
        illustrated.push(await picture.evaluate(async image => { if(!(image instanceof HTMLImageElement))throw new Error('Expected image');await image.decode(); return { path:new URL(image.currentSrc).pathname, width:image.naturalWidth, height:image.naturalHeight }; }));
      }
      const feedImages = [...new Map([...(await checkImages()), ...illustrated].map(item => [item.path,item])).values()];
      for (const number of [1, 2, 3]) assert.ok(feedImages.some(item => item.path.endsWith(`/post-${number}.svg`)), `illustrated post ${number} must render; observed ${JSON.stringify(feedImages.map(item => item.path))}`);
      await page.getByRole('button', { name: 'Menu da conta', exact: true }).click();
      await page.getByRole('link', { name: 'Ver meu perfil', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/perfil/lia-exemplo');
      await page.getByText('Cidade das Ideias, BA', { exact: true }).first().waitFor({ timeout: 60_000 });
      await page.locator('img[src="/example.local/cover.svg"]:visible').first().waitFor({ timeout: 60_000 });
      await page.locator('img[src="/example.local/badge.svg"]:visible').first().waitFor({ timeout: 60_000 });
      const profileImages = await checkImages();
      for (const name of ['lia.svg', 'cover.svg', 'badge.svg']) assert.ok(profileImages.some(item => item.path.endsWith('/' + name)), `profile ${name}`);
      assert.deepEqual(externalMedia, []);
      await page.evaluate(() => scrollTo(0, 0));
      const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(metrics.scroll <= metrics.width + 1, 'no horizontal overflow');
      const screenshot=path.join(input.evidence,`example-${width}-profile.png`);await page.screenshot({path:screenshot});fs.chmodSync(screenshot,0o600);
      devices.push({ width, mobileEmulation: width === 390, posts: 8, feedImages, profileImages, accountMenuNavigation: true, hydrationRequiredBeforeLogin:true, nativeFallbackKeepsPasswordOutOfUrl:true, overflow: false });
    } finally { await context.close(); }
  }
  process.stdout.write(JSON.stringify(devices));
} catch (error) {
  let message = error instanceof Error ? error.message : 'Browser validation failed';
  for (const account of input.accounts ?? [input.account]) {
    for (const secret of [account.password, encodeURIComponent(account.password)]) if (secret) message = message.split(secret).join('[REDACTED]');
  }
  process.stderr.write(message + '\n');
  process.exitCode = 1;
} finally { await browser.close(); }

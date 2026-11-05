import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const browser = await chromium.launch({ headless: true });
const devices = [];
try {
  const noScripts = await browser.newContext({ javaScriptEnabled:false });
  try {
    if (input.slug) await noScripts.addCookies([{ name:'__Host-demo-scenario', value:input.slug, url:input.origin, secure:true, httpOnly:true, sameSite:'Lax' }]);
    const page = await noScripts.newPage();
    await page.goto(input.origin + '/entrar?tab=login', { waitUntil:'domcontentloaded', timeout:120_000 });
    const form = page.locator('form[data-demo-ready="false"]');
    await form.waitFor({ state:'visible' });
    assert.equal(await form.getAttribute('method'), 'post');
    assert.equal(await form.locator('button[type="submit"]').isDisabled(), true);
    // Exercise the native fallback with a fictional marker, never a credential.
    await form.locator('input[name="email"]').fill('noscript@enois.invalid');
    await form.locator('input[name="password"]').fill('fictional-noscript-marker');
    let nativeSubmission;
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.isNavigationRequest() && request.method() === 'POST') {
        nativeSubmission = { method:request.method(), url:request.url(), hasBody:request.postData()?.includes('fictional-noscript-marker') };
        await route.fulfill({ status:403, contentType:'text/plain', body:'Native submission refused in acceptance fixture' });
      } else await route.continue();
    });
    await Promise.all([
      page.waitForResponse(response => response.request().isNavigationRequest() && response.request().method() === 'POST'),
      form.evaluate(element => element.submit()),
    ]);
    assert.equal(nativeSubmission?.method,'POST');
    assert.equal(nativeSubmission.hasBody,true);
    assert.equal(new URL(nativeSubmission.url).searchParams.has('password'),false);
  } finally { await noScripts.close(); }
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    try {
      if (input.slug) await context.addCookies([{ name: '__Host-demo-scenario', value: input.slug, url: input.origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const externalMedia = [];
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
      const form = page.locator('form[data-demo-ready="true"]');
      await form.waitFor({ state:'visible', timeout:120_000 });
      assert.equal(await form.getAttribute('method'), 'post');
      await page.getByText(/cadastros.*fechados|cadastro.*fechado/i).first().waitFor({ state:'visible', timeout:30_000 });
      await page.locator('input[name="email"]').first().fill(input.account.email);
      await page.locator('input[name="password"]').first().fill(input.account.password);
      await page.getByRole('button', { name: /entrar/i }).last().click();
      await page.waitForURL(url => url.pathname.startsWith('/feed'), { timeout: 120_000 });
      await page.locator('article').first().waitFor({ timeout: 60_000 });
      const feed = await context.request.get(input.origin + '/api/feed?tab=ALL&limit=20', { headers: { 'X-Client-Origin': input.origin } });
      assert.equal(feed.status(), 200);
      const posts = (await feed.json()).items;
      assert.equal(posts.filter(post => post.id.startsWith('example_post_')).length, 8);
      const checkImages = async () => {
        const images = page.locator('img[src^="/example.local/"]:visible');
        await images.first().waitFor({ timeout: 60_000 });
        const decoded = [];
        const paths = [...new Set(await images.evaluateAll(elements => elements.map(img => img.getAttribute('src'))))];
        for (const src of paths) {
          // Hydration and feed updates may replace DOM nodes. Resolve by the
          // stable asset path for each operation instead of retaining handles.
          const image = page.locator(`img[src=${JSON.stringify(src)}]:visible`).first();
          await image.scrollIntoViewIfNeeded();
          decoded.push(await image.evaluate(async img => { await img.decode(); return { path: new URL(img.currentSrc).pathname, width: img.naturalWidth, height: img.naturalHeight }; }));
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
        illustrated.push(await picture.evaluate(async image => { await image.decode(); return { path:new URL(image.currentSrc).pathname, width:image.naturalWidth, height:image.naturalHeight }; }));
      }
      const feedImages = [...new Map([...(await checkImages()), ...illustrated].map(item => [item.path,item])).values()];
      for (const number of [1, 2, 3]) assert.ok(feedImages.some(item => item.path.endsWith(`/post-${number}.svg`)), `illustrated post ${number} must render; observed ${JSON.stringify(feedImages.map(item => item.path))}`);
      await page.getByRole('button', { name: 'Menu da conta', exact: true }).click();
      await page.getByRole('link', { name: 'Ver perfil', exact: true }).click();
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
      await page.screenshot({ path: path.join(input.evidence, `example-${width}-profile.png`) });
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

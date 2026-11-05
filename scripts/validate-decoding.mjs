import fs from 'node:fs';
import { chromium } from 'playwright';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const browser = await chromium.launch({ headless: true });
const result = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    try {
      if (input.slug) await context.addCookies([{ name: '__Host-demo-scenario', value: input.slug, url: input.origin, secure: true, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      await page.goto(input.origin + (input.slug ? '/__demo/revision' : '/__demo/runtime'), { waitUntil: 'domcontentloaded' });
      const images = [];
      for (const path of input.paths) {
        const dimensions = await page.evaluate(async pathname => {
          const image = new Image(); image.src = pathname; await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        }, path);
        if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error('Image dimensions invalid');
        images.push({ path, ...dimensions });
      }
      result.push({ width, mobileEmulation: width === 390, images });
    } finally { await context.close(); }
  }
  process.stdout.write(JSON.stringify(result));
} finally { await browser.close(); }

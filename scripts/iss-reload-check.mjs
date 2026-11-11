// ISS reload check: loads the page 3 times (fresh context each time) at
// mobile portrait 390x844 and confirms __spicaModels.iss === true on
// EVERY load, with a Wide-view screenshot per load. Collects any
// [SPICA] ISS console warnings (retries/fallbacks) per load.
// Usage: node scripts/iss-reload-check.mjs <url> <tag>
// Live URLs go through the CONNECT forwarder on 127.0.0.1:18080.
import { chromium } from 'playwright-core';
import { join } from 'node:path';
const [,, url, tag] = process.argv;
if (!url || !tag) { console.error('usage: iss-reload-check.mjs <url> <tag>'); process.exit(2); }
const outDir = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/preview';
const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    ...(isLocal ? [] : ['--proxy-server=http://127.0.0.1:18080'])],
});
let failures = 0;
for (let i = 1; i <= 3; i++) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const warns = [];
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('SPICA')) warns.push(m.text()); });
  page.on('pageerror', (e) => warns.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  try {
    await page.waitForFunction(
      () => window.__spicaModels && window.__spicaModels.iss,
      null, { timeout: 180000 },
    );
    console.log(`load ${i}: iss=true in ${((Date.now() - t0) / 1000).toFixed(1)}s warns=${JSON.stringify(warns)}`);
  } catch {
    failures++;
    const models = await page.evaluate(() => window.__spicaModels || null);
    console.log(`load ${i}: ISS MISSING after 180s models=${JSON.stringify(models)} warns=${JSON.stringify(warns)}`);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(outDir, `iss-reload-${tag}-${i}.png`), timeout: 120000, fromSurface: false });
  await context.close();
}
await browser.close();
console.log(failures === 0 ? 'DONE iss-reload-check: 3/3 iss=true' : `DONE iss-reload-check: ${failures}/3 LOADS MISSING ISS`);
process.exit(failures === 0 ? 0 : 1);

// Live mobile-portrait check: does the ISS exterior show on the public link
// the way Ronit sees it on his phone? Loads the Pages URL at 390x844,
// waits for the exterior models, screenshots the default Wide view, then
// the ISS preset. Uses the CONNECT forwarder on 127.0.0.1:18080.
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/preview';
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--proxy-server=http://127.0.0.1:18080'],
});
const errors = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
await page.goto('https://eres0045.github.io/spica-firelab/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.shuttle,
  null, { timeout: 120000 },
);
await page.waitForTimeout(4000);
console.log('models:', JSON.stringify(await page.evaluate(() => window.__spicaModels)));
console.log('cam:', JSON.stringify(await page.evaluate(() => window.__spicaCam || null)));
await page.screenshot({ path: join(outDir, 'live-mobile-wide.png'), timeout: 120000, fromSurface: false });
await page.getByRole('button', { name: 'Camera view: ISS' }).click();
await page.waitForTimeout(4000);
console.log('cam-after-iss:', JSON.stringify(await page.evaluate(() => window.__spicaCam || null)));
await page.screenshot({ path: join(outDir, 'live-mobile-iss.png'), timeout: 120000, fromSurface: false });
console.log('errors:', JSON.stringify(errors));
await context.close();
await browser.close();
console.log('DONE iss-mobile-check');

// Diagnostic: what is the live page actually doing?
// Loads the URL, waits, and dumps app state, errors, failed requests,
// and a screenshot — to tell a broken bundle from slow models.
import { chromium } from 'playwright-core';
import { join } from 'node:path';
const url = process.argv[2];
const prefix = process.argv[3] || 'diag';
const useFwd = process.env.USE_FWD === '1';
const outDir = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/preview';
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    ...(useFwd ? ['--proxy-server=http://127.0.0.1:18080'] : [])],
});
const errors = [];
const failedReqs = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText || ''}`));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`HTTP ${r.status()}: ${r.url()}`); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => ({
    models: window.__spicaModels || null,
    cam: window.__spicaCam || null,
    walk: window.__spicaWalk || null,
    canvas: !!document.querySelector('canvas'),
    bodyText: document.body.innerText.slice(0, 300),
  }));
  console.log(`t+${(i + 1) * 15}s:`, JSON.stringify(state));
  if (state.models && state.models.iss && state.models.astronaut) break;
}
await page.screenshot({ path: join(outDir, `${prefix}.png`), timeout: 120000, fromSurface: false });
console.log('errors:', JSON.stringify(errors.slice(0, 20)));
console.log('failedReqs:', JSON.stringify(failedReqs.slice(0, 20)));
await context.close();
await browser.close();
console.log('DONE diag');

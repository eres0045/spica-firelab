/**
 * Loading-overlay check: screenshots the page ~1.5 s after navigation
 * (the glass "Loading the station…" note must be visible, not a black
 * screen), then again after the core models settle (the note must be
 * gone and the scene visible). Prints the overlay text at each stage
 * plus any console errors / failed requests.
 */
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';
const OUT = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/preview';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
await page.waitForTimeout(1500);
const early = await page.evaluate(() => document.body.innerText.includes('Loading the station'));
console.log('overlay visible at 1.5s:', early);
await page.screenshot({ path: `${OUT}/firelab-overlay-01-loading.png`, timeout: 60000 });

await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut,
  null, { timeout: 90000 },
).catch(() => {});
await page.waitForTimeout(2000);
const late = await page.evaluate(() => document.body.innerText.includes('Loading the station'));
console.log('overlay still visible after core ready:', late);
console.log('core flags:', await page.evaluate(() => JSON.stringify(window.__spicaModels || {})));
await page.screenshot({ path: `${OUT}/firelab-overlay-02-ready.png`, timeout: 60000 });

console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

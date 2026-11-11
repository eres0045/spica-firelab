/**
 * Sun verification — interior check: the Sun must be hidden in the
 * interior view (applyView toggles sunGroup.visible). Fresh browser,
 * desktop, Inside preset, wait for the scan to decode, screenshot.
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
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut,
  null, { timeout: 90000 },
).catch(() => {});
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.interior,
  null, { timeout: 90000 },
).catch(() => {});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/sun-04-desktop-interior.png`, timeout: 120000 });
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

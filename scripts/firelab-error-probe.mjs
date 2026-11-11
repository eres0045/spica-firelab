/**
 * Desktop-only error probe — minimal immersive UI (2026-11-11): loads the
 * page, exercises the lab (Exploration preset, O2 slider to 10%, flow to
 * 30, pressure to 8.2, material switch, camera presets + zoom in/out,
 * panel collapse/expand) and prints every console error / failed request
 * / HTTP >= 400. No 404 whitelist: both Sketchfab GLBs are downloaded now.
 */
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';

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

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(7000);
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(2500);
await page.locator('#o2-slider').fill('10');
await page.waitForTimeout(2000);
await page.locator('#flow-slider').fill('30');
await page.waitForTimeout(1500);
await page.locator('#pressure-slider').fill('8.2');
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Methanol droplet/ }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.interior,
  null, { timeout: 60000 },
).catch(() => {});
await page.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Zoom out' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Camera view: Chamber' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Camera view: ISS' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Camera view: Earth' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Camera view: Wide' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Collapse fire controls' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Expand fire controls' }).click();
await page.waitForTimeout(1500);
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();

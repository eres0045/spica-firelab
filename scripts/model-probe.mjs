/**
 * Focused probe: does the ISS model actually load in the ModelViewer?
 * Waits up to 25 s for the "Loading…" text to disappear, logs every
 * .glb / draco request, and screenshots the 3D view.
 * Usage: node scripts/model-probe.mjs
 */
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const browser = await chromium.launch({ executablePath: EXE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const modelReqs = [];
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.url().includes('.glb') || r.url().includes('draco')) {
    modelReqs.push(`${r.status()} ${r.url()}`);
  }
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 60000 });

// Wait for the ISS model to finish loading (or time out honestly).
let loaded = false;
try {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading ISS (A)'),
    { timeout: 25000 },
  );
  loaded = true;
} catch { loaded = false; }
await page.waitForTimeout(1500);
const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
await page.screenshot({ path: '/tmp/spica-3d.png' });

// Exploration -> HDU habitat model must load too.
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
let hduLoaded = false;
try {
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading Habitat Demonstration Unit'),
    { timeout: 25000 },
  );
  hduLoaded = true;
} catch { hduLoaded = false; }
await page.waitForTimeout(1200);
const section = page.locator('section', { hasText: 'Spacecraft model' }).first();
await section.screenshot({ path: '/tmp/spica-model-hdu.png' });
console.log(JSON.stringify({ issModelLoaded: loaded, hduModelLoaded: hduLoaded, canvases, modelReqs, errors: errors.slice(0, 8) }, null, 2));
await browser.close();

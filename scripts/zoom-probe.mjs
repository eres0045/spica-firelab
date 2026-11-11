// Zoom-out probe: Inside view, click the panel Zoom-out (−) button 5x and log
// the camera distance after each click, to check whether zoom-out moves at all
// and where it stops (CAM_INTERIOR.max clamp). Local preview :4173.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await page.waitForTimeout(1500);

const cam = () => page.evaluate(() => {
  const c = window.__spicaCam;
  if (!c) return null;
  const d = Math.hypot(c.pos[0] - c.tgt[0], c.pos[1] - c.tgt[1], c.pos[2] - c.tgt[2]);
  return { pos: c.pos.map((v) => +v.toFixed(2)), tgt: c.tgt.map((v) => +v.toFixed(2)), dist: +d.toFixed(2) };
});

const log = [];
// Switch to Inside preset
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForTimeout(2500);
log.push({ step: 'inside-landed', ...(await cam()) });
// Zoom out 5x (each click = flyTo 0.9s tween)
for (let i = 1; i <= 5; i++) {
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(1300);
  log.push({ step: `zoom-out-${i}`, ...(await cam()) });
}
await page.screenshot({ path: join(outDir, 'zoom-probe-max-out.png') });
// Zoom in 2x to confirm the other direction works
for (let i = 1; i <= 2; i++) {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(1300);
  log.push({ step: `zoom-in-${i}`, ...(await cam()) });
}
await browser.close();
console.log(JSON.stringify({ errors, log }, null, 2));

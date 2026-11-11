// First-click evidence probe: does a SINGLE zoom-out click move the camera
// when given enough wall time? The 1300ms reads in zoom-probe.mjs are
// shorter than one SwiftShader frame (~1.4s), so they may read before the
// frame that processes the command. Samples dist every 500ms for 5s after
// one zoom-out click, and again after one zoom-in click.
import { chromium } from 'playwright-core';

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

const dist = () => page.evaluate(() => {
  const c = window.__spicaCam;
  if (!c) return null;
  return +Math.hypot(c.pos[0] - c.tgt[0], c.pos[1] - c.tgt[1], c.pos[2] - c.tgt[2]).toFixed(2);
});
const frameStats = () => page.evaluate(() => {
  const rows = window.__spicaFrameTimes || [];
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + r.js + r.render, 0) / rows.length;
  return { frames: rows.length, meanFrameMs: Math.round(total) };
});

await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForTimeout(3000);
console.log('landed dist:', await dist(), 'frames:', JSON.stringify(await frameStats()));

await page.getByRole('button', { name: 'Zoom out' }).click();
const outSamples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500);
  outSamples.push(await dist());
}
console.log('after ONE zoom-out click, dist sampled every 500ms:', JSON.stringify(outSamples));

await page.getByRole('button', { name: 'Zoom in' }).click();
const inSamples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500);
  inSamples.push(await dist());
}
console.log('after ONE zoom-in click, dist sampled every 500ms:', JSON.stringify(inSamples));
console.log('errors:', JSON.stringify(errors));
await browser.close();

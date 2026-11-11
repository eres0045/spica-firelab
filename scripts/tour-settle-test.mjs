// Decisive drag-settle test (2026-11-11): the camlog readings after
// hard drags showed out-of-cone positions, but they were read 1.5s
// after mouse.up — under swiftshader the frame rate may be ~0.5fps,
// so the camera/tween may not have settled. This script hard-drags,
// waits 15s for many frames, then reads __spicaCam + the frame-time
// ring buffer and screenshots. If the settled pose is in-cone and the
// shot shows the aisle, the clamp holds and the earlier readings were
// pre-settle transients.
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');
const TGT = [0, 0.1, -0.7];
const inCone = (p) => {
  if (!p) return false;
  const ox = p[0] - TGT[0], oy = p[1] - TGT[1], oz = p[2] - TGT[2];
  const R = Math.hypot(ox, oy, oz);
  const lat = Math.hypot(ox, oy);
  const nearCap = p[2] <= 2.5 ? 0.55 : 1.0;
  const cap = Math.min(nearCap, 3.0 / R, R);
  return lat <= cap + 0.01 && p[2] >= 0.3 - 0.01 && p[2] <= 5.5 + 0.01;
};
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cam = async () => page.evaluate(() => window.__spicaCam || null);
const frames = async () => page.evaluate(() => {
  const rows = window.__spicaFrameTimes || [];
  const total = rows.map((r) => r.js + r.render);
  const avg = total.length ? total.reduce((a, b) => a + b, 0) / total.length : 0;
  return { n: rows.length, avgMs: +avg.toFixed(1), maxMs: total.length ? +Math.max(...total).toFixed(1) : 0 };
});
const clickBtn = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
  if (!b) throw new Error('no button ' + l);
  b.click();
}, label);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await clickBtn('Inside');
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await page.waitForTimeout(6000);
console.log('frames-after-load', JSON.stringify(await frames()));
console.log('inside-settled', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
// Hard drag left, then a LONG settle.
await page.mouse.move(640, 400);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(640 - 54 * i, 400); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(15000);
console.log('frames-after-drag', JSON.stringify(await frames()));
console.log('drag-left-settled', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'tour-verify-drag-left-settled.png'), timeout: 120000, fromSurface: false });
// Hard drag right, long settle.
await page.mouse.move(640, 400);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(640 + 54 * i, 400); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(15000);
console.log('drag-right-settled', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'tour-verify-drag-right-settled.png'), timeout: 120000, fromSurface: false });
await browser.close();
console.log('DONE settle-test');

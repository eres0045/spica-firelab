// Mobile clamp verification (2026-11-11): portrait 390x844 (Ron's
// phone class), Inside view — landing pose, hard drags, zoom-out.
// Logs __spicaCam after each move; the camera must stay inside the
// cone+z-range (lateral <= 0.55 for R<=3 else 1.65/R around the axis
// through the flame centre [0,0.1,-0.7], 0.3 <= z <= 5.5 — Destiny's
// aisle, see INTERIOR_CLAMP in FireLab3D.jsx) and the landing
// pose must match the desktop one (portrait-scaled).
// Screenshots under preview/clamp-mobile-*.png.
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
  // Two-zone cone (see INTERIOR_CLAMP in FireLab3D.jsx): the bike
  // zone (z <= 2.5) caps lateral at 0.55, elsewhere 1.0; far cone
  // 3.0/R in both zones.
  const nearCap = p[2] <= 2.5 ? 0.55 : 1.0;
  const cap = Math.min(nearCap, 3.0 / R, R);
  return lat <= cap + 0.01 && p[2] >= 0.3 - 0.01 && p[2] <= 5.5 + 0.01;
};

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

const cam = () => page.evaluate(() => {
  const c = window.__spicaCam;
  if (!c) return null;
  const d = Math.hypot(c.pos[0] - c.tgt[0], c.pos[1] - c.tgt[1], c.pos[2] - c.tgt[2]);
  const lat = Math.hypot(c.pos[0] - 0, c.pos[1] - 0.1);
  return { pos: c.pos.map((v) => +v.toFixed(2)), tgt: c.tgt.map((v) => +v.toFixed(2)), dist: +d.toFixed(2), lat: +lat.toFixed(2) };
});
const log = [];
// See clamp-verify.mjs: under SwiftShader frames run at ~0.25 fps, so
// fixed waits read a stale pre-clamp position. Poll until settled.
async function waitSettled(minFrames = 4, timeoutMs = 120000) {
  const startLen = await page.evaluate(() => (window.__spicaFrameTimes || []).length);
  let prev = null;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1000);
    const c = await cam();
    const len = await page.evaluate(() => (window.__spicaFrameTimes || []).length);
    const key = c ? c.pos.join(',') : 'null';
    if (len - startLen >= minFrames && prev !== null && key === prev) return;
    prev = key;
  }
}
async function drag(x0, y0, x1, y1, label) {
  await page.touchscreen.tap(x0, y0); // wake the touch path
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await waitSettled();
  const c = await cam();
  log.push({ step: label, ...c, inCone: inCone(c?.pos) });
}

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await page.waitForTimeout(1500);
// The mobile panel is a bottom sheet that starts COLLAPSED — the
// Camera/Zoom buttons are hidden until expanded. Expand to click,
// collapse to drag/shoot (expanded, the sheet covers the glovebox).
const expand = () => page.getByRole('button', { name: 'Expand fire controls' }).click();
const collapse = () => page.getByRole('button', { name: 'Collapse fire controls' }).click();
await expand();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await waitSettled();
log.push({ step: 'inside-landed', ...(await cam()), inCone: inCone((await cam())?.pos) });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await collapse();
await page.waitForTimeout(1000);
await page.screenshot({ path: join(outDir, 'clamp-mobile-landed.png') });
// Zoom in 2x to the worst zone, then drag hard.
await expand();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Zoom in' }).click();
await waitSettled();
await page.getByRole('button', { name: 'Zoom in' }).click();
await waitSettled();
log.push({ step: 'zoomed-in-r3.4', ...(await cam()), inCone: inCone((await cam())?.pos) });
await collapse();
await page.waitForTimeout(1000);
await drag(195, 420, 60, 420, 'drag-left-hard');
await page.screenshot({ path: join(outDir, 'clamp-mobile-drag-left.png') });
await drag(195, 420, 330, 420, 'drag-right-hard');
await page.screenshot({ path: join(outDir, 'clamp-mobile-drag-right.png') });
await drag(195, 420, 195, 200, 'drag-up-hard');
await page.screenshot({ path: join(outDir, 'clamp-mobile-drag-up.png') });
// Zoom back out to max.
await expand();
await page.waitForTimeout(1000);
for (let i = 1; i <= 5; i++) {
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await waitSettled();
}
await waitSettled();
log.push({ step: 'zoomed-out-max', ...(await cam()), inCone: inCone((await cam())?.pos) });
await collapse();
await page.waitForTimeout(1000);
await page.screenshot({ path: join(outDir, 'clamp-mobile-zoom-max-out.png') });

await browser.close();
console.log(JSON.stringify({ errors, log }, null, 2));

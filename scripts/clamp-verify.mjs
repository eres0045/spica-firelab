// Clamp + entry-fade verification (2026-11-11): loads the app on the
// local preview (:4173), exercises the interior camera hard, and logs
// the camera pose after every move so the clamp can be checked
// numerically (camera must stay inside the cone+z-cap: lateral <= 1.2
// for R<=3 else 3.6/R around the axis through the flame centre
// [0,0.1,-0.7], and |z| <= 6.0, while in the interior view).
// Screenshots under preview/clamp-*.png — read them before reporting.
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
  const cap = R <= 3 ? 1.2 : 3.6 / R;
  return lat <= cap + 0.01 && Math.abs(p[2]) <= 6.0 + 0.01;
};

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

const cam = () => page.evaluate(() => {
  const c = window.__spicaCam;
  if (!c) return null;
  const d = Math.hypot(c.pos[0] - c.tgt[0], c.pos[1] - c.tgt[1], c.pos[2] - c.tgt[2]);
  return { pos: c.pos.map((v) => +v.toFixed(2)), tgt: c.tgt.map((v) => +v.toFixed(2)), dist: +d.toFixed(2) };
});
const log = [];
// Under SwiftShader the interior scene renders at ~0.25 fps, so a
// fixed 1.2 s wait is shorter than a frame and the __spicaCam readout
// is still the pre-clamp position. Poll until the camera stops moving
// (two identical reads) or 20 s pass — the clamp settles the camera
// onto the cone within a few frames.
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

// --- Entry tween: Wide -> Inside, catch the mid-flight frame ---
await page.getByRole('button', { name: 'Camera view: Wide' }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForTimeout(450); // mid-flight (~0.45s of the 0.9s tween)
await page.screenshot({ path: join(outDir, 'clamp-entry-midflight.png') });
await waitSettled();
log.push({ step: 'inside-landed', ...(await cam()), inCone: inCone((await cam())?.pos) });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, 'clamp-inside-landed.png') });

// --- Worst zone: zoom in 2x to radius ~3.4, then drag hard in every direction ---
await page.getByRole('button', { name: 'Zoom in' }).click();
await waitSettled();
await page.getByRole('button', { name: 'Zoom in' }).click();
await waitSettled();
log.push({ step: 'zoomed-in-r3.4', ...(await cam()), inCone: inCone((await cam())?.pos) });
await drag(900, 450, 300, 450, 'drag-left-hard');
await page.screenshot({ path: join(outDir, 'clamp-drag-left.png') });
await drag(900, 450, 1300, 450, 'drag-right-hard');
await page.screenshot({ path: join(outDir, 'clamp-drag-right.png') });
await drag(900, 450, 900, 150, 'drag-up-hard');
await page.screenshot({ path: join(outDir, 'clamp-drag-up.png') });
await drag(900, 450, 900, 750, 'drag-down-hard');
await page.screenshot({ path: join(outDir, 'clamp-drag-down.png') });
await drag(900, 450, 350, 200, 'drag-diagonal');
await page.screenshot({ path: join(outDir, 'clamp-drag-diagonal.png') });

// --- Zoom back out to max: the clamp must not block the zoom-out path ---
for (let i = 1; i <= 5; i++) {
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await waitSettled();
}
log.push({ step: 'zoomed-out-max', ...(await cam()), inCone: inCone((await cam())?.pos) });
await page.screenshot({ path: join(outDir, 'clamp-zoom-max-out.png') });

// --- Same-view preset (Inside -> Chamber) must NOT fade and must land clean ---
await page.getByRole('button', { name: 'Camera view: Chamber' }).click();
await page.waitForTimeout(450);
await page.screenshot({ path: join(outDir, 'clamp-chamber-midflight.png') });
await waitSettled();
log.push({ step: 'chamber-landed', ...(await cam()), inCone: inCone((await cam())?.pos) });

await browser.close();
console.log(JSON.stringify({ errors, log }, null, 2));

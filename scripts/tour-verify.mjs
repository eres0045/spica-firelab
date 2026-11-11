// Tour visual verification (2026-11-11): the clamp-verify script's
// screenshots time out under swiftshader while the 37MB tour GLB is
// still uploading textures, so this script waits longer and gives each
// screenshot a 120s timeout. Loads the local preview (:4173), lands
// Inside, screenshots Inside/Chamber/Wide + a hard drag, then the
// mobile portrait Inside. Logs __spicaCam after each move (must stay
// in-cone: two-zone cone, see INTERIOR_CLAMP in FireLab3D.jsx).
// Screenshots under preview/tour-verify-*.png — read them before reporting.
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
const shot = async (name) => {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, name), timeout: 120000, fromSurface: false });
};
const clickBtn = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
  if (!b) throw new Error('no button ' + l);
  b.click();
}, label);

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });

await clickBtn('Inside');
// The tour GLB loads LAZILY on first switch to the interior view —
// wait for it here (37MB, swiftshader is slow to upload 29 textures).
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await page.waitForTimeout(5000); // let the 29 tour textures upload + the render loop settle
console.log('inside-landed', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await shot('tour-verify-inside.png');

await clickBtn('Chamber');
await page.waitForTimeout(2000);
console.log('chamber-landed', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await shot('tour-verify-chamber.png');

// Hard drag: orbit far left, then far right — the clamp must hold.
await page.mouse.move(900, 450);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(900 - 60 * i, 450); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(2000);
console.log('drag-left', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await shot('tour-verify-drag-left.png');

await page.mouse.move(900, 450);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(900 - 40 * i, 450 - 30 * i); await page.waitForTimeout(60); }
await page.mouse.up();
await page.waitForTimeout(2000);
console.log('drag-diagonal', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await shot('tour-verify-drag-diagonal.png');

await clickBtn('Wide');
await page.waitForTimeout(2000);
console.log('wide-landed', JSON.stringify(await cam()));
await shot('tour-verify-wide.png');

await browser.close();
console.log('DONE desktop');

// --- Mobile portrait 390x844 ---
const browser2 = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const mpage = await browser2.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mcam = async () => mpage.evaluate(() => window.__spicaCam || null);
await mpage.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await mpage.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Inside'); if (!b) throw new Error('no button Inside'); b.click(); });
await mpage.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await mpage.waitForTimeout(5000);
console.log('mobile-inside', JSON.stringify({ ...(await mcam()), inCone: inCone((await mcam())?.pos) }));
await mpage.waitForTimeout(2500);
await mpage.screenshot({ path: join(outDir, 'tour-verify-mobile-inside.png'), timeout: 120000, fromSurface: false });
await browser2.close();
console.log('DONE mobile');

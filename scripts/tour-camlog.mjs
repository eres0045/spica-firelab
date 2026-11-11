// Desktop camera-pose log (2026-11-11): loads the local preview, goes
// Inside, hard-drags in every direction and logs __spicaCam + inCone
// after each move (no screenshots — fast). The two-zone cone is in
// INTERIOR_CLAMP in FireLab3D.jsx; inCone replicates it here.
import { chromium } from 'playwright-core';
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
const clickBtn = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
  if (!b) throw new Error('no button ' + l);
  b.click();
}, label);
const logCam = async (label) => {
  const c = await cam();
  console.log(label, JSON.stringify({ ...c, inCone: inCone(c?.pos) }));
};
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await clickBtn('Inside');
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await page.waitForTimeout(4000);
await logCam('inside-landed');
await clickBtn('Chamber');
await page.waitForTimeout(2000);
await logCam('chamber-landed');
const drag = async (x0, y0, x1, y1, label) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await logCam(label);
};
await drag(640, 400, 100, 400, 'drag-left-hard');
await drag(640, 400, 1180, 400, 'drag-right-hard');
await drag(640, 400, 640, 100, 'drag-up-hard');
await drag(640, 400, 640, 700, 'drag-down-hard');
await drag(640, 400, 200, 150, 'drag-diagonal-hard');
await browser.close();
console.log('DONE camlog');

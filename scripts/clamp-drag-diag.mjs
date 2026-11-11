// Diagnostic: after a hard drag in the interior view, sample
// window.__spicaCam every second for 10s and check the cone invariant
// each time. Distinguishes "clamp never runs after a drag" (stays
// off-cone) from "probe read during the damping tail" (converges on
// the cone as frames run under SwiftShader).
import { chromium } from 'playwright-core';

const TGT = [0, 0.1, -0.7];
const inCone = (p) => {
  if (!p) return false;
  const ox = p[0] - TGT[0], oy = p[1] - TGT[1];
  const R = Math.hypot(ox, oy, p[2] - TGT[2]);
  const lat = Math.hypot(ox, oy);
  const cap = R <= 3 ? 1.2 : 3.6 / R;
  return { ok: lat <= cap + 0.01 && Math.abs(p[2]) <= 6.01, R: +R.toFixed(2), lat: +lat.toFixed(2), cap: +cap.toFixed(2) };
};

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const cam = () => page.evaluate(() => window.__spicaCam || null);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForTimeout(2000);
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Zoom in' }).click();
await page.waitForTimeout(1500);
console.log('before drag:', JSON.stringify(await cam()), JSON.stringify(inCone((await cam())?.pos)));
// Hard drag left, like the verify probe.
await page.mouse.move(900, 450);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(900 - 60 * i, 450); await page.waitForTimeout(60); }
await page.mouse.up();
for (let s = 0; s <= 10; s++) {
  await page.waitForTimeout(1000);
  const c = await cam();
  console.log(`t+${s + 1}s:`, JSON.stringify(c?.pos), JSON.stringify(inCone(c?.pos)));
}
console.log('errors:', JSON.stringify(errors));
await browser.close();

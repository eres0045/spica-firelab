// Mobile tour verification (2026-11-11): portrait 390x844 (Ron's
// phone class). The bottom sheet is collapsed by default, so expand
// it first, then Inside; the tour GLB loads lazily on that switch.
// Logs __spicaCam (must stay in-cone) and screenshots the mobile
// Inside view. Screenshot under preview/tour-verify-mobile-inside.png.
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const cam = async () => page.evaluate(() => window.__spicaCam || null);
const clickBtn = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l || x.getAttribute('aria-label') === l);
  if (!b) throw new Error('no button ' + l);
  b.click();
}, label);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await clickBtn('Expand fire controls');
await page.waitForTimeout(1000);
await clickBtn('Inside');
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await page.waitForTimeout(5000);
console.log('mobile-inside', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'tour-verify-mobile-inside.png'), timeout: 120000, fromSurface: false });
// Collapse the sheet to see the full interior view on mobile.
await clickBtn('Collapse fire controls');
await page.waitForTimeout(2000);
console.log('mobile-inside-collapsed', JSON.stringify({ ...(await cam()), inCone: inCone((await cam())?.pos) }));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'tour-verify-mobile-inside-collapsed.png'), timeout: 120000, fromSurface: false });
await browser.close();
console.log('DONE mobile');

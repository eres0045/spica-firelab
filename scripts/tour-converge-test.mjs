// Clamp convergence test (2026-11-11): after a hard drag, read
// __spicaCam every 3s for 30s. If the clamp holds, the position must
// converge onto the cone (lateral -> the cap for its radius) and stay
// there, even though single reads at ~1fps can catch pre-clamp
// transients. Also logs the frame count so the frame rate is known.
import { chromium } from 'playwright-core';
const TGT = [0, 0.1, -0.7];
const capFor = (p) => {
  const ox = p[0] - TGT[0], oy = p[1] - TGT[1], oz = p[2] - TGT[2];
  const R = Math.hypot(ox, oy, oz);
  const nearCap = p[2] <= 2.5 ? 0.55 : 1.0;
  return { R: +R.toFixed(2), lat: +Math.hypot(ox, oy).toFixed(2), cap: +Math.min(nearCap, 3.0 / R, R).toFixed(3) };
};
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cam = async () => page.evaluate(() => window.__spicaCam || null);
const nframes = async () => page.evaluate(() => (window.__spicaFrameTimes || []).length);
const clickBtn = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
  if (!b) throw new Error('no button ' + l);
  b.click();
}, label);
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.iss, null, { timeout: 90000 });
await clickBtn('Inside');
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 180000 });
await page.waitForTimeout(8000);
console.log('start', JSON.stringify({ ...(await cam()), ...capFor((await cam()).pos), frames: await nframes() }));
await page.mouse.move(640, 400);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(640 + 54 * i, 400); await page.waitForTimeout(60); }
await page.mouse.up();
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(3000);
  const c = await cam();
  console.log(`t+${(i + 1) * 3}s`, JSON.stringify({ pos: c.pos, ...capFor(c.pos), frames: await nframes() }));
}
await browser.close();
console.log('DONE converge-test');

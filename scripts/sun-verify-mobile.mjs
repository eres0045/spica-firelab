/**
 * Sun verification — MOBILE ONLY, fresh browser (the combined desktop+
 * mobile run starved the second page: its models never decoded and the
 * canvas locator timed out). Default frame, then drag toward the Sun
 * (upper-right, out of the narrow portrait default frame) to prove it
 * renders on mobile too. Reports errors + the 2k_sun.jpg request status.
 */
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';
const OUT = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/preview';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
let sunTexOk = false;
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
mob.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
mob.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
mob.on('response', (r) => {
  if (r.url().includes('2k_sun.jpg')) sunTexOk = r.status() === 200;
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mob.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 120000 },
).catch(() => {});
await mob.waitForTimeout(3000);
console.log('mobile cam:', JSON.stringify(await mob.evaluate(() => window.__spicaCam)));
await mob.screenshot({ path: `${OUT}/sun-02-mobile-default.png`, timeout: 120000 });

// Drag right + up on the canvas (viewport coords — the canvas covers
// the screen; the drag starts above the bottom sheet). OrbitControls:
// drag-right looks right, drag-up looks up — the Sun is upper-right.
for (let i = 0; i < 3; i++) {
  await mob.mouse.move(195, 300);
  await mob.mouse.down();
  await mob.mouse.move(325, 190, { steps: 12 });
  await mob.mouse.up();
  await mob.waitForTimeout(1500);
}
console.log('mobile cam after drag:', JSON.stringify(await mob.evaluate(() => window.__spicaCam)));
await mob.screenshot({ path: `${OUT}/sun-03-mobile-sun.png`, timeout: 120000 });

console.log(JSON.stringify({ sunTexture200: sunTexOk, errors: errors.slice(0, 10) }, null, 2));
await browser.close();

// One-off check: interior view on a phone viewport (390x844). The
// portrait pull-back (1.15x) pushes the Inside framing to ~6.1 units
// out — the tween landing logic must widen the limits to contain it,
// or OrbitControls clamps the framing on landing. Screenshots the
// settled interior framing + prints console errors.
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';
const OUT = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/preview';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 90000 },
).catch(() => {});
await page.getByRole('button', { name: 'Expand fire controls' }).click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.interior,
  null, { timeout: 60000 },
).catch(() => {});
// Portrait framing: Inside pos [0.1,0.1,4.6] scaled 1.15x away from the
// target [0,0.1,-0.7] -> ~[0.12,0.1,5.4].
const expected = [0.12, 0.1, 5.4];
let prev = null;
let still = 0;
const start = Date.now();
while (Date.now() - start < 90000) {
  const cam = await page.evaluate(() => window.__spicaCam);
  if (cam) {
    const atDest = Math.hypot(cam.pos[0] - expected[0], cam.pos[1] - expected[1], cam.pos[2] - expected[2]) < 0.5;
    if (prev) {
      const d = Math.hypot(cam.pos[0] - prev.pos[0], cam.pos[1] - prev.pos[1], cam.pos[2] - prev.pos[2]);
      if (d < 0.05 && atDest) { if (++still >= 2) { console.log('mobile inside settled at', JSON.stringify(cam)); break; } }
      else still = 0;
    }
    prev = cam;
  }
  await page.waitForTimeout(500);
}
if (Date.now() - start >= 90000) console.log('mobile inside NOT settled, last:', JSON.stringify(prev));
// Collapse the sheet again before shooting — expanded, it covers the
// glovebox; collapsed is what the user actually sees on their phone.
await page.getByRole('button', { name: 'Collapse fire controls' }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/firelab-scene-06-mobile-interior.png`, timeout: 120000 });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();

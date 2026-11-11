// Walk-mode probe (mobile portrait 390x844):
// Inside -> Walk -> hold forward (camera advances) -> drag ~180°
// (view turns to the far hatch) -> hold forward again -> tap Inside
// preset (walk exits, camera flies back).
// Usage: node scripts/walk-probe.mjs [baseUrl] [shotPrefix]
//   baseUrl defaults to the local dev server (no proxy); for public
//   URLs set USE_FWD=1 and run behind the CONNECT forwarder.
import { chromium } from 'playwright-core';
import { join } from 'node:path';
const base = process.argv[2] || 'http://localhost:5173/';
const prefix = process.argv[3] || 'walk';
const useFwd = process.env.USE_FWD === '1';
// Live runs go through the CONNECT forwarder + SwiftShader Draco decode,
// so model waits get 300 s there (120 s is enough on localhost).
const tModels = useFwd ? 300000 : 120000;
const tInterior = useFwd ? 300000 : 240000;
const outDir = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/preview';
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    ...(useFwd ? ['--proxy-server=http://127.0.0.1:18080'] : [])],
});
const errors = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
const walk = () => page.evaluate(() => window.__spicaWalk || null);
const cam = () => page.evaluate(() => window.__spicaCam || null);

await page.goto(base, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(
  // Gate on the astronaut only, NOT the ISS: the ISS exterior model
  // loads intermittently through the VM forwarder (its Range probe +
  // full GET flake there — the live diag proved the app mounts, the
  // API answers and the other models load while `iss` stays unset),
  // and the interior walk does not need the exterior station at all.
  () => window.__spicaModels && window.__spicaModels.astronaut,
  null, { timeout: tModels },
);
// Expand the collapsed bottom sheet so the preset buttons are tappable.
await page.locator('button[aria-expanded]').first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: tInterior });
await page.waitForTimeout(3000);
console.log('cam-inside:', JSON.stringify(await cam()));
await page.screenshot({ path: join(outDir, `${prefix}-00-inside.png`), timeout: 120000, fromSurface: false });

// Enter walk mode (flies to the Inside framing, then takes over).
await page.getByRole('button', { name: 'Walk inside the station' }).click();
await page.waitForFunction(() => window.__spicaWalk && window.__spicaWalk.active, null, { timeout: 30000 });
await page.waitForTimeout(1000);
const w0 = await walk();
console.log('walk-start:', JSON.stringify(w0));

// Hold forward ~8 s (toward the glovebox): z must decrease.
const fwdBox = await page.getByRole('button', { name: 'Move forward' }).boundingBox();
await page.mouse.move(fwdBox.x + fwdBox.width / 2, fwdBox.y + fwdBox.height / 2);
await page.mouse.down();
await page.waitForTimeout(8000);
await page.mouse.up();
await page.waitForTimeout(500);
const w1 = await walk();
console.log('walk-forward:', JSON.stringify(w1));
await page.screenshot({ path: join(outDir, `${prefix}-01-forward.png`), timeout: 120000, fromSurface: false });

// Drag ~180° (two leftward drags, ~260 px each at 0.006 rad/px) and
// confirm the view turned to face the far hatch, not the glovebox.
for (let i = 0; i < 2; i++) {
  await page.mouse.move(330, 300);
  await page.mouse.down();
  await page.mouse.move(70, 300, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2500);
const w2 = await walk();
console.log('walk-turned:', JSON.stringify(w2));
await page.screenshot({ path: join(outDir, `${prefix}-02-turned.png`), timeout: 120000, fromSurface: false });

// Hold forward again ~4 s (back toward the far end): z must increase.
await page.mouse.move(fwdBox.x + fwdBox.width / 2, fwdBox.y + fwdBox.height / 2);
await page.mouse.down();
await page.waitForTimeout(4000);
await page.mouse.up();
await page.waitForTimeout(500);
const w3 = await walk();
console.log('walk-farend:', JSON.stringify(w3));
await page.screenshot({ path: join(outDir, `${prefix}-03-farend.png`), timeout: 120000, fromSurface: false });

// Tap the Inside preset: walk exits and the camera flies back.
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(() => window.__spicaWalk && !window.__spicaWalk.active, null, { timeout: 30000 });
await page.waitForTimeout(2500);
console.log('walk-after-exit:', JSON.stringify(await walk()));
console.log('cam-after-exit:', JSON.stringify(await cam()));
await page.screenshot({ path: join(outDir, `${prefix}-04-exit.png`), timeout: 120000, fromSurface: false });
console.log('errors:', JSON.stringify(errors));
await context.close();
await browser.close();
console.log('DONE walk-probe');

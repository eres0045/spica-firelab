/**
 * Scene screenshots — the minimal immersive fire lab (real Earth/ISS/
 * astronaut scene + ONE transparent control panel with a CAMERA section
 * — zoom −/+ and five view presets — as the only camera control).
 * No dashboard, no top-right toggle.
 *
 * Outputs preview/firelab-scene-*.png. Every console error / failed
 * request / HTTP >= 400 is reported — the optional-model GLBs are
 * downloaded now (iss-uperesito.glb, iss-interior-scan.glb), so no
 * 404s are whitelisted anymore.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
// Wait for all GLB models to finish DECODING (window.__spicaModels,
// set by FireLab3D onLoad) — Draco init is slow under SwiftShader (the
// ISS took ~16–25 s to appear in headless runs) and response timing
// alone does not prove the decode finished.
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 90000 },
).catch(() => {});
await page.waitForTimeout(2000);
const title = await page.evaluate(() => document.body.innerText.includes('The 34% Question'));
console.log('title present:', title);

// Camera settle-wait: the fly tween is wall-clock (0.9s) but headless
// SwiftShader renders ~0.5fps, so a fixed short wait can screenshot
// mid-flight. Poll the live camera (window.__spicaCam) until it has
// landed at the expected framing and stopped moving.
async function waitForSettledCam(label, expectedPos) {
  let prev = null;
  let still = 0;
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const cam = await page.evaluate(() => window.__spicaCam);
    if (cam) {
      const atDest = Math.hypot(cam.pos[0] - expectedPos[0], cam.pos[1] - expectedPos[1], cam.pos[2] - expectedPos[2]) < 0.5;
      if (prev) {
        const d = Math.hypot(cam.pos[0] - prev.pos[0], cam.pos[1] - prev.pos[1], cam.pos[2] - prev.pos[2]);
        if (d < 0.05 && atDest) { if (++still >= 2) { console.log(`${label} settled at`, JSON.stringify(cam)); return; } }
        else still = 0;
      }
      prev = cam;
    }
    await page.waitForTimeout(500);
  }
  console.log(`${label} NOT settled after 60s, last:`, JSON.stringify(prev));
}
await page.screenshot({ path: `${OUT}/firelab-scene-01-desktop-exterior.png`, timeout: 120000 });

// Exploration 34% -> flame grows orange + GAP 11.9, over the Earth scene
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/firelab-scene-02-desktop-exploration.png`, timeout: 120000 });

// Interior view: camera flies down the module axis (Inside preset), real scan around the glovebox.
// Wait for the scan to finish DECODING (window.__spicaModels.interior) —
// the 5.9 MB scan + Draco decode is slow under SwiftShader and a fixed
// short wait flaked once (shot caught the close-up fallback instead).
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.interior,
  null, { timeout: 60000 },
).catch(() => {});
await waitForSettledCam('inside', [0.1, 0.1, 4.6]);
await page.screenshot({ path: `${OUT}/firelab-scene-03-desktop-interior.png`, timeout: 120000 });

// Back to exterior, O2 to 10% -> faint dim blue flame (near-extinction nit fix)
await page.getByRole('button', { name: 'Camera view: Wide' }).click();
await waitForSettledCam('wide', [4.4, 2.3, 6.4]);
await page.locator('#o2-slider').fill('10');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/firelab-scene-04-desktop-low-o2.png`, timeout: 120000 });

// ISS preset: station + shuttle in frame.
await page.getByRole('button', { name: 'Camera view: ISS' }).click();
await waitForSettledCam('iss', [2.2, 2.4, 1.8]);
await page.screenshot({ path: `${OUT}/firelab-scene-05-desktop-iss.png`, timeout: 120000 });

// Earth preset: Earth big in frame.
await page.getByRole('button', { name: 'Camera view: Earth' }).click();
await waitForSettledCam('earth', [1.2, 0.2, 4.6]);
await page.screenshot({ path: `${OUT}/firelab-scene-06-desktop-earth.png`, timeout: 120000 });

// Chamber preset: close-up on the glovebox work volume + flame. Back to
// Exploration 34% first, so the close-up shows the big orange flame
// (the script set O2 to 10% for the low-O2 shot above).
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'Camera view: Chamber' }).click();
await waitForSettledCam('chamber', [0.4, 0.35, 3.6]);
await page.screenshot({ path: `${OUT}/firelab-scene-07-desktop-chamber.png`, timeout: 120000 });

console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

// Focused probe: interior framing + new camera presets (temp check, not a
// permanent shot script). Loads the page, waits for the GLBs to decode,
// clicks the in-panel presets and screenshots each framing.
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
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 90000 },
).catch(() => {});
await page.waitForTimeout(2000);

// Headless SwiftShader runs at ~0.5fps and the tween advances on clamped
// dt (0.05/frame), so a 0.9s fly takes ~45s of wall time — a fixed 2.5s
// wait screenshots MID-FLIGHT (camera still near the old framing, even
// outside the corridor wall). Poll the live camera instead and shoot
// only once it has LANDED at the expected framing. Stillness alone is
// NOT enough: between frames (~2s apart) the camera holds still for
// seconds mid-flight, which fooled a stillness-only check — so the
// check also requires proximity to the expected destination.
async function waitForSettledCam(label, expected) {
  let prev = null;
  let still = 0;
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const cam = await page.evaluate(() => window.__spicaCam);
    if (cam) {
      const atDest = expected.pos
        ? Math.hypot(cam.pos[0] - expected.pos[0], cam.pos[1] - expected.pos[1], cam.pos[2] - expected.pos[2]) < 0.5
        : Math.abs(Math.hypot(cam.pos[0] - cam.tgt[0], cam.pos[1] - cam.tgt[1], cam.pos[2] - cam.tgt[2]) - expected.dist) < 0.4;
      if (prev) {
        const d = Math.hypot(cam.pos[0] - prev.pos[0], cam.pos[1] - prev.pos[1], cam.pos[2] - prev.pos[2]);
        if (d < 0.05 && atDest) { if (++still >= 2) { console.log(`${label} settled at`, JSON.stringify(cam)); return cam; } }
        else still = 0;
      }
      prev = cam;
    }
    await page.waitForTimeout(500);
  }
  console.log(`${label} NOT settled after 90s, last:`, JSON.stringify(prev));
  return prev;
}

// Expected framings at 1440x900 (aspect 1.6 -> portrait scale 1), copied
// from CAMERA_PRESETS in src/components/FireLab3D.jsx.
const EXPECT = {
  inside: { pos: [0.1, 0.1, 4.6] },
  zoomedIn: { dist: 4.24 }, // one zoom-in x0.8 from 5.30
  zoomedOut: { dist: 5.30 }, // one zoom-out x1.25 back from 4.24
  iss: { pos: [2.2, 2.4, 1.8] },
  earth: { pos: [1.2, 0.2, 4.6] },
  chamber: { pos: [0.4, 0.35, 3.6] },
};

// Interior first: the hero framing — glovebox front and centre, flame visible.
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.interior,
  null, { timeout: 60000 },
).catch(() => {});
await waitForSettledCam('inside', EXPECT.inside);
await page.screenshot({ path: `${OUT}/probe-interior.png`, timeout: 120000 });

// Zoom in once inside, then back out — the dolly must work in the interior.
await page.getByRole('button', { name: 'Zoom in' }).click();
await waitForSettledCam('inside zoomed-in', EXPECT.zoomedIn);
await page.screenshot({ path: `${OUT}/probe-interior-zoomed.png`, timeout: 120000 });
await page.getByRole('button', { name: 'Zoom out' }).click();
await waitForSettledCam('inside zoomed-out', EXPECT.zoomedOut);

// ISS preset, then Earth preset.
await page.getByRole('button', { name: 'Camera view: ISS' }).click();
await waitForSettledCam('iss', EXPECT.iss);
await page.screenshot({ path: `${OUT}/probe-iss.png`, timeout: 120000 });
await page.getByRole('button', { name: 'Camera view: Earth' }).click();
await waitForSettledCam('earth', EXPECT.earth);
await page.screenshot({ path: `${OUT}/probe-earth.png`, timeout: 120000 });
await page.getByRole('button', { name: 'Camera view: Chamber' }).click();
await waitForSettledCam('chamber', EXPECT.chamber);
await page.screenshot({ path: `${OUT}/probe-chamber.png`, timeout: 120000 });

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();

// Lean close-up probe for the interior-sharpness comparison: Inside +
// Chamber shots only, same framing as firelab-scene-shots.mjs (03 + 07).
// Usage: node closeup-probe.mjs <tag>  -> preview/closeup-<tag>-interior.png
// and preview/closeup-<tag>-chamber.png. Zero-error report on stdout.
import { chromium } from 'playwright-core';

const tag = process.argv[2] || 'x';
const OUT = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/preview';
const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut,
  null, { timeout: 90000 },
).catch(() => {});
await page.waitForTimeout(2000);

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
        if (d < 0.05 && atDest) { if (++still >= 2) { console.log(`${label} settled at`, JSON.stringify(cam)); return; } } else still = 0;
      }
      prev = cam;
    }
    await page.waitForTimeout(500);
  }
  console.log(`${label} NOT settled after 60s, last:`, JSON.stringify(prev));
}

await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 60000 }).catch(() => {});
await waitForSettledCam('inside', [0.1, 0.1, 4.6]);
await page.screenshot({ path: `${OUT}/closeup-${tag}-interior.png`, timeout: 120000 });

await page.getByRole('button', { name: 'Camera view: Chamber' }).click();
await waitForSettledCam('chamber', [0.4, 0.35, 3.6]);
await page.screenshot({ path: `${OUT}/closeup-${tag}-chamber.png`, timeout: 120000 });

console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

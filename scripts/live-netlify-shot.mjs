// One-off: open the PUBLIC GitHub Pages link in this machine's browser
// and screenshot it (exterior + interior) — proves the live link works
// over the internet, not just on localhost.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');
// This VM has no direct egress — only the MITM egress proxy (in env).
// Chromium cannot CONNECT through it directly (ERR_TUNNEL_CONNECTION_FAILED),
// so it goes via the local CONNECT forwarder on 127.0.0.1:18080
// (~/workspace/tmp-connect-fwd.mjs), which re-issues the CONNECT with the
// proxy credentials. ignoreHTTPSErrors covers the MITM CA.
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--proxy-server=http://127.0.0.1:18080'],
});
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await page.goto('https://spica-firelab.netlify.app/', { waitUntil: 'networkidle', timeout: 90000 });
// Wait for all GLB models to finish decoding.
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 120000 },
);
await page.waitForTimeout(3000);
await page.screenshot({ path: join(outDir, 'live-netlify-exterior.png') });

// Interior: click the Inside preset and wait for the camera to land.
await page.getByRole('button', { name: 'Camera view: Inside' }).click();
await page.waitForFunction(
  () => {
    const cam = window.__spicaCam;
    return cam && Math.abs(cam.pos[0] - 0.1) < 0.05 && Math.abs(cam.pos[1] - 0.1) < 0.05
      && Math.abs(cam.pos[2] - 4.6) < 0.05;
  },
  null, { timeout: 30000 },
);
await page.waitForTimeout(2000);
await page.screenshot({ path: join(outDir, 'live-netlify-interior.png') });

console.log(JSON.stringify({ errors }));
await browser.close();

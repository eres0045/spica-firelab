// One-off live tour check (2026-11-11): the standard live shots
// screenshot 2s after the Inside landing, while the 37MB tour GLB is
// still downloading — so this script waits for __spicaModels.interior
// on each public URL before screenshotting, proving the tour renders
// live, not just locally. Uses the CONNECT forwarder on 127.0.0.1:18080.
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--proxy-server=http://127.0.0.1:18080'],
});
for (const [name, url, shot] of [
  ['netlify', 'https://spica-firelab.netlify.app/', 'live-netlify-interior-tour.png'],
  ['pages', 'https://eres0045.github.io/spica-firelab/', 'live-public-interior-tour.png'],
]) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(
    () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
      && window.__spicaModels.dragon && window.__spicaModels.intball
      && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
    null, { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Camera view: Inside' }).click();
  await page.waitForFunction(() => window.__spicaModels && window.__spicaModels.interior, null, { timeout: 240000 });
  await page.waitForTimeout(5000);
  const cam = await page.evaluate(() => window.__spicaCam || null);
  console.log(name, JSON.stringify({ cam, errors }));
  await page.screenshot({ path: join(outDir, shot), timeout: 120000, fromSurface: false });
  await context.close();
}
await browser.close();
console.log('DONE live-tour');

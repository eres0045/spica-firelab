// Live check: open BOTH public URLs through the CONNECT forwarder and
// prove the app is served by the live API (not the bundled fallback):
// the source tag must read "live API" and SIBAL @ Exploration must show
// GAP 11.9 O2 pts. Screenshots land in preview/.
//
// Needs the forwarder running first:
//   node ~/workspace/tmp-connect-fwd.mjs & echo $! > /tmp/fwd.pid
//   node scripts/live-api-verify.mjs
//   kill $(cat /tmp/fwd.pid)
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--proxy-server=http://127.0.0.1:18080'],
});

const results = {};
for (const [name, url, shot] of [
  ['netlify', 'https://spica-firelab.netlify.app/', 'live-api-netlify.png'],
  ['pages', 'https://eres0045.github.io/spica-firelab/', 'live-api-pages.png'],
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
  // Wait for the API probe to settle (tag appears once verdicts load).
  await page.waitForFunction(
    () => document.body.innerText.includes('live API') || document.body.innerText.includes('on-device data'),
    null, { timeout: 30000 },
  );
  const tag = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => /live API|on-device data/.test(n.textContent) && n.children.length === 0);
    return el ? el.textContent.trim() : null;
  });
  // Switch to the Exploration atmosphere and read the verdict line.
  await page.getByRole('button', { name: 'Exploration · 34% O₂' }).click();
  await page.waitForTimeout(1500);
  const verdict = await page.evaluate(() => {
    const m = document.body.innerText.match(/SIBAL fabric · Exploration 34%[^\n]*/);
    return m ? m[0] : null;
  });
  await page.screenshot({ path: join(outDir, shot) });
  results[name] = { tag, verdict, errors };
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));

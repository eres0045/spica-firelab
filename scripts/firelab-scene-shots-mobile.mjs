/**
 * Mobile-only scene screenshot — fresh browser, single mobile page
 * (the combined script's mobile shot timed out in v1 because the desktop
 * page's WebGL loop was still running in the same browser).
 * No 404 whitelist: both Sketchfab GLBs are downloaded now.
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
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
mob.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
mob.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
mob.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
// Same decode wait as the desktop script (window.__spicaModels flags).
await mob.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 90000 },
).catch(() => {});
await mob.waitForTimeout(2000);
await mob.screenshot({ path: `${OUT}/firelab-scene-05-mobile-default.png`, timeout: 120000 });
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

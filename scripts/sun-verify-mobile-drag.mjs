/**
 * Sun verification — mobile drag shot, take 2. The first attempt used
 * three big drags and flipped the camera under the target. This run
 * does ONE small drag (right 89px, up 58px ≈ rotate azimuth 38°,
 * polar +25°), which should centre the Sun at (1.8, 2.3, -28.5) in the
 * frame, then screenshots. Fresh browser, mobile only.
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
mob.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mob.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
    && window.__spicaModels.dragon && window.__spicaModels.intball
    && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
  null, { timeout: 120000 },
).catch(() => {});
await mob.waitForTimeout(3000);
console.log('mobile cam before:', JSON.stringify(await mob.evaluate(() => window.__spicaCam)));
await mob.mouse.move(195, 400);
await mob.mouse.down();
await mob.mouse.move(284, 342, { steps: 15 });
await mob.mouse.up();
await mob.waitForTimeout(2500);
console.log('mobile cam after drag:', JSON.stringify(await mob.evaluate(() => window.__spicaCam)));
await mob.screenshot({ path: `${OUT}/sun-03-mobile-sun.png`, timeout: 120000 });
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

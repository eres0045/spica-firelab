/**
 * Sun verification — exterior screenshots (desktop + mobile) after the
 * Sun was added at (1.8, 2.3, -28.5), plus a mobile drag-to-Sun shot
 * (the mobile portrait frame is a narrow slice — the upper-right Sun is
 * out of the default mobile frame, so the drag proves it renders on
 * mobile too). Reports every console error / failed request / HTTP >= 400,
 * and explicitly checks the 2k_sun.jpg texture request succeeded.
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
let sunTexOk = false;
const track = (page) => {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
  page.on('response', (r) => {
    if (r.url().includes('2k_sun.jpg')) sunTexOk = r.status() === 200;
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
};

async function waitModels(page) {
  await page.waitForFunction(
    () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut
      && window.__spicaModels.dragon && window.__spicaModels.intball
      && window.__spicaModels.shuttle && window.__spicaModels.canadarm && window.__spicaModels.lro,
    null, { timeout: 90000 },
  ).catch(() => {});
  await page.waitForTimeout(2000);
}

// --- Desktop: default Wide exterior ---
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
track(page);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await waitModels(page);
console.log('desktop cam:', JSON.stringify(await page.evaluate(() => window.__spicaCam)));
await page.screenshot({ path: `${OUT}/sun-01-desktop-exterior.png`, timeout: 120000 });

// --- Mobile: default frame + drag toward the Sun (upper-right) ---
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
track(mob);
await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await waitModels(mob);
await mob.screenshot({ path: `${OUT}/sun-02-mobile-default.png`, timeout: 120000 });
// Drag right + up on the canvas: OrbitControls drag-right looks right,
// drag-up looks up — the Sun sits upper-right of the default frame.
const canvas = mob.locator('canvas').first();
const box = await canvas.boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 3; i++) {
    await mob.mouse.move(cx, cy);
    await mob.mouse.down();
    await mob.mouse.move(cx + 130, cy - 110, { steps: 12 });
    await mob.mouse.up();
    await mob.waitForTimeout(1200);
  }
}
console.log('mobile cam after drag:', JSON.stringify(await mob.evaluate(() => window.__spicaCam)));
await mob.screenshot({ path: `${OUT}/sun-03-mobile-sun.png`, timeout: 120000 });

console.log(JSON.stringify({ sunTexture200: sunTexOk, errors: errors.slice(0, 10) }, null, 2));
await browser.close();

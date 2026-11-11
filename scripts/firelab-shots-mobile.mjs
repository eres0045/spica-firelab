/**
 * Mobile-only screenshot retry — the full firelab-shots.mjs run's mobile
 * shot timed out (30 s) because the desktop page's WebGL loop was still
 * running in the same browser. This script uses a fresh browser with a
 * single mobile page and a 120 s screenshot timeout.
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
await mob.waitForTimeout(8000);
await mob.screenshot({ path: `${OUT}/firelab-07-mobile-default.png`, timeout: 120000 });
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

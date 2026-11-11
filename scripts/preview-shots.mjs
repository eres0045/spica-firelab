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

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/01-desktop-default.png` });

// Exploration 34% -> the headline GAP 11.9 view
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/02-desktop-exploration-gap.png` });

// Methanol droplet at Exploration -> pressure GAP 1.98 psi
await page.getByRole('button', { name: /Methanol droplet/ }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/03-desktop-methanol.png` });

// Mobile view, default
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on('pageerror', (e) => errors.push('mobile: ' + e.message));
await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mob.waitForTimeout(5000);
await mob.screenshot({ path: `${OUT}/04-mobile-default.png` });

console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

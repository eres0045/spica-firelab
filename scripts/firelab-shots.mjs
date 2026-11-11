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
await page.waitForTimeout(6000); // flame + GLB model load
const title = await page.evaluate(() => document.body.innerText.includes('The 34% Question'));
console.log('title present:', title);
await page.screenshot({ path: `${OUT}/firelab-01-desktop-default.png` });

// Exploration 34% -> flame grows orange + GAP 11.9
await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/firelab-02-desktop-exploration.png` });

// Methanol droplet at Exploration -> pressure GAP 1.98 psi
await page.getByRole('button', { name: /Methanol droplet/ }).first().click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/firelab-03-desktop-methanol.png` });

// Mission 1: start -> apply in lab -> quiz -> answer GAP
await page.getByRole('button', { name: /Start mission/ }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Apply in the lab/ }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/firelab-04-desktop-mission-setup.png` });
await page.getByRole('button', { name: /Quiz me/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'GAP', exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/firelab-05-desktop-mission-quiz.png` });

// Evidence tab: the scatter is still there
await page.getByRole('button', { name: /Evidence — test cloud/ }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/firelab-06-desktop-evidence.png` });

// Back to the lab: O2 to 10% -> small blue flame + smoke (near extinction)
await page.getByRole('button', { name: /Fire Lab/ }).click();
await page.waitForTimeout(500);
await page.locator('#o2-slider').fill('10');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/firelab-08-desktop-low-o2.png` });

// Flow to 30 cm/s -> flame elongates downstream
await page.locator('#o2-slider').fill('34');
await page.locator('#flow-slider').fill('30');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/firelab-09-desktop-high-flow.png` });

// Mobile default
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
mob.on('pageerror', (e) => errors.push('mobile: ' + e.message));
await mob.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await mob.waitForTimeout(6000);
await mob.screenshot({ path: `${OUT}/firelab-07-mobile-default.png` });

console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 2));
await browser.close();

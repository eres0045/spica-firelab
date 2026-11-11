// One-off live screenshot: the app as it runs on this machine right now.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'preview', 'live-now-desktop.png');
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(9000); // let the GLBs + flame settle
await page.screenshot({ path: out });
console.log(JSON.stringify({ shot: out, errors }));
await browser.close();

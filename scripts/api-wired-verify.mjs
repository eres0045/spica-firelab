// Verify the API-wired app locally: Flask (:5000) + Vite dev (:5173,
// /api proxied to Flask). Proves the panel's verdict line comes from
// the live API ("live API" tag) and the mission brief opens with the
// ranking + citations. Localhost needs no CONNECT forwarder.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'preview');
const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
const result = {};
async function newPage(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`reqfail: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  return { context, page };
}

// Desktop.
{
  const { context, page } = await newPage(1440, 900);
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText(/live API/, { exact: false }).waitFor({ timeout: 30000 });
  result.desktopTag = await page.getByText(/live API/).first().textContent();
  result.desktopVerdict = await page.locator('p[aria-live="polite"]').textContent();
  // Exploration via the API: SIBAL GAP 11.9.
  await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
  await page.getByText(/GAP 11\.9 O₂ pts/).waitFor({ timeout: 30000 });
  result.explorationVerdict = await page.locator('p[aria-live="polite"]').textContent();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(outDir, 'api-desktop-exploration.png') });
  // Mission brief.
  await page.getByRole('button', { name: 'Open mission brief' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mission brief' });
  await dialog.waitFor({ timeout: 10000 });
  result.briefHeading = await dialog.locator('h2').textContent();
  result.briefHasDoi = (await dialog.getByText(/DOI 10\.60555\/2chp-m469/).count()) > 0;
  await page.screenshot({ path: join(outDir, 'api-desktop-brief.png') });
  await context.close();
}

// Mobile 390x844.
{
  const { context, page } = await newPage(390, 844);
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText(/live API/, { exact: false }).waitFor({ timeout: 30000 });
  result.mobileTag = await page.getByText(/live API/).first().textContent();
  await page.screenshot({ path: join(outDir, 'api-mobile.png') });
  await context.close();
}

console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();

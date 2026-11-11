/**
 * Headless-browser smoke test for the built SPICA frontend (served from dist/).
 * Run 1 (default): WebGL via SwiftShader — 3D scatter + model viewer must load.
 * Run 2 (--disable-webgl): the 2D fallback must render identical verdicts.
 * Usage: node /tmp/spica-smoke.mjs
 */
import { chromium } from 'playwright-core';

const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';
const out = {};

async function run(name, launchArgs) {
  const browser = await chromium.launch({ executablePath: EXE, args: launchArgs });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failedReqs = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failedReqs.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.url()} :: HTTP ${r.status()}`); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  // Wait for the model loader to clear (up to 15 s) instead of a fixed
  // 4 s sleep: in this throttled headless environment the GLB request
  // starts ~1.4 s after networkidle (2.4 MB bundle still parsing) and the
  // Draco decode lands around 7-9 s wall-clock, so a fixed 4 s check
  // flaked even though the model loads fine (verified by model-probe and
  // by the preview screenshots). The check still fails if the loader
  // never clears — it just waits for it first.
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000); // let the auto-rotating scenes settle
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  });
  const bodyText = await page.evaluate(() => document.body.innerText);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  const svgCircles = await page.evaluate(() => document.querySelectorAll('svg circle').length);

  const checks = {
    title: bodyText.includes('The 34% Question'),
    defaultPartial: bodyText.includes('PARTIAL') && bodyText.includes('nearest test 20.8%'),
    canvases, svgCircles, webgl,
    modelLoadingGone: !bodyText.includes('Loading ISS (A)…'),
  };

  // Demo flow: Exploration -> SIBAL GAP 11.9
  await page.getByRole('button', { name: /Exploration · 34% O₂/ }).click();
  await page.waitForTimeout(1500);
  let t = await page.evaluate(() => document.body.innerText);
  checks.explorationGap = t.includes('11.9') && t.includes('No SIBAL fabric test ran above 22.1%');

  // Methanol droplet at Exploration -> pressure GAP 1.98 psi
  await page.getByRole('button', { name: /Methanol droplet/ }).first().click();
  await page.waitForTimeout(1200);
  t = await page.evaluate(() => document.body.innerText);
  checks.methanolGap = t.includes('1.98') && t.includes('nearest tested pressure is 10.18 psi');

  // Switch to 2D view explicitly and count plotted points.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForTimeout(800);
  const svgCount = await page.evaluate(() => document.querySelectorAll('svg circle').length);
  checks.svgPointsAfter2DToggle = svgCount;
  t = await page.evaluate(() => document.body.innerText);
  checks.verdictSameIn2D = t.includes('1.98') && t.includes('10.18 psi');

  await page.screenshot({ path: `/tmp/spica-${name}.png`, fullPage: false });
  out[name] = { ...checks, errors: errors.slice(0, 10), failedReqs: failedReqs.slice(0, 10) };
  await browser.close();
}

await run('webgl', ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
await run('nogl', ['--disable-webgl', '--disable-webgl2']);
console.log(JSON.stringify(out, null, 2));

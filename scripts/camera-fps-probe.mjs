/**
 * Camera FPS probe — measures REAL frame times during camera movement
 * (drag-look sweeps, zoom in/out, preset fly-tweens) plus a slider-drag
 * control phase, on desktop and mobile viewports.
 *
 * Two signals:
 *  - rAF deltas per phase (frame time distribution) — under SwiftShader
 *    (software raster) absolute FPS is a floor, NOT the phone's number;
 *    what matters is the idle-vs-drag-vs-zoom comparison and the tail.
 *  - PerformanceObserver 'longtask' entries (>50ms main-thread tasks)
 *    per phase — this is the JS-side jank we can actually fix without
 *    touching quality. If drag/zoom produce no longtasks, the bottleneck
 *    is GPU raster, not JS, and no code change will buy FPS.
 *
 * Usage: node scripts/camera-fps-probe.mjs [--mobile]
 * Output: JSON summary to stdout.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const EXE_REAL = `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`;
const URL = 'http://localhost:4173/';
const OUT = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/preview';

const mobile = process.argv.includes('--mobile');
const viewport = mobile
  ? { width: 390, height: 844, deviceScaleFactor: 2 }
  : { width: 1440, height: 900, deviceScaleFactor: 1 };

const browser = await chromium.launch({
  executablePath: EXE_REAL,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({ viewport });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Install the collectors BEFORE the app loads.
await page.addInitScript(() => {
  window.__fpsFrames = [];
  window.__fpsPhase = 'boot';
  window.__longTasks = [];
  let last = 0;
  const tick = (t) => {
    if (last) window.__fpsFrames.push({ t, dt: t - last, phase: window.__fpsPhase });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longTasks.push({ start: e.startTime, dur: e.duration, phase: window.__fpsPhase });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* PerformanceObserver unavailable */ }
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(
  () => window.__spicaModels && window.__spicaModels.iss && window.__spicaModels.astronaut,
  null, { timeout: 90000 },
).catch(() => {});
// Let lazy models settle so their decode doesn't pollute the phases.
await page.waitForTimeout(5000);

const setPhase = (p) => page.evaluate((ph) => { window.__fpsPhase = ph; }, p);
const sleep = (ms) => page.waitForTimeout(ms);

async function statsFor(phase) {
  return page.evaluate((ph) => {
    const rows = window.__fpsFrames.filter((f) => f.phase === ph);
    const dts = rows.map((f) => f.dt).sort((a, b) => a - b);
    const longs = window.__longTasks.filter((t) => t.phase === ph);
    if (!dts.length) return { phase: ph, frames: 0, longTasks: longs };
    const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
    return {
      phase: ph,
      frames: dts.length,
      meanDtMs: +mean.toFixed(1),
      meanFps: +(1000 / mean).toFixed(2),
      medianDtMs: +q(0.5).toFixed(1),
      p95DtMs: +q(0.95).toFixed(1),
      maxDtMs: +dts[dts.length - 1].toFixed(1),
      over50ms: dts.filter((d) => d > 50).length,
      over100ms: dts.filter((d) => d > 100).length,
      longTasks: longs.map((t) => ({ start: Math.round(t.start), dur: Math.round(t.dur) })),
    };
  }, phase);
}

const results = { viewport: mobile ? 'mobile 390x844 @dpr2' : 'desktop 1440x900 @dpr1', phases: {} };

// 1. Idle — flame animating, camera still (control phase).
await setPhase('idle');
await sleep(8000);
results.phases.idle = await statsFor('idle');

// 2. Drag-look sweeps on the canvas (centre of the scene, away from the panel).
await setPhase('drag');
const cx = mobile ? 195 : 900;
const cy = mobile ? 420 : 450;
for (let s = 0; s < 3; s++) {
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx - 150 + (300 * i) / 20, cy + Math.sin(i / 3) * 30, { steps: 1 });
    await sleep(60);
  }
  await page.mouse.up();
  await sleep(400);
}
await sleep(2000);
results.phases.drag = await statsFor('drag');

// 3. Zoom in/out via the panel buttons. Mobile: the panel starts
//    collapsed — expand it first so the zoom buttons exist.
await setPhase('zoom');
await page.getByRole('button', { name: 'Expand fire controls' }).click({ timeout: 3000 }).catch(() => {});
await sleep(1000);
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await sleep(1200);
}
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await sleep(1200);
}
await sleep(2000);
results.phases.zoom = await statsFor('zoom');

// 4. Preset fly-tweens (ISS -> Wide -> Earth).
await setPhase('preset');
for (const name of ['Camera view: ISS', 'Camera view: Wide', 'Camera view: Earth']) {
  await page.getByRole('button', { name }).click();
  await sleep(2500);
}
await sleep(1500);
results.phases.preset = await statsFor('preset');

// 5. Slider drag (O2) — React re-render control: does panel state churn jank the scene?
await setPhase('slider');
await page.locator('#o2-slider').fill('30');
await sleep(1500);
await page.locator('#o2-slider').fill('15');
await sleep(1500);
await page.locator('#o2-slider').fill('34');
await sleep(2500);
results.phases.slider = await statsFor('slider');

results.errors = errors.slice(0, 10);
results.renderer = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
// JS-vs-raster split, when the app exposes window.__spicaFrameTimes
// (per-frame { js, render } ms samples from the animate loop).
results.frameSplit = await page.evaluate(() => {
  const rows = window.__spicaFrameTimes;
  if (!rows || !rows.length) return null;
  const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  const q = (k, p) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length * p)];
  return {
    samples: rows.length,
    jsMeanMs: +avg('js').toFixed(2),
    jsP95Ms: +q('js', 0.95).toFixed(2),
    renderMeanMs: +avg('render').toFixed(2),
    renderP95Ms: +q('render', 0.95).toFixed(2),
  };
});
const tag = process.argv.includes('--after') ? 'after' : 'baseline';
const outPath = `${OUT}/camera-fps-${mobile ? 'mobile' : 'desktop'}-${tag}.json`;
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log('wrote', outPath);
console.log(JSON.stringify(results, null, 2));
await browser.close();

/**
 * FireLab3D tests — flame visual mapping (pure function) + the no-WebGL
 * fallback render (jsdom has no WebGL, so the lab must degrade to the
 * fallback text instead of crashing).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import FireLab3D, { flameParams, CAMERA_PRESETS, zoomDistance, FLAME_CENTER } from './FireLab3D.jsx';

describe('flameParams — the flame visibly responds to the controls', () => {
  it('grows with O2 (small blue ball at low O2, big orange ball at high O2)', () => {
    const low = flameParams({ materialClass: 'solid', o2: 10, pressure: 10, flow: 0 });
    const high = flameParams({ materialClass: 'solid', o2: 40, pressure: 10, flow: 0 });
    expect(high.radius).toBeGreaterThan(low.radius * 1.8);
    // Low O2: blue dominates (b > r). High O2: orange (r > 200, r > b).
    const lowRgb = [1, 3, 5].map((i) => parseInt(low.color.slice(i, i + 2), 16));
    const highRgb = [1, 3, 5].map((i) => parseInt(high.color.slice(i, i + 2), 16));
    expect(lowRgb[2]).toBeGreaterThan(lowRgb[0]);
    expect(highRgb[0]).toBeGreaterThan(200);
    expect(highRgb[0]).toBeGreaterThan(highRgb[2]);
  });

  it('flickers near extinction at low O2 and steadies as O2 rises', () => {
    expect(flameParams({ materialClass: 'solid', o2: 12, pressure: 10, flow: 0 }).nearExtinct).toBe(true);
    expect(flameParams({ materialClass: 'solid', o2: 20, pressure: 10, flow: 0 }).nearExtinct).toBe(false);
    expect(flameParams({ materialClass: 'solid', o2: 12, pressure: 10, flow: 0 }).flicker)
      .toBeGreaterThan(flameParams({ materialClass: 'solid', o2: 30, pressure: 10, flow: 0 }).flicker);
  });

  it('elongates with flow and brightens with pressure', () => {
    const still = flameParams({ materialClass: 'droplet', o2: 25, pressure: 10, flow: 0 });
    const windy = flameParams({ materialClass: 'droplet', o2: 25, pressure: 10, flow: 30 });
    expect(still.elong).toBe(1);
    expect(windy.elong).toBeGreaterThan(1.5);
    expect(windy.flowShift).toBeGreaterThan(still.flowShift);
    expect(flameParams({ materialClass: 'solid', o2: 25, pressure: 15, flow: 0 }).brightness)
      .toBeGreaterThan(flameParams({ materialClass: 'solid', o2: 25, pressure: 6, flow: 0 }).brightness);
  });

  it('droplet flames are smaller than solid flames at the same O2', () => {
    const s = flameParams({ materialClass: 'solid', o2: 30, pressure: 10, flow: 0 });
    const d = flameParams({ materialClass: 'droplet', o2: 30, pressure: 10, flow: 0 });
    expect(d.radius).toBeLessThan(s.radius);
  });
});

describe('CAMERA_PRESETS — the panel camera section (no top-right toggle)', () => {
  it('has all five views: Wide, Chamber, ISS, Inside, Earth', () => {
    expect(Object.keys(CAMERA_PRESETS).sort()).toEqual(['chamber', 'earth', 'inside', 'iss', 'wide']);
    for (const p of Object.values(CAMERA_PRESETS)) {
      expect(p.view === 'exterior' || p.view === 'interior').toBe(true);
      for (const v of [...p.pos, ...p.target]) expect(Number.isFinite(v)).toBe(true);
      expect(p.min).toBeGreaterThan(0);
      expect(p.max).toBeGreaterThan(p.min);
      expect(typeof p.label).toBe('string');
    }
    expect(CAMERA_PRESETS.inside.view).toBe('interior');
    expect(CAMERA_PRESETS.chamber.view).toBe('interior');
    for (const name of ['wide', 'iss', 'earth']) {
      expect(CAMERA_PRESETS[name].view).toBe('exterior');
    }
  });

  it('every preset framing sits inside its own zoom limits, so OrbitControls never clamps it on landing', () => {
    // 2026-11-11: the Earth preset's distance (18.4) exceeded its max
    // (16), so the camera landed clamped at radius 16 instead of the
    // framing — the headless probe caught it (90s without settling).
    for (const [name, p] of Object.entries(CAMERA_PRESETS)) {
      const d = Math.hypot(...p.pos.map((v, i) => v - p.target[i]));
      expect(d, `${name} distance ${d.toFixed(2)}`).toBeGreaterThanOrEqual(p.min);
      expect(d, `${name} distance ${d.toFixed(2)}`).toBeLessThanOrEqual(p.max);
    }
  });
  it('Inside targets the flame centre (inside the glovebox work volume), down the module axis', () => {
    // Interior-first framing (2026-11-11): the scan is a long thin
    // corridor (raw 15.26 long x ~3.5 diameter) and only near-axis
    // directions have a clear sightline to the flame — measured with
    // scripts/scan-raycast-probe.mjs (diagonal views hit racks at ~1.1
    // units; the axis is clear for 13.5+ units). So the camera sits on
    // the +Z axis, ~5 units out, aiming at the flame centre inside the
    // glovebox work volume. The Chamber preset is the same target, closer.
    expect(CAMERA_PRESETS.inside.target).toEqual([FLAME_CENTER.x, FLAME_CENTER.y, FLAME_CENTER.z]);
    // Chamber aims a touch below the flame (y 0.0 vs 0.1) so the whole
    // glovebox front — window + control strip — sits centred, not just the
    // ball. Still on the flame's axis, same z.
    expect(CAMERA_PRESETS.chamber.target[0]).toBe(FLAME_CENTER.x);
    expect(CAMERA_PRESETS.chamber.target[2]).toBe(FLAME_CENTER.z);
    expect(Math.abs(CAMERA_PRESETS.chamber.target[1] - FLAME_CENTER.y)).toBeLessThan(0.15);
    const d = Math.hypot(...CAMERA_PRESETS.inside.pos.map((v, i) => v - CAMERA_PRESETS.inside.target[i]));
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(5.5);
    // On-axis: |x| and |y| offsets are tiny vs the z distance.
    expect(Math.abs(CAMERA_PRESETS.inside.pos[0])).toBeLessThan(0.5);
    expect(Math.abs(CAMERA_PRESETS.inside.pos[2])).toBeGreaterThan(4.5);
    // Chamber is a closer look at the same flame, from the same axis —
    // far enough back that the whole glovebox front reads in frame.
    const dc = Math.hypot(...CAMERA_PRESETS.chamber.pos.map((v, i) => v - CAMERA_PRESETS.chamber.target[i]));
    expect(dc).toBeGreaterThan(3.5);
    expect(dc).toBeLessThan(5);
  });

  it('zoomDistance clamps the dolly to the view limits', () => {
    expect(zoomDistance(5, 0.8, 4, 16)).toBe(4); // would pass the min
    expect(zoomDistance(5, 0.8, 1.2, 6)).toBe(4); // in range, unchanged
    expect(zoomDistance(5, 1.25, 4, 16)).toBe(6.25);
    expect(zoomDistance(15, 1.25, 4, 16)).toBe(16); // would pass the max
    expect(zoomDistance(1.5, 0.8, 1.2, 6)).toBeCloseTo(1.2, 10); // clamped at the min (1.5*0.8 floats to 1.2000000000000002)
    expect(zoomDistance(5, 1, 4, 16)).toBe(5); // factor 1 = no move
  });
});

describe('FireLab3D render (jsdom — no WebGL)', () => {
  it('shows the no-WebGL fallback instead of crashing', () => {
    render(
      <FireLab3D o2={21} pressure={14.7} flow={0} material="SIBAL fabric" materialClass="solid"
        atmosphereKey="ISS" />,
    );
    expect(screen.getByText(/The 3D fire lab needs WebGL/)).toBeTruthy();
    expect(screen.getByText(/The sliders and the safety verdict still work/)).toBeTruthy();
  });
});

describe('game assets shipped in public/ (GAME_ASSETS.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pub = join(here, '..', '..', 'public');
  const expected = [
    'hdr/qwantani_night_puresky_1k.hdr',
    'sprites/flame_05.png',
    'sprites/flame_01.png',
    'sprites/flame_02.png',
    'sprites/fire_01.png',
    'sprites/smoke_03.png',
    'sprites/light_01.png',
    'sprites/star_04.png',
    'sprites/kenney-license.txt',
  ];
  it.each(expected)('%s exists and is non-empty', (rel) => {
    const p = join(pub, rel);
    expect(existsSync(p), `${rel} missing from public/`).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(0);
  });
  it('the HDRI is a real Radiance file, not a placeholder', () => {
    const buf = readFileSync(join(pub, 'hdr/qwantani_night_puresky_1k.hdr'));
    expect(buf.slice(0, 10).toString('ascii')).toBe('#?RADIANCE');
  });
});

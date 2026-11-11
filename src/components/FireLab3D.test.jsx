/**
 * FireLab3D tests — flame visual mapping (pure function) + the no-WebGL
 * fallback render (jsdom has no WebGL, so the lab must degrade to the
 * fallback text instead of crashing).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { render, screen } from '@testing-library/react';
import FireLab3D, { flameParams, CAMERA_PRESETS, zoomDistance, clampInteriorCamera, INTERIOR_CLAMP, FLAME_CENTER, DESTINY, destinyInteriorTransform, WALK, normalizeYaw, clampPitch, lookOrientationFromDirection, walkVectors, walkStep, clampWalkPosition } from './FireLab3D.jsx';

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
    // Interior-first framing (2026-11-11): Destiny (US Lab) is centred
    // on the glovebox — x ±2.50, y ±3.18, z ±6.21 in scene units (see
    // DESTINY) — and only near-axis directions have a clear sightline
    // to the flame; the sphere-map probe raycasts the real tour geometry
    // from the clamped poses (scripts/clamp-sphere-map-tour.mjs). So the
    // camera sits on the +Z axis, ~5 units out, aiming at the flame
    // centre inside the glovebox work volume. The Chamber preset is the
    // same target, closer.
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

describe('clampInteriorCamera — the camera can never reach the mush zone', () => {
  // Measured from the real tour (blur-investigation/clamp-sphere-map-
  // tour-results.txt, scripts/destiny-clearance.mjs): Destiny's aisle
  // is x ±1.63 and the CEVIS bike + mount protrude into it at z 0..2.35,
  // x 0.6+. The shape that measures 0/150 mush at every radius
  // (1.2, 3, 5.3, 6, 9) is a cone around the module axis through the
  // flame centre plus an asymmetric z-range, with a tighter near cap
  // in the bike zone (z <= 2.5): lateral 1.0 for R<=3 else 3.0/R, but
  // 0.55 in the bike zone; z in [0.3, 5.5] (never behind the glovebox
  // glass, never past the forward bulkhead dome).
  const close = (got, want) => {
    expect(got.length).toBe(3);
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
  };

  it('has the measured cone + z-range constants', () => {
    expect(INTERIOR_CLAMP.lateral).toBe(1.0);
    expect(INTERIOR_CLAMP.knee).toBe(3);
    expect(INTERIOR_CLAMP.mountLateral).toBe(0.55);
    expect(INTERIOR_CLAMP.mountZMax).toBe(2.5);
    expect(INTERIOR_CLAMP.zMin).toBe(0.3);
    expect(INTERIOR_CLAMP.zMax).toBe(5.5);
    // Derived lateral caps: R6 -> 0.50, R9 -> 0.33.
    expect(3.0 / 6).toBeCloseTo(0.5, 10);
    expect(3.0 / 9).toBeCloseTo(0.333, 3);
  });

  it('leaves positions inside the cone untouched', () => {
    expect(clampInteriorCamera([0.1, 0.1, 4.6])).toEqual([0.1, 0.1, 4.6]); // Inside landing
    expect(clampInteriorCamera([0.4, 0.35, 3.6])).toEqual([0.4, 0.35, 3.6]); // Chamber landing
    expect(clampInteriorCamera([0.5, 0.1, 2.3])).toEqual([0.5, 0.1, 2.3]); // inside the bike-zone cone at R~3.04
    expect(clampInteriorCamera([0.7, 0.1, 3.0])).toEqual([0.7, 0.1, 3.0]); // outside the bike zone, inside the loose cone
  });

  it('projects outside positions onto the cone (radius-preserving), then caps z', () => {
    // Just outside the bike-zone cone at R~3.23 (lateral 1.2 vs cap 0.55).
    close(clampInteriorCamera([1.2, 0.1, 2.3]), [0.55, 0.1, 2.484]);
    // Behind the glovebox glass: the cone projects, then z floors at 0.3.
    close(clampInteriorCamera([1.1, 2.13, -2.61]), [0.262, 0.584, 0.3]);
    // Sideways out of the module: lateral capped, then z capped at 5.5.
    close(clampInteriorCamera([5, 0.1, 4.6]), [0.412, 0.1, 5.5]);
    close(clampInteriorCamera([-5, 0.1, 4.6]), [-0.412, 0.1, 5.5]);
    // Far behind the glass: lateral capped to the far cone, z floored.
    close(clampInteriorCamera([-1.17, -0.17, -9.62]), [-0.325, 0.025, 0.3]);
    // Past the module ends: only the z-range bites.
    expect(clampInteriorCamera([0.1, 0.1, 12])).toEqual([0.1, 0.1, 5.5]);
    expect(clampInteriorCamera([0.1, 0.1, -12])).toEqual([0.1, 0.1, 0.3]);
    // A point just behind the glass (z 0) floors to 0.3.
    expect(clampInteriorCamera([0, 0, 0])).toEqual([0, 0, 0.3]);
  });

  it('is idempotent — clamping a clamped position changes nothing', () => {
    for (const p of [[9, 9, 9], [-9, -9, -9], [0.5, 3, -11], [2, -2, 20], [1.1, 2.13, -2.61], [5, 0.1, 4.6]]) {
      const once = clampInteriorCamera(p);
      expect(clampInteriorCamera(once)).toEqual(once);
    }
  });

  it('every interior preset lands inside the cone, so presets never land clamped', () => {
    for (const name of ['inside', 'chamber']) {
      const p = CAMERA_PRESETS[name];
      expect(clampInteriorCamera(p.pos)).toEqual(p.pos);
      // Portrait scaling (1.15x) also stays inside the cone.
      const s = p.pos.map((v, i) => p.target[i] + (v - p.target[i]) * 1.15);
      expect(clampInteriorCamera(s)).toEqual(s);
    }
  });

  it('zoom-in to the min radius can never leave the cone from the Inside target', () => {
    // Points within 1.2 of the target [0, 0.1, -0.7] that stay in
    // front of the glass (z >= 0.3) and inside the bike-zone cap
    // (lateral <= 0.55) are untouched.
    const t = CAMERA_PRESETS.inside.target;
    for (const d of [[0, 0, 1.2], [0.5, 0, 1.0], [-0.5, 0, 1.0], [0, 0.5, 1.0], [0, -0.5, 1.0], [0.35, 0.35, 1.0]]) {
      const p = t.map((v, i) => v + d[i]);
      expect(clampInteriorCamera(p)).toEqual(p);
    }
    // Sideways at the min radius slides along the cone to the glass floor.
    close(clampInteriorCamera([1.2, 0.1, -0.7]), [0.55, 0.1, 0.367]);
  });
});

describe('walk mode — 360° first-person inside Destiny', () => {
  // 2026-11-12, Ronit: "make me move when I am inside iss station
  // chamber? 360". Drag = look (full 360° yaw, pitch ±80°), WASD /
  // arrows + hold-to-move buttons = walk the aisle at a slow float,
  // clamped by the same interior wall clamp as the orbit camera.

  it('yaw wraps — dragging past 180° keeps turning, never hits a stop', () => {
    expect(normalizeYaw(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 10);
    expect(normalizeYaw(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 10);
    expect(normalizeYaw(3 * Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(normalizeYaw(2 * Math.PI + 0.3)).toBeCloseTo(0.3, 10);
    expect(normalizeYaw(-2 * Math.PI - 0.3)).toBeCloseTo(-0.3, 10);
    expect(normalizeYaw(0.5)).toBe(0.5);
    expect(normalizeYaw(-2.5)).toBe(-2.5);
    // A full 360° drag (2π of yaw) comes back to the same heading.
    expect(normalizeYaw(0.7 + 2 * Math.PI)).toBeCloseTo(0.7, 10);
  });

  it('pitch clamps at ±80° so the view never flips upside-down', () => {
    expect(WALK.maxPitch).toBeCloseTo((80 * Math.PI) / 180, 10);
    expect(clampPitch(2)).toBe(WALK.maxPitch);
    expect(clampPitch(-2)).toBe(-WALK.maxPitch);
    expect(clampPitch(0.5)).toBe(0.5);
    expect(clampPitch(WALK.maxPitch + 0.1)).toBe(WALK.maxPitch);
    expect(clampPitch(-WALK.maxPitch - 0.1)).toBe(-WALK.maxPitch);
  });

  it('walkVectors point the right way: yaw 0 faces −Z (the glovebox), right is +X', () => {
    const v0 = walkVectors(0);
    expect(v0.forward[0]).toBeCloseTo(0, 10);
    expect(v0.forward[1]).toBeCloseTo(-1, 10);
    expect(v0.right[0]).toBeCloseTo(1, 10);
    expect(v0.right[1]).toBeCloseTo(0, 10);
    const v90 = walkVectors(Math.PI / 2);
    expect(v90.forward[0]).toBeCloseTo(-1, 10);
    expect(v90.forward[1]).toBeCloseTo(0, 10);
    expect(v90.right[0]).toBeCloseTo(0, 10);
    expect(v90.right[1]).toBeCloseTo(-1, 10);
    // Unit length and perpendicular at any yaw.
    for (const yaw of [0.3, 1.1, 2.4, -0.8, Math.PI]) {
      const v = walkVectors(yaw);
      expect(Math.hypot(...v.forward)).toBeCloseTo(1, 10);
      expect(Math.hypot(...v.right)).toBeCloseTo(1, 10);
      expect(v.forward[0] * v.right[0] + v.forward[1] * v.right[1]).toBeCloseTo(0, 10);
    }
  });

  it('walkStep moves at WALK.speed, keeps eye height, and never goes faster diagonally', () => {
    expect(WALK.speed).toBeGreaterThan(0.5);
    expect(WALK.speed).toBeLessThan(1.2); // slow float — the aisle takes ~6 s to cross
    const start = [0.1, 0.1, 4.6]; // Inside preset position
    // Forward (yaw 0 = facing the glovebox, −Z) for 1 s.
    const fwd = walkStep(start, 0, { forward: 1 }, WALK.speed, 1);
    expect(fwd[0]).toBeCloseTo(0.1, 10);
    expect(fwd[1]).toBe(0.1); // height never changes
    expect(fwd[2]).toBeCloseTo(4.6 - WALK.speed, 10);
    // Back, left, right.
    expect(walkStep(start, 0, { back: 1 }, WALK.speed, 1)[2]).toBeCloseTo(4.6 + WALK.speed, 10);
    expect(walkStep(start, 0, { right: 1 }, WALK.speed, 1)[0]).toBeCloseTo(0.1 + WALK.speed, 10);
    expect(walkStep(start, 0, { left: 1 }, WALK.speed, 1)[0]).toBeCloseTo(0.1 - WALK.speed, 10);
    // Facing the far hatch (yaw π) forward is +Z.
    expect(walkStep(start, Math.PI, { forward: 1 }, WALK.speed, 1)[2]).toBeCloseTo(4.6 + WALK.speed, 10);
    // Opposite keys cancel out.
    expect(walkStep(start, 0, { forward: 1, back: 1 }, WALK.speed, 1)).toEqual(start);
    // Diagonal is normalised — same distance as straight, not √2×.
    const diag = walkStep(start, 0, { forward: 1, right: 1 }, WALK.speed, 1);
    expect(Math.hypot(diag[0] - start[0], diag[2] - start[2])).toBeCloseTo(WALK.speed, 10);
    // No input = no move; dt scales the step.
    expect(walkStep(start, 0, {}, WALK.speed, 1)).toEqual(start);
    expect(walkStep(start, 0, { forward: 1 }, WALK.speed, 0.5)[2]).toBeCloseTo(4.6 - WALK.speed / 2, 10);
  });

  it('clampWalkPosition holds the aisle extremes — z [0.3, 5.5], bike-zone lateral 0.55', () => {
    // Inside start (and its portrait framing) are untouched.
    expect(clampWalkPosition([0.1, 0.1, 4.6])).toEqual([0.1, 0.1, 4.6]);
    expect(clampWalkPosition([0.115, 0.1, 5.395])).toEqual([0.115, 0.1, 5.395]);
    // Far end / near end: only the z-range bites.
    expect(clampWalkPosition([0.1, 0.1, 5.5])).toEqual([0.1, 0.1, 5.5]);
    expect(clampWalkPosition([0.1, 0.1, 6.5])).toEqual([0.1, 0.1, 5.5]);
    expect(clampWalkPosition([0.1, 0.1, 0.3])).toEqual([0.1, 0.1, 0.3]);
    expect(clampWalkPosition([0.1, 0.1, 0.1])).toEqual([0.1, 0.1, 0.3]);
    // Bike zone (z <= 2.5): lateral caps at 0.55 — walking into the
    // CEVIS mount slides along the clamp, never into the rack face.
    const bike = clampWalkPosition([1.2, 0.1, 2.3]);
    expect(bike[0]).toBeCloseTo(0.55, 3);
    expect(bike[2]).toBeCloseTo(2.484, 3);
    // Far side wall: lateral capped, then z capped at 5.5.
    const side = clampWalkPosition([5, 0.1, 4.6]);
    expect(side[0]).toBeCloseTo(0.412, 3);
    expect(side[2]).toBe(5.5);
    // A full walk step that would leave the aisle is pulled back in.
    const stepped = walkStep([0.1, 0.1, 5.4], Math.PI, { forward: 1 }, WALK.speed, 1);
    expect(stepped[2]).toBeGreaterThan(5.5); // raw step overshoots the end
    expect(clampWalkPosition(stepped)[2]).toBe(5.5); // clamped back
    const intoRack = walkStep([0.5, 0.1, 2.0], 0, { right: 1 }, WALK.speed, 1);
    const clampedRack = clampWalkPosition(intoRack);
    expect(Math.abs(clampedRack[0])).toBeLessThanOrEqual(0.56);
    expect(clampedRack[2]).toBeGreaterThanOrEqual(0.3);
    expect(clampedRack[2]).toBeLessThanOrEqual(5.5);
  });
});

describe('interior look — 360° drag without Walk (lookOrientationFromDirection)', () => {
  // 2026-11-12, Ronit: "it won't let me" turn inside without Walk —
  // the orbit clamp froze the camera, so the interior now looks
  // first-person by default. The look resets to face a framing target
  // on every preset landing; the reset is this pure function.

  it('faces −Z at yaw 0 when looking down the module axis at the glovebox', () => {
    const o = lookOrientationFromDirection([0, 0, -1]);
    expect(o.yaw).toBeCloseTo(0, 10);
    expect(o.pitch).toBeCloseTo(0, 10);
  });

  it('faces +Z at yaw ±π when turned all the way around', () => {
    const o = lookOrientationFromDirection([0, 0, 1]);
    expect(Math.abs(o.yaw)).toBeCloseTo(Math.PI, 10);
    expect(o.pitch).toBeCloseTo(0, 10);
  });

  it('faces ±X at yaw ∓90° when looking sideways down the aisle', () => {
    expect(lookOrientationFromDirection([1, 0, 0]).yaw).toBeCloseTo(-Math.PI / 2, 10);
    expect(lookOrientationFromDirection([-1, 0, 0]).yaw).toBeCloseTo(Math.PI / 2, 10);
  });

  it('clamps the pitch at ±80° instead of flipping upside-down', () => {
    expect(lookOrientationFromDirection([0, 1, 0]).pitch).toBeCloseTo(WALK.maxPitch, 10);
    expect(lookOrientationFromDirection([0, -1, 0]).pitch).toBeCloseTo(-WALK.maxPitch, 10);
  });

  it('a zero direction never produces NaN', () => {
    const o = lookOrientationFromDirection([0, 0, 0]);
    expect(Number.isFinite(o.yaw)).toBe(true);
    expect(Number.isFinite(o.pitch)).toBe(true);
  });

  it('the Inside preset landing faces the glovebox (yaw ≈ 1.1°, pitch 0)', () => {
    const inside = CAMERA_PRESETS.inside;
    const dir = inside.target.map((v, i) => v - inside.pos[i]);
    const o = lookOrientationFromDirection(dir);
    expect(o.yaw).toBeCloseTo(0.019, 2);
    expect(o.pitch).toBeCloseTo(0, 10);
  });

  it('the Chamber preset landing faces the glovebox front, slightly down', () => {
    const chamber = CAMERA_PRESETS.chamber;
    const dir = chamber.target.map((v, i) => v - chamber.pos[i]);
    const o = lookOrientationFromDirection(dir);
    expect(o.yaw).toBeCloseTo(0.093, 2);
    expect(o.pitch).toBeCloseTo(-0.081, 2);
  });
});

describe('destinyInteriorTransform — the full-station tour lands Destiny on the glovebox', () => {
  // Measured from the Academy GLB (world-bbox probe): Destiny (US_Lab)
  // bbox centre (63.32, 0.30, -37.63), size (83.83, 42.92, 33.74) model
  // units — long axis X, width Z. BUT the bbox centre is NOT the aisle:
  // the rack faces sit at model Z -44.72 and -22.78, so the free aisle
  // is centred on model Z -33.75 (DESTINY.center). The tour is scaled
  // so Destiny's width is 5.0 scene units (the old corridor width),
  // rotated so its long axis lies on scene Z, and translated so the
  // AISLE centre is the origin.
  it('scales Destiny width to exactly 5.0 and rotates its long axis onto scene Z', () => {
    const t = destinyInteriorTransform();
    expect(t.scale).toBeCloseTo(5.0 / 33.74, 5);
    expect(t.rotationY).toBeCloseTo(-Math.PI / 2, 10);
    expect(DESTINY.widthModel * t.scale).toBeCloseTo(5.0, 6); // width
    expect(83.83 * t.scale).toBeCloseTo(12.42, 2); // length
    expect(42.92 * t.scale).toBeCloseTo(6.36, 2); // height
  });

  it('puts the aisle centre at the origin, so the glovebox sits in Destiny\'s aisle', () => {
    const t = destinyInteriorTransform();
    // world = T + R·(S·C): apply by hand and check it lands on the origin.
    const c = new THREE.Vector3(...DESTINY.center).multiplyScalar(t.scale);
    c.applyAxisAngle(new THREE.Vector3(0, 1, 0), t.rotationY);
    c.add(new THREE.Vector3(...t.position));
    expect(c.length()).toBeLessThan(0.01);
    // The position is the negative rotated scaled aisle centre.
    expect(t.position[0]).toBeCloseTo(-5.0, 2);
    expect(t.position[1]).toBeCloseTo(-0.044, 2);
    expect(t.position[2]).toBeCloseTo(-9.38, 2);
    // Destiny's bbox centre (63.32, 0.30, -37.63) lands 0.58 off the
    // aisle on +X, so Destiny spans x [-1.92, 3.08], y ±3.18, z ±6.21:
    // the aisle (x ±1.63) is centred on the glovebox, and the 3.6-wide
    // glovebox embeds ~0.18 into the rack faces on each side.
    const b = new THREE.Vector3(63.32, 0.30, -37.63).multiplyScalar(t.scale);
    b.applyAxisAngle(new THREE.Vector3(0, 1, 0), t.rotationY);
    b.add(new THREE.Vector3(...t.position));
    expect(b.x).toBeCloseTo(0.575, 3);
    expect(b.y).toBeCloseTo(0, 2);
    expect(b.z).toBeCloseTo(0, 2);
    expect(33.74 * t.scale / 2).toBeCloseTo(2.5, 2);
    expect(42.92 * t.scale / 2).toBeCloseTo(3.18, 2);
    expect(83.83 * t.scale / 2).toBeCloseTo(6.21, 2);
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

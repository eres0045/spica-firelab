/**
 * Data-layer tests — every number asserted here comes from the verified
 * cleaned data / coverage verdicts, never from the app's own claims.
 */
import { describe, it, expect } from 'vitest';
import {
  getScatterPoints, scatterCounts, getVerdict, getLiveVerdict, getRanking,
  getRankingLive, gapLabel, gapEndpoint, gapNumber, verdictLine,
  gasMaterials, detectWebGL, nearestRowFor,
} from './data.js';

describe('scatter data', () => {
  it('plots exactly 997 rows with both O2 and pressure (not 1,008)', () => {
    // 1,008 rows have pressure and 1,222 have O2, but only 997 have both:
    // 11 Flame Design inverse rows (PSI-10) record pressure but no O2.
    expect(getScatterPoints().length).toBe(997);
  });

  it('counts reconcile with cleaned.json', () => {
    const c = scatterCounts();
    expect(c.total).toBe(2012);
    expect(c.hasO2).toBe(1222);
    expect(c.hasP).toBe(1008);
    expect(c.both).toBe(997);
    expect(c.pNoO2).toBe(11);
    expect(c.o2NoP).toBe(225);
  });

  it('every scatter point has a class colour and a citation', () => {
    for (const p of getScatterPoints()) {
      expect(p.o2).toBeGreaterThan(0);
      expect(p.pressure).toBeGreaterThan(0);
      expect(p.accession).toMatch(/^PSI-\d+$/);
      expect(p.doi).toMatch(/^10\.60555\//);
    }
  });

  it('solids have no pressure points in the scatter (pressure not recorded)', () => {
    const pts = getScatterPoints();
    expect(pts.filter((p) => p.className === 'solid').length).toBe(0);
    expect(pts.filter((p) => p.className === 'droplet').length).toBe(281);
    expect(pts.filter((p) => p.className === 'gas').length).toBe(716);
  });
});

describe('headline verdicts (from coverage-verdicts.json)', () => {
  it('SIBAL at ISS is PARTIAL, not TESTED', () => {
    const v = getVerdict('SIBAL fabric', 'ISS');
    expect(v.kind).toBe('PARTIAL');
    expect(v.o2_nearest).toBe(20.8);
    expect(v.o2_distance_pts).toBe(0.2);
    expect(v.pressure_verdict).toBe('NOT RECORDED');
  });

  it('SIBAL at Exploration is GAP 11.9 O2 points (not 11.8)', () => {
    const v = getVerdict('SIBAL fabric', 'Exploration');
    expect(v.kind).toBe('GAP_O2');
    expect(v.o2_distance_pts).toBe(11.9);
    expect(v.o2_nearest).toBe(22.1);
    expect(v.o2_nearest_row).toEqual(['PSI-99', 'Sample 2-5']);
    expect(gapNumber(v)).toEqual({ value: 11.9, unit: 'O\u2082 pts', axis: 'o2' });
    expect(gapLabel(v)).toBe('11.9 O\u2082 pts below');
    expect(verdictLine(v)).toContain('11.9');
  });

  it('Nomex / PMMA at Exploration gap 11.8', () => {
    expect(getVerdict('Nomex', 'Exploration').o2_distance_pts).toBe(11.8);
    expect(getVerdict('PMMA', 'Exploration').o2_distance_pts).toBe(11.8);
    expect(getVerdict('Nomex', 'ISS').kind).toBe('PARTIAL');
    expect(getVerdict('PMMA', 'ISS').o2_nearest).toBe(21.0);
  });

  it('Methanol droplet is TESTED at ISS and Orion, pressure GAP at Exploration', () => {
    expect(getVerdict('Methanol', 'ISS').kind).toBe('TESTED');
    expect(getVerdict('Methanol', 'Orion').kind).toBe('TESTED');
    const v = getVerdict('Methanol', 'Exploration');
    expect(v.kind).toBe('GAP_PRESSURE');
    expect(v.o2_nearest).toBe(34.0);
    expect(v.pressure_nearest_psi).toBe(10.18);
    expect(v.pressure_distance_psi).toBe(1.98);
    expect(v.pressure_nearest_row).toEqual(['PSI-69', 'FLEX test 121 (C12M101)']);
    expect(gapLabel(v)).toBe('1.98 psi above nearest test');
  });

  it('Heptane droplet is TESTED at Orion (10.21 vs 10.20 psi is within tolerance)', () => {
    expect(getVerdict('Heptane', 'Orion').kind).toBe('TESTED');
    const v = getVerdict('Heptane', 'Exploration');
    expect(v.kind).toBe('GAP_PRESSURE');
    expect(v.pressure_distance_psi).toBe(2.01);
  });

  it('unknown material is NO DATA, never assumed covered', () => {
    expect(getVerdict('Propylene', 'ISS').kind).toBe('NO_DATA');
  });
});

describe('ranking', () => {
  it('at Exploration the solids sit on top, SIBAL first', () => {
    const { cabin } = getRanking('Exploration');
    expect(cabin[0].material).toBe('SIBAL fabric');
    expect(cabin[0].gap).toBe(11.9);
    expect(cabin.map((r) => r.material)).toEqual(
      expect.arrayContaining(['SIBAL fabric', 'Nomex', 'PMMA', 'Methanol', 'Heptane']),
    );
    // Droplets (pressure gap ~2 psi) sit below the solids' O2 gaps.
    const meth = cabin.find((r) => r.material === 'Methanol');
    expect(meth.gap).toBe(1.98);
    expect(meth.gapUnit).toBe('psi');
  });

  it('gases are a separate group and are TESTED at all three atmospheres', () => {
    const { gases } = getRanking('Exploration');
    const names = gases.map((g) => g.material);
    expect(names).toContain('Ethane');
    expect(names).toContain('Butane');
    expect(gasMaterials()).not.toContain('SIBAL fabric');
    for (const g of gases.filter((x) => ['Ethane', 'Butane', 'Propane'].includes(x.material))) {
      expect(g.kind).toBe('TESTED');
      expect(g.gap).toBe(0);
    }
  });

  it('at ISS no cabin material is TESTED — all solids are PARTIAL, droplets TESTED', () => {
    const { cabin } = getRanking('ISS');
    const byMat = Object.fromEntries(cabin.map((r) => [r.material, r.kind]));
    expect(byMat['SIBAL fabric']).toBe('PARTIAL');
    expect(byMat['Nomex']).toBe('PARTIAL');
    expect(byMat['Methanol']).toBe('TESTED');
    expect(byMat['Heptane']).toBe('TESTED');
  });
});

describe('live verdicts (Fire Lab sliders — arbitrary O2 / pressure)', () => {
  it('reproduces the preset verdicts exactly at preset conditions', () => {
    // SIBAL at ISS 21% / 14.7 psi -> PARTIAL, nearest 20.8%, 0.2 pts.
    const iss = getLiveVerdict('SIBAL fabric', 21, 14.7);
    expect(iss.kind).toBe('PARTIAL');
    expect(iss.o2_nearest).toBe(20.8);
    expect(iss.o2_distance_pts).toBe(0.2);
    expect(iss.o2_nearest_row).toEqual(['PSI-25', 'Test T25']);
    // SIBAL at Exploration 34% / 8.2 psi -> GAP 11.9, PSI-99 Sample 2-5.
    const exp = getLiveVerdict('SIBAL fabric', 34, 8.2);
    expect(exp.kind).toBe('GAP_O2');
    expect(exp.o2_distance_pts).toBe(11.9);
    expect(exp.o2_nearest).toBe(22.1);
    expect(exp.o2_nearest_row).toEqual(['PSI-99', 'Sample 2-5']);
    // Methanol at Exploration -> pressure GAP 1.98 psi, nearest 10.18 psi.
    const meth = getLiveVerdict('Methanol', 34, 8.2);
    expect(meth.kind).toBe('GAP_PRESSURE');
    expect(meth.o2_nearest).toBe(34.0);
    expect(meth.pressure_nearest_psi).toBe(10.18);
    expect(meth.pressure_distance_psi).toBe(1.98);
    expect(meth.pressure_nearest_row).toEqual(['PSI-69', 'FLEX test 121 (C12M101)']);
    expect(meth.pressure_nearest_outcome).toBe('Extinction');
  });

  it('Heptane at Orion conditions is TESTED (tolerance), Methanol at ISS is TESTED', () => {
    expect(getLiveVerdict('Heptane', 26.5, 10.2).kind).toBe('TESTED');
    expect(getLiveVerdict('Methanol', 21, 14.7).kind).toBe('TESTED');
    expect(getLiveVerdict('Nomex', 21, 14.7).kind).toBe('PARTIAL');
    expect(getLiveVerdict('PMMA', 21, 14.7).o2_nearest).toBe(21.0);
  });

  it('free-play values between presets give honest gaps from the same data', () => {
    // SIBAL at 30% O2: 7.9 pts above the 22.1% max (same as the 30% max-atmosphere line).
    const v = getLiveVerdict('SIBAL fabric', 30, 12);
    expect(v.kind).toBe('GAP_O2');
    expect(v.o2_distance_pts).toBe(7.9);
    expect(v.o2_nearest_row).toEqual(['PSI-99', 'Sample 2-5']);
    // Methanol at 37% O2 (Exploration max): O2 gap 3.0 pts below 34%.
    const m37 = getLiveVerdict('Methanol', 37, 8.2);
    expect(m37.kind).toBe('GAP_O2');
    expect(m37.o2_distance_pts).toBe(3.0);
    // Methanol at 20% O2 / 12 psi: inside both ranges -> TESTED.
    expect(getLiveVerdict('Methanol', 20, 12).kind).toBe('TESTED');
    // Methanol at 20% O2 / 5 psi (below the 10.18 psi floor): pressure gap.
    const low = getLiveVerdict('Methanol', 20, 5);
    expect(low.kind).toBe('GAP_PRESSURE');
    expect(low.pressure_distance_psi).toBeCloseTo(5.18, 2);
  });

  it('never cites a FLEX-2 design-range row as a test', () => {
    // Heptane design rows sit at 7.35-44.09 psi; the nearest real Heptane
    // pressure row at low pressure must be a FLEX test, not a design row.
    const v = getLiveVerdict('Heptane', 20, 8.2);
    expect(v.pressure_nearest_row[0]).toBe('PSI-69');
    expect(v.pressure_nearest_row[1]).toMatch(/FLEX test/);
  });

  it('unknown material is NO DATA at any conditions', () => {
    expect(getLiveVerdict('Propylene', 21, 14.7).kind).toBe('NO_DATA');
    expect(getLiveVerdict('Kapton', 34, 8.2).kind).toBe('NO_DATA');
  });

  it('live ranking re-sorts by gap at custom conditions', () => {
    const { cabin } = getRankingLive(34, 8.2);
    expect(cabin[0].material).toBe('SIBAL fabric');
    expect(cabin[0].gap).toBe(11.9);
  });
});

describe('gap line endpoint', () => {
  it('SIBAL/Exploration ends at the nearest tested row (22.1% O2, PSI-99)', () => {
    const ep = gapEndpoint(getVerdict('SIBAL fabric', 'Exploration'));
    expect(ep.o2).toBe(22.1);
    expect(ep.accession).toBe('PSI-99');
    // The nearest row records no pressure, so the line runs at the
    // atmosphere pressure (8.2) — never at an invented pressure.
    expect(ep.pressure).toBe(8.2);
  });

  it('Methanol/Exploration ends at the nearest pressure row (10.18 psi)', () => {
    const ep = gapEndpoint(getVerdict('Methanol', 'Exploration'));
    expect(ep.pressure).toBeCloseTo(10.18, 2);
    expect(ep.accession).toBe('PSI-69');
  });
});

describe('webgl detection', () => {
  it('returns a boolean and is false without a real GPU canvas (jsdom)', () => {
    expect(typeof detectWebGL()).toBe('boolean');
    expect(detectWebGL()).toBe(false);
  });
});

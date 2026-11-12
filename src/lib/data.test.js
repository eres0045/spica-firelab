/**
 * Data-layer tests — every number asserted here comes from the verified
 * cleaned data / coverage verdicts, never from the app's own claims.
 */
import { describe, it, expect } from 'vitest';
import {
  getScatterPoints, scatterCounts, getVerdict, getLiveVerdict, getRanking,
  getRankingLive, gapLabel, gapEndpoint, gapNumber, verdictLine,
  gasMaterials, detectWebGL, nearestRowFor,
  buildEvidence, buildEvidenceLive, EVIDENCE_ROW_KEYS,
  buildCoverage, buildCoverageLive, buildPlan, buildPlanLive,
  verdictConfidence, HEADLINE_MATERIALS,
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

describe('evidence pack (local builder — mirrors /api/evidence)', () => {
  it('SIBAL/Exploration: GAP 11.9 with the exact PSI-99 Sample 2-5 row + DOI', () => {
    const e = buildEvidence('SIBAL fabric', 'Exploration');
    expect(e.verdict.kind).toBe('GAP_O2');
    expect(e.verdict.o2_distance_pts).toBe(11.9);
    // The nearest row is a full cleaned record, never a summary.
    expect(e.nearest_o2_row.accession).toBe('PSI-99');
    expect(e.nearest_o2_row.row_ref).toBe('Sample 2-5');
    expect(e.nearest_o2_row.doi).toBe('10.60555/2chp-m469');
    expect(e.nearest_o2_row.o2_pct_min).toBe(22.1);
    expect(e.nearest_o2_row.pressure_psi_min).toBeNull();
    expect(e.nearest_o2_row.row_kind).toBe('per-test');
    // Solids record no pressure: the pressure row is honestly null.
    expect(e.nearest_pressure_row).toBeNull();
    // Citations carry the same DOI, with a clickable URL.
    const c99 = e.citations.find((c) => c.accession === 'PSI-99');
    expect(c99.doi).toBe('10.60555/2chp-m469');
    expect(c99.url).toBe('https://doi.org/10.60555/2chp-m469');
    expect(e.snapshot.rows).toBe(2012);
    expect(e.snapshot.investigations).toBe(19);
    expect(e.line).toMatch(/11\.9/);
  });

  it('Methanol/Exploration: pressure GAP 1.98 psi, nearest row at 10.18 psi', () => {
    const e = buildEvidence('Methanol', 'Exploration');
    expect(e.verdict.kind).toBe('GAP_PRESSURE');
    expect(e.verdict.pressure_distance_psi).toBe(1.98);
    expect(e.nearest_pressure_row.accession).toBe('PSI-69');
    expect(e.nearest_pressure_row.row_ref).toBe('FLEX test 121 (C12M101)');
    expect(e.nearest_pressure_row.pressure_psi_min).toBeCloseTo(10.18, 2);
    expect(e.nearest_pressure_row.doi).toMatch(/^10\.60555\//);
    // The O2 side is covered: nearest O2 test at the 34% edge.
    expect(e.nearest_o2_row.accession).toBe('PSI-69');
    expect(e.nearest_o2_row.o2_pct_min).toBe(34);
  });

  it('live builder at slider conditions matches the preset pack (34% / 8.2 psi)', () => {
    const preset = buildEvidence('SIBAL fabric', 'Exploration');
    const live = buildEvidenceLive('SIBAL fabric', 34, 8.2);
    expect(live.verdict.kind).toBe(preset.verdict.kind);
    expect(live.verdict.o2_distance_pts).toBe(preset.verdict.o2_distance_pts);
    expect(live.nearest_o2_row.row_ref).toBe(preset.nearest_o2_row.row_ref);
    expect(live.nearest_o2_row.doi).toBe(preset.nearest_o2_row.doi);
  });

  it('evidence rows carry exactly the backend key set — no invented fields', () => {
    const e = buildEvidence('SIBAL fabric', 'Exploration');
    expect(Object.keys(e.nearest_o2_row).sort()).toEqual([...EVIDENCE_ROW_KEYS].sort());
    // Every row the pack returns is a real cleaned row (design-range
    // rows are never cited): its accession + ref resolve in the data.
    for (const r of [e.nearest_o2_row, e.nearest_pressure_row]) {
      if (!r) continue;
      expect(r.accession).toMatch(/^PSI-\d+$/);
      expect(r.doi).toMatch(/^10\.60555\//);
    }
  });

  it('unknown material: NO_DATA verdict, null rows, still shaped', () => {
    const e = buildEvidence('Unobtainium', 'Exploration');
    expect(e.verdict.kind).toBe('NO_DATA');
    expect(e.nearest_o2_row).toBeNull();
    expect(e.nearest_pressure_row).toBeNull();
    expect(e.citations).toEqual([]);
  });
});

describe('verdictConfidence', () => {
  it('TESTED is 1.00 — the condition was actually run', () => {
    expect(verdictConfidence(getVerdict('Methanol', 'ISS')).score).toBe(1);
  });

  it('PARTIAL is capped at 0.50 — pressure never recorded', () => {
    expect(verdictConfidence(getVerdict('SIBAL fabric', 'ISS')).score).toBe(0.5);
  });

  it('SIBAL @ Exploration GAP_O2 is 0.65 (1 - 11.9 / 34)', () => {
    expect(verdictConfidence(getVerdict('SIBAL fabric', 'Exploration')).score).toBe(0.65);
  });

  it('Methanol @ Exploration GAP_PRESSURE is 0.76 (1 - 1.98 / 8.2)', () => {
    expect(verdictConfidence(getVerdict('Methanol', 'Exploration')).score).toBe(0.76);
  });

  it('Heptane @ Exploration GAP_PRESSURE is 0.75 (1 - 2.01 / 8.2)', () => {
    expect(verdictConfidence(getVerdict('Heptane', 'Exploration')).score).toBe(0.75);
  });

  it('NO_DATA has no confidence', () => {
    expect(verdictConfidence(getVerdict('Unobtainium', 'ISS')).score).toBeNull();
  });

  it('live (custom-cabin) verdicts use the slider targets', () => {
    expect(verdictConfidence(getLiveVerdict('SIBAL fabric', 34, 8.2)).score).toBe(0.65);
    expect(verdictConfidence(getLiveVerdict('Methanol', 34, 8.2)).score).toBe(0.76);
  });
});

describe('buildCoverage', () => {
  it('SIBAL fabric: O2 16.4-22.1 over 17 levels (30 rows); pressure never recorded; 44 rows total', () => {
    const c = buildCoverage('SIBAL fabric');
    expect(c.o2.min).toBe(16.4);
    expect(c.o2.max).toBe(22.1);
    expect(c.o2.n_levels).toBe(17);
    expect(c.o2.n_rows).toBe(30);
    expect(c.pressure.recorded).toBe(false);
    expect(c.pressure.n_rows).toBe(0);
    expect(c.rows_total).toBe(44);
    expect(c.atmospheres.Exploration.gap).toBe(11.9);
    expect(c.atmospheres.Exploration.confidence).toBe(0.65);
    expect(c.atmospheres.ISS.confidence).toBe(0.5);
    expect(c.atmospheres.Exploration.o2_nearest_doi).toBe('10.60555/2chp-m469');
  });

  it('Methanol: pressure 10.18-44.86 psi (156 rows); ISS TESTED confidence 1; Exploration gap 1.98', () => {
    const c = buildCoverage('Methanol');
    expect(c.pressure.recorded).toBe(true);
    expect(c.pressure.min).toBe(10.18);
    expect(c.pressure.max).toBe(44.86);
    expect(c.pressure.n_rows).toBe(156);
    expect(c.o2.n_rows).toBe(157);
    expect(c.rows_total).toBe(157);
    expect(c.atmospheres.ISS.confidence).toBe(1);
    expect(c.atmospheres.Exploration.gap).toBe(1.98);
    expect(c.atmospheres.Exploration.confidence).toBe(0.76);
  });

  it('single-atmosphere mode returns only that atmosphere', () => {
    const c = buildCoverage('Methanol', 'Orion');
    expect(Object.keys(c.atmospheres)).toEqual(['Orion']);
    expect(c.atmospheres.Orion.kind).toBe('TESTED');
  });

  it('unknown material is NO_DATA everywhere, with no confidence', () => {
    const c = buildCoverage('Unobtainium');
    expect(c.o2).toBeNull();
    expect(c.rows_total).toBe(0);
    expect(c.atmospheres.ISS.kind).toBe('NO_DATA');
    expect(c.atmospheres.ISS.confidence).toBeNull();
  });

  it('buildCoverageLive honours the custom cabin', () => {
    const c = buildCoverageLive('SIBAL fabric', 34, 8.2);
    expect(Object.keys(c.atmospheres)).toEqual(['custom']);
    expect(c.atmospheres.custom.kind).toBe('GAP_O2');
    expect(c.atmospheres.custom.confidence).toBe(0.65);
    expect(c.atmospheres.custom.o2_target).toBe(34);
  });

  it('carries the snapshot, disclaimer and confidence method', () => {
    const c = buildCoverage('Methanol');
    expect(c.snapshot.rows).toBe(2012);
    expect(c.disclaimer).toMatch(/TESTED means the condition was actually run/);
    expect(c.confidence_method).toMatch(/TESTED = 1.00/);
  });
});

describe('buildPlan', () => {
  it('SIBAL + Methanol @ Exploration: 0 tested, 2 gaps, worst SIBAL 11.9', () => {
    const p = buildPlan(['SIBAL fabric', 'Methanol'], 'Exploration');
    expect(p.summary).toEqual({ total: 2, tested: 0, gap: 2, partial: 0, no_data: 0 });
    expect(p.plan_line).toMatch(/0 of 2 materials TESTED at Exploration 34% O\u2082 @ 8\.2 psi/);
    expect(p.plan_line).toMatch(/2 gaps \u2014 worst: SIBAL fabric, 11\.9 O\u2082 pts beyond the tested range/);
    expect(p.materials[0].nearest_o2_doi).toBe('10.60555/2chp-m469');
  });

  it('Methanol + Heptane + SIBAL @ ISS: 2 tested, 1 partial', () => {
    const p = buildPlan(['Methanol', 'Heptane', 'SIBAL fabric'], 'ISS');
    expect(p.summary).toEqual({ total: 3, tested: 2, gap: 0, partial: 1, no_data: 0 });
    expect(p.plan_line).toMatch(/2 of 3 materials TESTED/);
    expect(p.plan_line).toMatch(/1 partial \u2014 SIBAL fabric/);
  });

  it('all five headline materials @ Exploration: 0 tested, 5 gaps', () => {
    const p = buildPlan(HEADLINE_MATERIALS.map((m) => m.key), 'Exploration');
    expect(p.summary).toEqual({ total: 5, tested: 0, gap: 5, partial: 0, no_data: 0 });
  });

  it('unknown material is a NO_DATA entry, never assumed covered', () => {
    const p = buildPlan(['Unobtainium', 'Methanol'], 'ISS');
    expect(p.summary.no_data).toBe(1);
    expect(p.summary.tested).toBe(1);
    expect(p.plan_line).toMatch(/1 without PSI data \u2014 Unobtainium/);
  });

  it('buildPlanLive uses the custom cabin', () => {
    const p = buildPlanLive(['Methanol'], 26.5, 10.2);
    expect(p.atmosphere).toBe('custom');
    expect(p.materials[0].kind).toBe('TESTED');
    expect(p.plan_line).toMatch(/custom cabin/);
  });

  it('citations dedupe across materials and carry DOI URLs', () => {
    const p = buildPlan(['SIBAL fabric', 'Methanol'], 'ISS');
    const accs = p.citations.map((c) => c.accession);
    expect(new Set(accs).size).toBe(accs.length);
    expect(p.citations.find((c) => c.accession === 'PSI-99').url)
      .toBe('https://doi.org/10.60555/2chp-m469');
  });
});

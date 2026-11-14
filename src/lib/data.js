/**
 * Data layer for "The 34% Question" — SPICA / Flame in Freefall.
 *
 * Source of truth: NASA PSI cleaned tables bundled at build time
 * (src/data/cleaned.json + src/data/coverage-verdicts.json). Every verdict,
 * gap and citation in the UI comes from these files — nothing is invented.
 *
 * CORRECTION (verified 2026-11-11 while building): the prep notes say the
 * scatter has "1,008 points". That is wrong. 1,008 rows have pressure and
 * 1,222 have O2, but only 997 rows have BOTH — 11 Flame Design inverse rows
 * (PSI-10) record pressure but no O2, so they cannot be placed on the O2
 * axis. The scatter plots 997 points; the 11 are counted in the footnote.
 *
 * Build-day API shape (Flask, NOT built yet): this module first tries the
 * live endpoints and falls back to the bundled JSON, so the UI works
 * standalone now and can be pointed at the backend on Nov 14-15 without
 * changing any component:
 *   GET /api/materials  -> list of materials (n_rows, o2 min/max, ...)
 *   GET /api/verdict?material=&atmosphere=iss|orion|exploration
 *   GET /api/scatter?material=all|<canonical>
 *   GET /api/ranking?atmosphere=<name>
 */
import cleaned from '../data/cleaned.json';
import verdicts from '../data/coverage-verdicts.json';
import { pub } from './sceneModels.js';

export const CLEANED = cleaned;
export const VERDICTS = verdicts;

/**
 * Beyond PSI — flight tests OUTSIDE the PSI archive (display-only).
 *
 * SAFFIRE-IV–VI are not in PSI, so these rows are NOT in the 2,012 cleaned
 * rows, NOT on the 997-point scatter, and change NO verdict. They are the
 * closest published flight tests beyond PSI's archived-flight ceiling
 * (22.2% O2 for solids): SIBAL burned at 31.0% O2 and PMMA at 30.3% O2,
 * both at ~54 kPa. The exact lunar point (34% O2 at 8.2 psi) is still
 * untested across a full material set — SoFIE-GEL's ranges include 34%
 * and pressures spanning 8.2 psi, but the pairing is unconfirmed from the
 * abstract, so that stays an open question, not a finding.
 *
 * Sources (verified 2026-11-14 from the NTRS PDFs):
 * - SIBAL + PMMA: Urban et al., ICES-2024-365, Table 1 (SAFFIRE-VI tests
 *   VI-2/VI-3, 20 cm/s concurrent flow). NTRS 20240002981.
 * - Nomex: ICES-2025-156, Table 1 ("Event 4 Nomex Burn: 31.9% O2. Did not
 *   Ignite"). NTRS 20250002675. The per-event pressure is NOT tabulated —
 *   only the campaign initial conditions (54.1 kPa, 31.0% O2) — so Nomex
 *   is O2-only here; no pressure is inferred or plotted.
 */
export const BEYOND_PSI = {
  note: 'SAFFIRE-IV–VI are not in PSI: these 3 rows are NOT part of the 2,012 PSI rows and change no verdict.',
  rows: [
    {
      material: 'SIBAL fabric', o2_pct: 31.0, pressure_kpa: 54.1,
      pressure_psi: 7.85, outcome: 'burned', test: 'SAFFIRE-VI VI-2',
      source: 'Urban et al., ICES-2024-365, Table 1',
      ntrs: 'https://ntrs.nasa.gov/citations/20240002981',
    },
    {
      material: 'PMMA (2-sided)', o2_pct: 30.3, pressure_kpa: 54.6,
      pressure_psi: 7.92, outcome: 'burned', test: 'SAFFIRE-VI VI-3',
      source: 'Urban et al., ICES-2024-365, Table 1',
      ntrs: 'https://ntrs.nasa.gov/citations/20240002981',
    },
    {
      material: 'Nomex', o2_pct: 31.9, pressure_kpa: null,
      pressure_psi: null, outcome: 'did not ignite', test: 'SAFFIRE-VI Event 4',
      source: 'ICES-2025-156, Table 1 (pressure not tabulated for this event)',
      ntrs: 'https://ntrs.nasa.gov/citations/20250002675',
    },
  ],
};

export const ATMOSPHERES = {
  ISS: { key: 'ISS', name: 'ISS', o2: 21, o2Max: null, pressure: 14.7, color: '#22c55e', blurb: 'International Space Station cabin air' },
  Orion: { key: 'Orion', name: 'Orion', o2: 26.5, o2Max: 30, pressure: 10.2, color: '#3b82f6', blurb: 'Orion crew capsule (max 30% O\u2082)' },
  Exploration: { key: 'Exploration', name: 'Exploration', o2: 34, o2Max: 36, pressure: 8.2, color: '#f97316', blurb: 'Lunar-base habitat (34% O\u2082 @ 8.2 psi, HLS 34±2%)' },
};
export const ATMOSPHERE_KEYS = ['ISS', 'Orion', 'Exploration'];

/** Headline demo materials. Keys match coverage-verdicts.json exactly. */
export const HEADLINE_MATERIALS = [
  { key: 'SIBAL fabric', label: 'SIBAL fabric', className: 'solid', image: pub('images/PSI-25_bass-ii.jpg'), imageDoi: '10.60555/4qc4-de67', imageAccession: 'PSI-25', imageCaption: 'BASS-II microgravity flame (PSI-25)' },
  { key: 'Nomex', label: 'Nomex', className: 'solid' },
  { key: 'PMMA', label: 'PMMA', className: 'solid' },
  { key: 'Methanol', label: 'Methanol droplet', className: 'droplet', noPhotoNote: 'No PSI photo exists for FLEX — the scatter is the evidence.' },
  { key: 'Heptane', label: 'Heptane droplet', className: 'droplet', noPhotoNote: 'No PSI photo exists for FLEX — the scatter is the evidence.' },
];

export const CLASS_COLORS = {
  solid: '#f59e0b', // amber
  droplet: '#22d3ee', // cyan
  gas: '#a78bfa', // violet
  other: '#64748b',
};
export function classColor(cls) {
  return CLASS_COLORS[cls] || CLASS_COLORS.other;
}

/** Canonical class of a material, from the cleaned rows (majority class). */
const materialClassCache = {};
export function materialClass(material) {
  if (materialClassCache[material]) return materialClassCache[material];
  const counts = {};
  for (const r of cleaned.rows) {
    if (r.material_canonical === material) counts[r.material_class] = (counts[r.material_class] || 0) + 1;
  }
  let best = 'other';
  let bestN = 0;
  for (const [c, n] of Object.entries(counts)) if (n > bestN) { best = c; bestN = n; }
  materialClassCache[material] = best;
  return best;
}

/** Gas fuels — separate group in the ranking, never mixed with cabin materials. */
export function gasMaterials() {
  return Object.keys(verdicts).filter((m) => materialClass(m) === 'gas');
}

/** Solids with O2 coverage that are NOT headline materials. They belong in
 *  the ranking too — before this helper the mission brief ranked 31 of 34
 *  materials and silently dropped Silicone, Wax candle and PMMA + Nomex. */
export function otherSolidMaterials() {
  const headline = new Set(HEADLINE_MATERIALS.map((m) => m.key));
  return Object.keys(verdicts).filter((m) => !headline.has(m) && materialClass(m) === 'solid');
}

/** Every verdict-eligible material that is NOT a headline one (29 of 34):
 *  the 3 remaining solids first, then the 26 gases, alphabetical within
 *  each class. The lab picker and the planner both offer these — the
 *  verdict math is generic, so any of the 34 is selectable, not just the
 *  five headline ones. Each entry carries the PSI accessions behind it. */
export function otherMaterials() {
  const headline = new Set(HEADLINE_MATERIALS.map((m) => m.key));
  const rank = { solid: 0, droplet: 1, gas: 2, other: 3 };
  return Object.keys(verdicts)
    .filter((k) => !headline.has(k))
    .map((k) => ({
      key: k, label: k, className: materialClass(k),
      accessions: Object.keys(verdicts[k].o2_by_investigation || {}),
    }))
    .sort((a, b) => (rank[a.className] - rank[b.className])
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Mean of a min/max pair (PSI rows store a single value as min == max). */
export function mid(min, max) {
  if (min == null && max == null) return null;
  if (min == null) return max;
  if (max == null) return min;
  return (min + max) / 2;
}

/** Round to 2 decimals (display + test comparison). */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Find one cleaned row by accession + row ref (any kind except
 *  design-range test-matrix summaries — those are planned matrices,
 *  not tests, and must never be cited as a test). */
export function findRow(accession, rowRef) {
  return cleaned.rows.find(
    (r) => r.accession === accession && r.row_ref === rowRef
      && !String(r.row_kind || '').startsWith('design-range'),
  ) || null;
}

/**
 * Nearest real test row for a material at a given O2 level or pressure.
 * Searches per-test + day-aggregate rows (never design-range rows) and
 * returns the row whose mid value is closest to the target, with its
 * accession, row ref, DOI and recorded outcome (if any).
 */
export function nearestRowFor(material, axis, value) {
  let best = null;
  let bestD = Infinity;
  for (const r of cleaned.rows) {
    if (r.material_canonical !== material) continue;
    if (String(r.row_kind || '').startsWith('design-range')) continue;
    const midV = axis === 'o2'
      ? mid(r.o2_pct_min, r.o2_pct_max)
      : mid(r.pressure_psi_min, r.pressure_psi_max);
    if (midV == null) continue;
    const d = Math.abs(midV - value);
    if (d < bestD) {
      bestD = d;
      best = { accession: r.accession, rowRef: r.row_ref, doi: r.doi, outcome: r.outcome || null, value: midV };
    }
  }
  return best;
}

/**
 * LIVE verdict — the Fire Lab's safety answer at ARBITRARY conditions
 * (O2 %, pressure psi) dialled in with the sliders, not just the three
 * preset atmospheres. Computed ONLY from the verified data:
 * the material's tested O2 levels + pressure range come from
 * coverage-verdicts.json (FLEX-2 design rows already excluded there);
 * the nearest-test citation comes from a real cleaned row
 * (nearestRowFor, design rows excluded).
 *
 * Rules (same as coverage-verdicts.md):
 * - no O2 levels for the material -> NO DATA
 * - target O2 outside [min, max] -> GAP (O2), distance to the nearest
 *   tested level (range edge — the nearest level IS the edge outside)
 * - O2 covered + no pressure rows for the material -> PARTIAL
 *   (O2 covered, pressure NOT RECORDED — never assumed)
 * - O2 covered + pressure inside [min, max] (+-0.1 psi tolerance,
 *   pressures are recorded as integer mmHg) -> TESTED
 * - O2 covered + pressure outside -> GAP (pressure), distance to the
 *   nearest tested pressure.
 * The returned object is shaped like getVerdict()'s, so VerdictCard,
 * gapLabel, gapNumber and gapEndpoint all work on it unchanged.
 * When the sliders sit exactly on a preset atmosphere, the App uses
 * getVerdict() (pre-computed, exact citations) instead of this.
 */
export function getLiveVerdict(material, o2Pct, pressurePsi) {
  const v = verdicts[material];
  const base = {
    material, custom: true, atmosphere: 'custom',
    o2Target: o2Pct, pressureTarget: pressurePsi,
    kind: 'NO_DATA', overall: 'NO DATA',
    o2: null, pressure: null,
    o2_nearest: null, o2_distance_pts: null, o2_nearest_row: null,
    o2_nearest_outcome: null, o2_verdict: null,
    pressure_nearest_psi: null, pressure_distance_psi: null,
    pressure_nearest_row: null, pressure_nearest_outcome: null,
    pressure_verdict: null,
    o2_max_atmos_distance_pts: null,
    doiByInvestigation: v ? v.o2_by_investigation : null,
    o2Range: v ? v.o2 : null, pressureRange: v ? v.pressure : null,
    nO2Rows: v ? v.n_o2_rows : 0, nPRows: v ? v.n_p_rows : 0,
  };
  if (!v || !v.o2 || !Array.isArray(v.o2.levels) || v.o2.levels.length === 0) return base;

  const levels = v.o2.levels;
  const o2Min = v.o2.min;
  const o2Max = v.o2.max;
  // Nearest tested level (discrete level actually run).
  let nearest = levels[0];
  let best = Math.abs(levels[0] - o2Pct);
  for (const lv of levels) {
    const d = Math.abs(lv - o2Pct);
    if (d < best) { best = d; nearest = lv; }
  }
  const o2Row = nearestRowFor(material, 'o2', nearest);
  base.o2_nearest = nearest;
  base.o2_nearest_row = o2Row ? [o2Row.accession, o2Row.rowRef] : null;
  base.o2_nearest_outcome = o2Row ? o2Row.outcome : null;

  // O2 axis first.
  if (o2Pct > o2Max) {
    base.kind = 'GAP_O2';
    base.overall = 'GAP (O2)';
    base.o2_verdict = 'GAP';
    base.o2_distance_pts = r2(o2Pct - o2Max);
    return base;
  }
  if (o2Pct < o2Min) {
    base.kind = 'GAP_O2';
    base.overall = 'GAP (O2)';
    base.o2_verdict = 'GAP';
    base.o2_distance_pts = r2(o2Min - o2Pct);
    return base;
  }
  base.o2_verdict = 'COVERED';
  base.o2_distance_pts = r2(Math.abs(o2Pct - nearest));

  // Pressure axis (O2 covered).
  if (!v.pressure || v.pressure.min == null) {
    base.kind = 'PARTIAL';
    base.overall = 'PARTIAL — O2 covered, pressure NOT RECORDED in PSI tables';
    base.pressure_verdict = 'NOT RECORDED';
    return base;
  }
  const pMin = v.pressure.min;
  const pMax = v.pressure.max;
  const TOL = 0.1; // psi — pressures are recorded as integer mmHg
  if (pressurePsi >= pMin - TOL && pressurePsi <= pMax + TOL) {
    base.kind = 'TESTED';
    base.overall = 'TESTED';
    base.pressure_verdict = 'COVERED';
    const pRow = nearestRowFor(material, 'pressure', pressurePsi);
    base.pressure_nearest_psi = pRow ? r2(pRow.value) : r2(pMin);
    base.pressure_nearest_row = pRow ? [pRow.accession, pRow.rowRef] : null;
    base.pressure_nearest_outcome = pRow ? pRow.outcome : null;
    return base;
  }
  const pNearest = pressurePsi < pMin ? pMin : pMax;
  const pRow = nearestRowFor(material, 'pressure', pNearest);
  base.kind = 'GAP_PRESSURE';
  base.overall = 'GAP (pressure)';
  base.pressure_verdict = 'GAP';
  base.pressure_nearest_psi = r2(pNearest);
  base.pressure_distance_psi = r2(Math.abs(pressurePsi - pNearest));
  base.pressure_nearest_row = pRow ? [pRow.accession, pRow.rowRef] : null;
  base.pressure_nearest_outcome = pRow ? pRow.outcome : null;
  return base;
}

/** Ranking at arbitrary lab conditions (same shape as getRanking). */
export function getRankingLive(o2Pct, pressurePsi) {
  const rank = (mat) => {
    const v = getLiveVerdict(mat, o2Pct, pressurePsi);
    let gap = 0;
    let gapUnit = 'O\u2082 pts';
    let gapAxis = 'o2';
    if (v.kind === 'GAP_O2') { gap = v.o2_distance_pts; }
    else if (v.kind === 'GAP_PRESSURE') { gap = v.pressure_distance_psi; gapUnit = 'psi'; gapAxis = 'pressure'; }
    return { material: mat, label: labelFor(mat), className: materialClass(mat), kind: v.kind, overall: v.overall, gap, gapUnit, gapAxis, verdict: v };
  };
  const cabin = HEADLINE_MATERIALS.map((m) => m.key).map(rank).sort((a, b) => b.gap - a.gap);
  const gases = gasMaterials().map(rank).sort((a, b) => b.gap - a.gap);
  const solids = otherSolidMaterials().map(rank).sort((a, b) => b.gap - a.gap);
  return { cabin, gases, solids };
}

/**
 * Scatter points: one per cleaned row with BOTH O2 and pressure.
 * Verified count: 997 (see correction above). Flow is recorded for only
 * 8 rows (all 0.1 cm/s); every other row sits at flow = null and is drawn
 * on the labelled "flow not recorded" plane, never at an invented value.
 */
export function getScatterPoints(material = 'all') {
  const out = [];
  for (const r of cleaned.rows) {
    const o2 = mid(r.o2_pct_min, r.o2_pct_max);
    const p = mid(r.pressure_psi_min, r.pressure_psi_max);
    if (o2 == null || p == null) continue;
    if (material !== 'all' && r.material_canonical !== material) continue;
    out.push({
      o2, pressure: p, flow: r.flow_cm_s ?? null,
      material: r.material_canonical, className: r.material_class || 'other',
      accession: r.accession, doi: r.doi, rowRef: r.row_ref,
      investigation: r.investigation, outcome: r.outcome,
    });
  }
  return out;
}

export function scatterCounts() {
  const rows = cleaned.rows;
  const hasO2 = rows.filter((r) => r.o2_pct_min != null).length;
  const hasP = rows.filter((r) => r.pressure_psi_min != null).length;
  const both = rows.filter((r) => r.o2_pct_min != null && r.pressure_psi_min != null).length;
  const o2NoP = hasO2 - both;
  const pNoO2 = hasP - both;
  return { total: rows.length, hasO2, hasP, both, o2NoP, pNoO2 };
}

/** Max pressure among scatter points — drives the axis range (data, not guess). */
export function scatterPressureMax() {
  let m = 0;
  for (const r of cleaned.rows) {
    const p = mid(r.pressure_psi_min, r.pressure_psi_max);
    if (p != null && p > m) m = p;
  }
  return m; // 73.5 psi (CFI blend)
}

/** Verdict object for a material + atmosphere, straight from verdicts JSON. */
export function getVerdict(material, atmosphereKey) {
  const v = verdicts[material];
  if (!v) return { material, atmosphere: atmosphereKey, kind: 'NO_DATA', overall: 'NO DATA', o2: null, pressure: null };
  const a = v.atmospheres[atmosphereKey];
  if (!a) return { material, atmosphere: atmosphereKey, kind: 'NO_DATA', overall: 'NO DATA', o2: null, pressure: null };
  let kind = 'NO_DATA';
  if (a.overall === 'TESTED') kind = 'TESTED';
  else if (a.overall === 'GAP (O2)') kind = 'GAP_O2';
  else if (a.overall === 'GAP (pressure)') kind = 'GAP_PRESSURE';
  else if (String(a.overall).startsWith('PARTIAL')) kind = 'PARTIAL';
  // o2_max_atmos_distance_pts is precomputed in coverage-verdicts.json
  // with the old 37% Exploration max — recompute it from the live
  // ATMOSPHERES definition (36%, HLS 34±2%) so the value can never go
  // stale again when the atmosphere definition changes.
  const atmMax = ATMOSPHERES[atmosphereKey].o2Max;
  return { material, atmosphere: atmosphereKey, kind, overall: a.overall, ...a,
    o2_max_atmos_distance_pts: atmMax == null || !v.o2 ? null : r2(atmMax - v.o2.max),
    doiByInvestigation: v.o2_by_investigation, o2Range: v.o2, pressureRange: v.pressure, nO2Rows: v.n_o2_rows, nPRows: v.n_p_rows };
}

export const KIND_LABEL = { TESTED: 'TESTED', GAP_O2: 'GAP', GAP_PRESSURE: 'GAP', PARTIAL: 'PARTIAL', NO_DATA: 'NO DATA' };
export const KIND_COLOR = { TESTED: '#22c55e', GAP_O2: '#ef4444', GAP_PRESSURE: '#ef4444', PARTIAL: '#f59e0b', NO_DATA: '#64748b' };

/** The headline number for the verdict card: { value, unit, axis }. */
export function gapNumber(v) {
  if (v.kind === 'TESTED') return { value: null, unit: null, axis: null };
  if (v.kind === 'GAP_O2') return { value: v.o2_distance_pts, unit: 'O\u2082 pts', axis: 'o2' };
  if (v.kind === 'GAP_PRESSURE') return { value: v.pressure_distance_psi, unit: 'psi', axis: 'pressure' };
  if (v.kind === 'PARTIAL') return { value: v.o2_distance_pts, unit: 'O\u2082 pts', axis: 'o2' };
  return { value: null, unit: null, axis: null };
}

/** DOI for an accession, from the material's own verdict record. */
export function doiFor(v, accession) {
  const inv = v.doiByInvestigation && v.doiByInvestigation[accession];
  return inv ? inv.doi : null;
}

/** Plain-language verdict line, built ONLY from the verdict record. */
export function verdictLine(v) {
  const atm = ATMOSPHERES[v.atmosphere];
  const m = v.material;
  // Live (free-play) verdicts: the cabin is whatever the sliders say.
  if (v.custom) {
    const o2 = fmt(v.o2Target, 1);
    const psi = fmt(v.pressureTarget, 1);
    if (v.kind === 'TESTED') {
      return `${m} was tested at ${o2}% O\u2082 and ${psi} psi in microgravity — the condition was actually run.`;
    }
    if (v.kind === 'GAP_O2') {
      const dir = v.o2Target > v.o2Range.max ? 'above' : 'below';
      const edge = v.o2Target > v.o2Range.max ? v.o2Range.max : v.o2Range.min;
      return `No ${m} test ran ${dir} ${fmt(edge, 1)}% O\u2082 in PSI — at ${o2}% O\u2082 the cabin is ${fmt(v.o2_distance_pts)} points beyond the tested range. Test first.`;
    }
    if (v.kind === 'GAP_PRESSURE') {
      const above = v.pressureTarget < v.pressure_nearest_psi;
      return `${m} was tested at the ${o2}% O\u2082 edge, but the nearest tested pressure is ${fmt(v.pressure_nearest_psi)} psi — ${fmt(v.pressure_distance_psi)} psi ${above ? 'above' : 'below'} the ${psi} psi cabin.`;
    }
    if (v.kind === 'PARTIAL') {
      return `${m} is O\u2082-covered at ${o2}% O\u2082 — nearest test ${fmt(v.o2_nearest)}% — but no PSI table records the test pressure, so this is coverage, not a pressure-tested verdict.`;
    }
    return `No O\u2082 data for ${m} in PSI — it cannot be judged for this cabin.`;
  }
  if (v.kind === 'TESTED') {
    return `${m} was tested at ${atm.o2}% O\u2082 and ${atm.pressure} psi in microgravity — the condition was actually run.`;
  }
  if (v.kind === 'GAP_O2') {
    return `No ${m} test ran above ${fmt(v.o2_nearest)}% O\u2082 in PSI — the ${atm.o2}% ${atm.name} atmosphere is ${fmt(v.o2_distance_pts)} points beyond the tested range. Test first.`;
  }
  if (v.kind === 'GAP_PRESSURE') {
    return `${m} was tested at the ${atm.o2}% O\u2082 edge, but the nearest tested pressure is ${fmt(v.pressure_nearest_psi)} psi — ${fmt(v.pressure_distance_psi)} psi above the ${atm.pressure} psi ${atm.name} atmosphere.`;
  }
  if (v.kind === 'PARTIAL') {
    return `${m} is O\u2082-covered at ${atm.name} — nearest test ${fmt(v.o2_nearest)}% — but no PSI table records the test pressure, so this is coverage, not a pressure-tested verdict.`;
  }
  return `No O\u2082 data for ${m} in PSI — it cannot be judged for this atmosphere.`;
}

/** Gap-line label for the scatter (3D + 2D use the same string). */
export function gapLabel(v) {
  if (v.kind === 'GAP_O2') return `${fmt(v.o2_distance_pts)} O\u2082 pts below`;
  if (v.kind === 'GAP_PRESSURE') return `${fmt(v.pressure_distance_psi)} psi above nearest test`;
  if (v.kind === 'PARTIAL') return 'O\u2082 covered — pressure not recorded in PSI';
  if (v.kind === 'TESTED') return 'Tested — inside the cloud';
  return 'No data';
}

/** Scatter endpoint of the gap line: the nearest tested row's plotted point.
 *  For solids the nearest row has no pressure, so the line runs along the
 *  O2 axis at the atmosphere's pressure (honest: the row has no pressure to
 *  plot). Returns null when there is no nearest row. */
export function gapEndpoint(v) {
  const atmPressure = v.pressureTarget ?? ATMOSPHERES[v.atmosphere]?.pressure;
  const rowRef = v.kind === 'GAP_PRESSURE' ? v.pressure_nearest_row : v.o2_nearest_row;
  if (!rowRef) return null;
  const [acc, ref] = rowRef;
  const row = findRow(acc, ref);
  if (!row) return null;
  const o2 = mid(row.o2_pct_min, row.o2_pct_max);
  const p = mid(row.pressure_psi_min, row.pressure_psi_max);
  return {
    o2: o2 ?? (v.kind === 'GAP_PRESSURE' ? v.o2_nearest : null),
    pressure: p ?? atmPressure,
    accession: acc, rowRef: ref, doi: row.doi,
  };
}

/** Ranking for one atmosphere: cabin materials first, gases separate.
 *  Gap value: O2 distance (pts) for O2 gaps, pressure distance (psi) for
 *  pressure gaps, 0 for TESTED/PARTIAL (PARTIAL has no O2 gap). */
export function getRanking(atmosphereKey) {
  const rank = (mat) => {
    const v = getVerdict(mat, atmosphereKey);
    let gap = 0;
    let gapUnit = 'O\u2082 pts';
    let gapAxis = 'o2';
    if (v.kind === 'GAP_O2') { gap = v.o2_distance_pts; }
    else if (v.kind === 'GAP_PRESSURE') { gap = v.pressure_distance_psi; gapUnit = 'psi'; gapAxis = 'pressure'; }
    return { material: mat, label: labelFor(mat), className: materialClass(mat), kind: v.kind, overall: v.overall, gap, gapUnit, gapAxis, verdict: v };
  };
  const cabin = HEADLINE_MATERIALS.map((m) => m.key).map(rank).sort((a, b) => b.gap - a.gap);
  const gases = gasMaterials().map(rank).sort((a, b) => b.gap - a.gap);
  const solids = otherSolidMaterials().map(rank).sort((a, b) => b.gap - a.gap);
  return { cabin, gases, solids };
}

export function labelFor(material) {
  const h = HEADLINE_MATERIALS.find((m) => m.key === material);
  return h ? h.label : material;
}

/** WebGL availability — false in jsdom / headless without GPU, which is
 *  exactly when the 2D fallback must show. */
export function detectWebGL(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false;
  try {
    const c = doc.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export function fmt(n, digits = 2) {
  if (n == null) return '—';
  const r = Number(n.toFixed(digits));
  return String(r);
}

/* ---- Live API wiring (Flask verdict engine) ---------------------------
 * tryApi() probes the backend once; if every endpoint answers, the app
 * uses live data, otherwise it keeps the bundled JSON. Nothing in the
 * components depends on which source answered.
 *
 * Candidate bases, in order: VITE_API_BASE when set (local dev:
 * http://127.0.0.1:5000, or the vite dev proxy on same origin), then
 * same-origin (the Netlify deploy, via the /api/* rewrite). One build
 * works on both hosts; the static deploys MUST keep working with no
 * backend.
 *
 * NO cross-origin fallback to the Netlify URL (removed 2026-11-14):
 * Netlify deploys are PAUSED (credits exhausted, reset Dec 7), so its
 * API still serves the pre-audit data — wrong BASS-II report number,
 * 37% Exploration max, no nextTest — while the Pages bundle is current.
 * The judged link (GitHub Pages) must serve the bundled PSI data, which
 * is verified byte-identical to NASA PSI as of Nov 14. Restore the
 * fallback only after a Netlify redeploy with the same code. */
const ENV_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '';
export const API_CANDIDATES = ENV_BASE ? [ENV_BASE] : [''];
export const LIVE_API_URL = 'https://spica-firelab.netlify.app';
async function fetchJson(base, path, timeoutMs = 15000) {
  // 15 s: the first hit on a cold Netlify Function measured 13.2 s
  // through this VM's MITM forwarder (warm hits are 0.4–1.3 s; direct
  // users will see a far faster cold start). 1.5 s timed the probe out
  // on the live site and the app silently fell back to bundled data.
  // The UI works on bundled data meanwhile; only the source tag waits.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
export async function tryApi() {
  // Probe ONE cheap endpoint per base first: on the static Pages host the
  // API does not exist, and three parallel 404s pollute the console for
  // nothing. Only when the probe answers do we fetch the rest.
  for (const base of API_CANDIDATES) {
    const materials = await fetchJson(base, '/api/materials');
    if (!materials) continue;
    const [scatter, ranking] = await Promise.all([
      fetchJson(base, '/api/scatter?material=all'),
      fetchJson(base, '/api/ranking?atmosphere=Exploration'),
    ]);
    if (scatter && ranking) return { materials, scatter, ranking, base };
  }
  return null;
}
export async function tryApiVerdict(material, atmosphereKey, base) {
  return fetchJson(base, `/api/verdict?material=${encodeURIComponent(material)}&atmosphere=${atmosphereKey}`);
}
export async function tryApiLiveVerdict(material, o2, pressure, base) {
  return fetchJson(base, `/api/verdict?material=${encodeURIComponent(material)}&o2=${o2}&pressure=${pressure}`);
}
export async function tryApiBrief(atmosphereKey, base) {
  return fetchJson(base, `/api/brief?atmosphere=${atmosphereKey}`, 15000);
}
export async function tryApiEvidence(material, atmosphereKey, base) {
  return fetchJson(base, `/api/evidence?material=${encodeURIComponent(material)}&atmosphere=${atmosphereKey}`, 15000);
}
export async function tryApiEvidenceLive(material, o2, pressure, base) {
  return fetchJson(base, `/api/evidence?material=${encodeURIComponent(material)}&o2=${o2}&pressure=${pressure}`, 15000);
}
export async function tryApiCoverage(material, atmosphereKey, base) {
  return fetchJson(base, `/api/coverage?material=${encodeURIComponent(material)}&atmosphere=${atmosphereKey}`, 15000);
}
export async function tryApiCoverageLive(material, o2, pressure, base) {
  return fetchJson(base, `/api/coverage?material=${encodeURIComponent(material)}&o2=${o2}&pressure=${pressure}`, 15000);
}
export async function tryApiPlan(materials, atmosphereKey, base) {
  const q = materials.map((m) => encodeURIComponent(m)).join(',');
  return fetchJson(base, `/api/plan?materials=${q}&atmosphere=${atmosphereKey}`, 15000);
}
export async function tryApiPlanLive(materials, o2, pressure, base) {
  const q = materials.map((m) => encodeURIComponent(m)).join(',');
  return fetchJson(base, `/api/plan?materials=${q}&o2=${o2}&pressure=${pressure}`, 15000);
}

/** Row fields the evidence pack returns, verbatim from the cleaned row —
 *  the same 18 keys the backend's /api/evidence returns (EVIDENCE_ROW_KEYS
 *  in app/netlify/functions/api.mjs), so the modal renders identically
 *  with live or bundled data. Never a summary: the full row record. */
export const EVIDENCE_ROW_KEYS = [
  'investigation', 'accession', 'doi', 'table_file', 'row_ref',
  'row_kind', 'material_canonical', 'material_raw', 'material_class',
  'o2_pct_min', 'o2_pct_max', 'o2_approx',
  'pressure_psi_min', 'pressure_psi_max', 'flow_cm_s',
  'outcome', 'burn_time_s', 'notes',
];

/** Dataset snapshot — same shape as buildBrief()'s, so the Evidence
 *  modal and the Mission brief agree on rows / investigations / date. */
function dataSnapshot() {
  return {
    cleaned_at: cleaned.meta?.cleaned_at, rows: cleaned.rows.length,
    investigations: new Set(cleaned.rows.map((r) => r.accession)).size,
    tables: Object.keys(cleaned.tables || {}).length, source: 'NASA PSI (Physical Sciences Informatics), public data',
  };
}

/** Evidence pack built from the bundled data — the offline fallback for
 *  /api/evidence. Same shape and same math as the backend (evidence_pack
 *  in backend/verdicts.py, mirrored in the Netlify Function), so the
 *  Evidence modal reads identically with or without the API: the verdict,
 *  the exact PSI rows behind it (full records, never summaries), the DOI
 *  per investigation, and the citations. Design-range rows are never
 *  returned (findRow excludes them). */
export function buildEvidenceFromVerdict(verdict) {
  const fullRow = (ref) => {
    if (!ref) return null;
    const row = findRow(ref[0], ref[1]);
    if (!row) return null;
    const out = {};
    for (const k of EVIDENCE_ROW_KEYS) out[k] = row[k] ?? null;
    return out;
  };
  const inv = verdict.doiByInvestigation || {};
  const citations = Object.entries(inv).map(([acc, e]) => ({
    accession: acc, title: e.title, doi: e.doi,
    url: e.doi ? `https://doi.org/${e.doi}` : null,
  }));
  return {
    verdict,
    line: verdictLine(verdict),
    nearest_o2_row: fullRow(verdict.o2_nearest_row),
    nearest_pressure_row: fullRow(verdict.pressure_nearest_row),
    investigations: inv,
    citations,
    reports: BRIEF_REPORTS,
    disclaimer: COVERAGE_DISCLAIMER,
    snapshot: dataSnapshot(),
  };
}
export function buildEvidence(material, atmosphereKey) {
  return buildEvidenceFromVerdict(getVerdict(material, atmosphereKey));
}
export function buildEvidenceLive(material, o2Pct, pressurePsi) {
  return buildEvidenceFromVerdict(getLiveVerdict(material, o2Pct, pressurePsi));
}

/** Verdict confidence — how close the nearest real test is to the
 *  condition, as a 0..1 score. NOT a probability and NOT an
 *  interpolation: the nearest-test distance itself is the evidence.
 *  Method (also returned in every payload as confidence_method):
 *  - TESTED: 1.00 — the condition was actually run.
 *  - PARTIAL: capped at 0.50 — O2 covered, but pressure was never
 *    recorded, so only half the axes are verified.
 *  - GAP (O2): 1 − o2_distance_pts ÷ target O2% (atmosphere O2, or
 *    the slider O2 for custom cabins).
 *  - GAP (pressure): 1 − pressure_distance_psi ÷ target psi.
 *  - NO DATA: null — it cannot be judged.
 *  Rounded to 2 decimals. */
export function verdictConfidence(v) {
  if (!v) return { score: null, note: 'No verdict.' };
  if (v.kind === 'TESTED') return { score: 1, note: 'The condition was actually run in microgravity.' };
  if (v.kind === 'PARTIAL') return { score: 0.5, note: 'O2 covered, but pressure was never recorded — half the axes verified.' };
  if (v.kind === 'GAP_O2') {
    const target = v.custom ? v.o2Target : ATMOSPHERES[v.atmosphere]?.o2;
    if (v.o2_distance_pts == null || target == null || target <= 0) return { score: null, note: 'Nearest-test distance not recorded.' };
    return { score: r2(Math.max(0, 1 - v.o2_distance_pts / target)), note: `Nearest test is ${fmt(v.o2_distance_pts, 1)} O2 pts from the ${fmt(target, 1)}% target.` };
  }
  if (v.kind === 'GAP_PRESSURE') {
    const target = v.custom ? v.pressureTarget : ATMOSPHERES[v.atmosphere]?.pressure;
    if (v.pressure_distance_psi == null || target == null || target <= 0) return { score: null, note: 'Nearest-test distance not recorded.' };
    return { score: r2(Math.max(0, 1 - v.pressure_distance_psi / target)), note: `Nearest tested pressure is ${fmt(v.pressure_distance_psi, 2)} psi from the ${fmt(target, 1)} psi target.` };
  }
  return { score: null, note: 'No O2 data for this material in PSI — it cannot be judged.' };
}
export const CONFIDENCE_METHOD = 'confidence = 1 − nearest-test distance ÷ target value (O2 pts ÷ atmosphere O2%, or psi ÷ atmosphere psi); TESTED = 1.00; PARTIAL capped at 0.50 because pressure was never recorded; NO DATA has no confidence. A heuristic, not a probability — the distance itself is the evidence.';

/** One atmosphere's coverage entry: the verdict, its gap, the nearest
 *  real tests with DOIs, and the confidence score. */
function coverageEntry(material, verdict) {
  const gap = gapNumber(verdict);
  const conf = verdictConfidence(verdict);
  const o2Row = verdict.o2_nearest_row;
  const pRow = verdict.pressure_nearest_row;
  return {
    kind: verdict.kind, overall: verdict.overall,
    gap: gap.value ?? 0, gapUnit: gap.unit ?? 'O\u2082 pts', gapAxis: gap.axis ?? 'o2',
    o2_distance_pts: verdict.o2_distance_pts ?? null,
    pressure_distance_psi: verdict.pressure_distance_psi ?? null,
    o2_nearest: verdict.o2_nearest ?? null,
    o2_nearest_row: o2Row ?? null,
    o2_nearest_doi: o2Row ? doiFor(verdict, o2Row[0]) : null,
    pressure_nearest_psi: verdict.pressure_nearest_psi ?? null,
    pressure_nearest_row: pRow ?? null,
    pressure_nearest_doi: pRow ? doiFor(verdict, pRow[0]) : null,
    confidence: conf.score, confidence_note: conf.note,
    line: verdictLine(verdict),
  };
}

/** Coverage pack for one material — the tested ranges, test counts,
 *  and per-atmosphere confidence. Same shape and same math as the
 *  backend (get_coverage in backend/verdicts.py, mirrored in the
 *  Netlify Function), so the Evidence modal reads identically with or
 *  without the API. With an atmosphere key it returns that atmosphere
 *  only; without one it returns all three. */
export function buildCoverage(material, atmosphereKey = null) {
  const v = verdicts[material];
  const rowsTotal = cleaned.rows.filter((r) => r.material_canonical === material).length;
  const inv = v ? v.o2_by_investigation || {} : {};
  const investigations = Object.entries(inv).map(([acc, e]) => ({
    accession: acc, title: e.title, doi: e.doi, n: e.n, min: e.min, max: e.max,
  }));
  const o2 = v && v.o2
    ? { min: v.o2.min, max: v.o2.max, levels: v.o2.levels, n_levels: v.o2.levels.length, n_rows: v.n_o2_rows }
    : null;
  const pressure = v && v.pressure && v.pressure.min != null
    ? { recorded: true, min: r2(v.pressure.min), max: r2(v.pressure.max), n_rows: v.n_p_rows }
    : { recorded: false, min: null, max: null, n_rows: v ? v.n_p_rows : 0 };
  const atmospheres = {};
  if (atmosphereKey) {
    atmospheres[atmosphereKey] = coverageEntry(material, getVerdict(material, atmosphereKey));
  } else {
    for (const key of ATMOSPHERE_KEYS) atmospheres[key] = coverageEntry(material, getVerdict(material, key));
  }
  return {
    material, label: labelFor(material), className: materialClass(material),
    o2, pressure, rows_total: rowsTotal, investigations, atmospheres,
    snapshot: dataSnapshot(), disclaimer: COVERAGE_DISCLAIMER,
    confidence_method: CONFIDENCE_METHOD,
  };
}
export function buildCoverageLive(material, o2Pct, pressurePsi) {
  const c = buildCoverage(material);
  const verdict = getLiveVerdict(material, o2Pct, pressurePsi);
  c.atmospheres = { custom: { ...coverageEntry(material, verdict), o2_target: o2Pct, pressure_target: pressurePsi } };
  return c;
}

/** One material's entry in a mission plan: verdict, gap, confidence
 *  and the nearest real tests — the same fields the brief shows. */
function planEntry(material, verdict) {
  const gap = gapNumber(verdict);
  const conf = verdictConfidence(verdict);
  const o2Row = verdict.o2_nearest_row;
  const pRow = verdict.pressure_nearest_row;
  return {
    material, label: labelFor(material), className: materialClass(material),
    kind: verdict.kind, overall: verdict.overall,
    gap: gap.value ?? 0, gapUnit: gap.unit ?? 'O\u2082 pts', gapAxis: gap.axis ?? 'o2',
    line: verdictLine(verdict),
    confidence: conf.score, confidence_note: conf.note,
    nearest_o2_test: o2Row ? `${o2Row[0]} · ${o2Row[1]}` : null,
    nearest_o2_doi: o2Row ? doiFor(verdict, o2Row[0]) : null,
    nearest_pressure_test: pRow ? `${pRow[0]} · ${pRow[1]}` : null,
    nearest_pressure_doi: pRow ? doiFor(verdict, pRow[0]) : null,
  };
}

/** The plan's one-line verdict — counts plus the worst gap, built only
 *  from the entries. Worst = lowest confidence among the gaps. */
function planLine(entries, conditionsLabel) {
  const total = entries.length;
  const tested = entries.filter((e) => e.kind === 'TESTED').length;
  const gaps = entries.filter((e) => e.kind === 'GAP_O2' || e.kind === 'GAP_PRESSURE');
  const partials = entries.filter((e) => e.kind === 'PARTIAL');
  const noData = entries.filter((e) => e.kind === 'NO_DATA');
  const worst = [...gaps].sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1))[0];
  let line = `${tested} of ${total} material${total === 1 ? '' : 's'} TESTED at ${conditionsLabel}`;
  const parts = [];
  if (gaps.length) {
    parts.push(`${gaps.length} gap${gaps.length === 1 ? '' : 's'}${worst ? ` — worst: ${worst.label}, ${fmt(worst.gap, worst.gapUnit === 'psi' ? 2 : 1)} ${worst.gapUnit} beyond the tested range` : ''}`);
  }
  if (partials.length) parts.push(`${partials.length} partial — ${partials.map((p) => p.label).join(', ')}, O2 covered, pressure never recorded`);
  if (noData.length) parts.push(`${noData.length} without PSI data — ${noData.map((p) => p.label).join(', ')}`);
  if (parts.length) line += `; ${parts.join('; ')}`;
  else line += ' — every condition was actually run.';
  return line;
}

function assemblePlan(entries, materials, atmosphere, conditions, conditionsLabel) {
  const summary = {
    total: entries.length,
    tested: entries.filter((e) => e.kind === 'TESTED').length,
    gap: entries.filter((e) => e.kind === 'GAP_O2' || e.kind === 'GAP_PRESSURE').length,
    partial: entries.filter((e) => e.kind === 'PARTIAL').length,
    no_data: entries.filter((e) => e.kind === 'NO_DATA').length,
  };
  const allDois = {};
  for (const m of materials) {
    const v = verdicts[m];
    for (const [acc, inv] of Object.entries(v?.o2_by_investigation || {})) {
      allDois[acc] = { accession: acc, title: inv.title, doi: inv.doi, url: inv.doi ? `https://doi.org/${inv.doi}` : null };
    }
  }
  return {
    atmosphere, conditions, materials: entries, summary,
    plan_line: planLine(entries, conditionsLabel),
    citations: Object.values(allDois),
    reports: BRIEF_REPORTS, disclaimer: COVERAGE_DISCLAIMER, snapshot: dataSnapshot(),
  };
}

/** Mission plan for a chosen material list at one atmosphere — the
 *  per-material verdicts, the counts, and the one-line verdict. Same
 *  math as the backend (mission_plan in backend/verdicts.py, mirrored
 *  in the Netlify Function). Unknown materials are NO_DATA entries,
 *  never assumed covered. */
export function buildPlan(materials, atmosphereKey) {
  const atm = ATMOSPHERES[atmosphereKey];
  const entries = materials.map((m) => planEntry(m, getVerdict(m, atmosphereKey)));
  return assemblePlan(entries, materials, atmosphereKey,
    { o2_pct: atm.o2, o2_max_pct: atm.o2Max, pressure_psi: atm.pressure, blurb: atm.blurb },
    `${atm.name} ${fmt(atm.o2, 1)}% O\u2082 @ ${fmt(atm.pressure, 1)} psi`);
}
export function buildPlanLive(materials, o2Pct, pressurePsi) {
  const entries = materials.map((m) => planEntry(m, getLiveVerdict(m, o2Pct, pressurePsi)));
  return assemblePlan(entries, materials, 'custom',
    { o2_pct: o2Pct, pressure_psi: pressurePsi, custom: true },
    `${fmt(o2Pct, 1)}% O\u2082 @ ${fmt(pressurePsi, 1)} psi (custom cabin)`);
}

/** NASA technical reports behind the headline investigations (further
 *  reading — the DOIs in the data are the primary citations). */
export const BRIEF_REPORTS = [
  { ref: 'NASA PSI — Physical Sciences Informatics (psi.nasa.gov)', note: 'Public NASA data system; the 2,012 cleaned rows come from its Combustion Science investigations (BASS, BASS-II, FLEX, FLEX-2, SAFFIRE-I/II, CFI). No login required.', url: 'https://psi.nasa.gov/' },
  { ref: 'BASS-II — NASA-TM-202110011385', note: 'Burning and Suppression of Solids - II (PSI-25): SIBAL, Nomex and PMMA microgravity flame tests.', url: 'https://ntrs.nasa.gov/citations/20210011385' },
  { ref: 'FLEX — NASA/TP-2015-216046, Table IX', note: 'Flame Extinguishment Experiment (PSI-69): methanol and heptane droplet tests, including extinction outcomes.', url: 'https://ntrs.nasa.gov/citations/20150019316' },
];

export const COVERAGE_DISCLAIMER = 'Coverage, not certification: TESTED means the condition was actually run in microgravity; GAP means no test ever ran there. Nothing here certifies a material as safe to fly.';

/** Mission brief built from the bundled data — the offline fallback for
 *  /api/brief. Same math as the backend (getRanking + getVerdict), so
 *  the brief reads identically with or without the API. */
export function buildBrief(atmosphereKey) {
  const atm = ATMOSPHERES[atmosphereKey];
  const ranking = getRanking(atmosphereKey);
  const entry = (e) => {
    const v = e.verdict;
    const o2Row = v.o2_nearest_row;
    const pRow = v.pressure_nearest_row;
    return {
      material: e.material, label: e.label, className: e.className,
      kind: e.kind, overall: e.overall, gap: e.gap, gapUnit: e.gapUnit, gapAxis: e.gapAxis,
      line: verdictLine(v),
      nearest_o2_test: o2Row ? `${o2Row[0]} · ${o2Row[1]}` : null,
      nearest_o2_value: v.o2_nearest,
      nearest_o2_doi: o2Row ? doiFor(v, o2Row[0]) : null,
      nearest_pressure_test: pRow ? `${pRow[0]} · ${pRow[1]}` : null,
      nearest_pressure_value: v.pressure_nearest_psi,
      nearest_pressure_doi: pRow ? doiFor(v, pRow[0]) : null,
    };
  };
  const allDois = {};
  for (const group of [ranking.cabin, ranking.solids, ranking.gases]) {
    for (const e of group) {
      for (const [acc, inv] of Object.entries(e.verdict.doiByInvestigation || {})) {
        allDois[acc] = { accession: acc, title: inv.title, doi: inv.doi, url: inv.doi ? `https://doi.org/${inv.doi}` : null };
      }
    }
  }
  // Recommended next test — the concrete test that would close the most
  // ground: the largest O2-axis gap among cabin/solid materials with
  // >= 10 O2 rows behind them (well-evidenced). Gases are excluded (not
  // cabin materials) and so is Wax candle: its larger gap rests on a
  // single O2 row. The brief already ranks everything; this names the
  // one test to run next.
  let nextTest = null;
  for (const e of [...ranking.cabin, ...ranking.solids]) {
    if (e.kind !== 'GAP_O2' && e.kind !== 'PARTIAL') continue;
    if ((e.gap ?? 0) <= 0) continue;
    const n = e.verdict?.nO2Rows ?? 0;
    if (n < 10) continue;
    if (!nextTest || (e.gap ?? 0) > (nextTest.gap ?? 0)) nextTest = e;
  }
  const nextTestOut = nextTest ? {
    material: nextTest.material, label: nextTest.label, gap: nextTest.gap, gapUnit: nextTest.gapUnit,
    n_o2_rows: nextTest.verdict?.nO2Rows ?? 0, o2_pct: atm.o2, pressure_psi: atm.pressure,
    line: `Run ${nextTest.label} at ${fmt(atm.o2, 1)}% O\u2082, ${fmt(atm.pressure, 1)} psi — the ${atm.name} point where its gap is ${fmt(nextTest.gap)} ${nextTest.gapUnit}.`,
  } : null;
  return {
    atmosphere: atmosphereKey,
    nextTest: nextTestOut,
    conditions: { o2_pct: atm.o2, o2_max_pct: atm.o2Max, pressure_psi: atm.pressure, blurb: atm.blurb },
    cabin: ranking.cabin.map(entry),
    solids: ranking.solids.map(entry),
    gases: ranking.gases.map(entry),
    citations: Object.values(allDois),
    reports: BRIEF_REPORTS,
    disclaimer: COVERAGE_DISCLAIMER,
    snapshot: {
      cleaned_at: cleaned.meta?.cleaned_at, rows: cleaned.rows.length,
      investigations: new Set(cleaned.rows.map((r) => r.accession)).size,
      // cleaned.tables is a DICT keyed by table name (21 entries), not a
      // list — Object.keys, not .length (the old .length was undefined).
      tables: Object.keys(cleaned.tables || {}).length, source: 'NASA PSI (Physical Sciences Informatics), public data',
    },
  };
}

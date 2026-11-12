/**
 * Netlify Function: SPICA verdict engine ("The 34% Question").
 *
 * Served at /.netlify/functions/api/* and rewritten to /api/* (see
 * netlify.toml). The GitHub Pages deploy calls it cross-origin at
 * https://spica-firelab.netlify.app/api/* (CORS: *).
 *
 * WHY JAVASCRIPT — read before "fixing" this to Python: Netlify Functions
 * do NOT support Python. The current docs list only TypeScript,
 * JavaScript and Go, and the bundler silently ignores .py files —
 * verified 2026-11-11: a Python handler.py, then api.py, both packaged
 * as "No Functions were found in netlify/functions directory" while a
 * trivial hello.mjs in the same directory packaged fine. The Flask
 * server in backend/ remains the LOCAL dev server only; it is not the
 * deploy route.
 *
 * ONE LOGIC COPY: this function imports the verdict math from
 * src/lib/data.js — the same module the app renders from — so the API
 * and the app can never disagree about a number. The small compositions
 * below (materials list, evidence pack, freshness) mirror the Flask
 * dev server's; the verdict math itself is never re-implemented here.
 *
 * HONESTY RULES (hard, same as the frontend): verdicts are COVERAGE
 * (tested vs gap), never safety certifications. Never invent a number,
 * DOI or test. The live PSI check reports reachability only — when PSI
 * is unreachable, callers get the snapshot date, never faked freshness.
 */

import {
  CLEANED,
  VERDICTS,
  ATMOSPHERE_KEYS,
  HEADLINE_MATERIALS,
  getVerdict,
  getLiveVerdict,
  getRanking,
  getRankingLive,
  getScatterPoints,
  scatterCounts,
  verdictLine,
  doiFor,
  findRow,
  materialClass,
  gasMaterials,
  labelFor,
  buildBrief,
  BRIEF_REPORTS,
  COVERAGE_DISCLAIMER,
  buildCoverage,
  buildCoverageLive,
  buildPlan,
  buildPlanLive,
} from '../../src/lib/data.js';

const PSI_API_ROOT = 'https://psi.nasa.gov/geode-py/ws/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
const err = (status, message) => json(status, { error: message });

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function snapshot() {
  return {
    cleaned_at: CLEANED.meta?.cleaned_at,
    rows: CLEANED.rows.length,
    investigations: new Set(CLEANED.rows.map((r) => r.accession)).size,
    // cleaned.tables is a DICT keyed by table name (21 entries), not a
    // list — Object.keys, not .length (the old .length was undefined).
    tables: Object.keys(CLEANED.tables || {}).length,
    source: 'NASA PSI (Physical Sciences Informatics), public data',
  };
}

/** Route: strip the /api or /.netlify/functions/api prefix. */
function route(pathname) {
  const p = (pathname || '/').split('?')[0];
  for (const prefix of ['/.netlify/functions/api', '/api']) {
    if (p === prefix) return '/';
    if (p.startsWith(`${prefix}/`)) return p.slice(prefix.length);
  }
  return p;
}

function numParam(params, name) {
  const raw = params.get(name);
  if (raw == null) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) throw httpError(400, `param ${name} must be a number, got '${raw}'`);
  return n;
}

/** Preset (?atmosphere=) or live (?o2=&pressure=) verdict. Flow is
 *  accepted and echoed — it changes flame shape only, never the verdict
 *  (PSI verdicts are O2 x pressure). */
function verdictFromParams(params) {
  const material = params.get('material');
  if (!material) throw httpError(400, 'param material is required');
  const flow = numParam(params, 'flow');
  const atmosphere = params.get('atmosphere');
  let verdict;
  if (atmosphere) {
    if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
      throw httpError(400, `unknown atmosphere '${atmosphere}' (want one of ${ATMOSPHERE_KEYS.join(', ')})`);
    }
    verdict = getVerdict(material, atmosphere);
  } else {
    const o2 = numParam(params, 'o2');
    const pressure = numParam(params, 'pressure');
    if (o2 == null || pressure == null) {
      throw httpError(400, 'give ?atmosphere=ISS|Orion|Exploration or ?o2=&pressure=');
    }
    verdict = getLiveVerdict(material, o2, pressure);
  }
  if (verdict.kind === 'NO_DATA' && !(material in VERDICTS)) {
    throw httpError(404, `unknown material '${material}'`);
  }
  verdict = { ...verdict, line: verdictLine(verdict) };
  if (flow != null) {
    verdict.flow_cm_s = flow;
    verdict.flow_note = 'Flow changes flame shape only; PSI verdicts are O2 x pressure.';
  }
  return verdict;
}

function listMaterials() {
  return Object.entries(VERDICTS).map(([name, v]) => {
    const inv = v.o2_by_investigation || {};
    return {
      material: name,
      label: labelFor(name),
      className: materialClass(name),
      is_headline: HEADLINE_MATERIALS.some((m) => m.key === name),
      n_o2_rows: v.n_o2_rows,
      n_p_rows: v.n_p_rows,
      o2: v.o2,
      pressure: v.pressure,
      investigations: Object.entries(inv).map(([acc, e]) => ({
        accession: acc,
        title: e.title,
        doi: e.doi,
        n: e.n,
        min: e.min,
        max: e.max,
      })),
    };
  });
}

const EVIDENCE_ROW_KEYS = [
  'investigation', 'accession', 'doi', 'table_file', 'row_ref',
  'row_kind', 'material_canonical', 'material_raw', 'material_class',
  'o2_pct_min', 'o2_pct_max', 'o2_approx',
  'pressure_psi_min', 'pressure_psi_max', 'flow_cm_s',
  'outcome', 'burn_time_s', 'notes',
];

/** The evidence behind a verdict: the verdict itself, the exact PSI
 *  rows behind it (full row records — never a summary), the DOI per
 *  investigation, and the citations. Design-range rows are never
 *  returned (findRow excludes them). */
function evidencePack(material, atmosphereKey, o2, pressure) {
  const verdict = atmosphereKey
    ? getVerdict(material, atmosphereKey)
    : getLiveVerdict(material, o2, pressure);
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
    accession: acc,
    title: e.title,
    doi: e.doi,
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
    snapshot: snapshot(),
  };
}

/** Is the live PSI service reachable from this host? Any HTTP response
 *  counts as reachable; a network error or timeout counts as not.
 *  Never fakes freshness — when unreachable, callers report the
 *  snapshot date instead. */
async function checkPsiLive(timeoutMs = 5000) {
  try {
    const res = await fetch(PSI_API_ROOT, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'SPICA-firelab/1.0' },
    });
    return { live: true, http_status: res.status, url: PSI_API_ROOT };
  } catch (e) {
    return { live: false, http_status: null, url: PSI_API_ROOT, error: e?.name || 'Error' };
  }
}

export default async function handler(req) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (method !== 'GET') return err(405, 'only GET is supported');

    const url = new URL(req.url);
    const r = route(url.pathname);
    const params = url.searchParams;

    if (r === '/' || r === '') {
      return json(200, {
        service: 'spica-verdict-engine',
        version: 1,
        endpoints: [
          'GET /api/health',
          'GET /api/materials',
          'GET /api/verdict?material=&atmosphere=  (or ?o2=&pressure=&flow=)',
          'GET /api/scatter?material=all|<material>',
          'GET /api/ranking?atmosphere=  (or ?o2=&pressure=)',
          'GET /api/evidence?material=&atmosphere=  (or ?o2=&pressure=)',
          'GET /api/brief?atmosphere=',
          'GET /api/coverage?material=  (optionally &atmosphere= or &o2=&pressure=)',
          'GET /api/plan?materials=<a,b>&atmosphere=  (or &o2=&pressure=)',
          'GET /api/freshness',
        ],
        snapshot: snapshot(),
        disclaimer: COVERAGE_DISCLAIMER,
      });
    }

    if (r === '/health') {
      return json(200, { status: 'ok', service: 'spica-verdict-engine', version: 1, ...snapshot() });
    }

    if (r === '/materials') {
      return json(200, { materials: listMaterials(), count: Object.keys(VERDICTS).length, snapshot: snapshot() });
    }

    if (r === '/verdict') {
      try {
        return json(200, verdictFromParams(params));
      } catch (e) {
        return err(e.status || 500, e.message);
      }
    }

    if (r === '/scatter') {
      const material = params.get('material') || 'all';
      if (material !== 'all' && !(material in VERDICTS)) {
        return err(404, `unknown material '${material}'`);
      }
      const points = getScatterPoints(material);
      return json(200, {
        material,
        count: points.length,
        counts: scatterCounts(),
        points,
        note: '997 points have both O2 and pressure; 11 PSI-10 rows record pressure but no O2 and are counted, not plotted.',
      });
    }

    if (r === '/ranking') {
      const atmosphere = params.get('atmosphere');
      if (atmosphere) {
        if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
          return err(400, `unknown atmosphere '${atmosphere}'`);
        }
        return json(200, { atmosphere, ...getRanking(atmosphere) });
      }
      const o2 = numParam(params, 'o2');
      const pressure = numParam(params, 'pressure');
      if (o2 == null || pressure == null) {
        return err(400, 'give ?atmosphere=ISS|Orion|Exploration or ?o2=&pressure=');
      }
      return json(200, { o2, pressure, custom: true, ...getRankingLive(o2, pressure) });
    }

    if (r === '/evidence') {
      const material = params.get('material');
      if (!material) return err(400, 'param material is required');
      if (!(material in VERDICTS)) return err(404, `unknown material '${material}'`);
      const atmosphere = params.get('atmosphere');
      if (atmosphere) {
        if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
          return err(400, `unknown atmosphere '${atmosphere}'`);
        }
        return json(200, evidencePack(material, atmosphere));
      }
      const o2 = numParam(params, 'o2');
      const pressure = numParam(params, 'pressure');
      if (o2 == null || pressure == null) {
        return err(400, 'give ?atmosphere=ISS|Orion|Exploration or ?o2=&pressure=');
      }
      return json(200, evidencePack(material, null, o2, pressure));
    }

    if (r === '/brief') {
      const atmosphere = params.get('atmosphere');
      if (!atmosphere) return err(400, 'param atmosphere is required');
      if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
        return err(400, `unknown atmosphere '${atmosphere}'`);
      }
      return json(200, buildBrief(atmosphere));
    }

    if (r === '/coverage') {
      const material = params.get('material');
      if (!material) return err(400, 'param material is required');
      if (!(material in VERDICTS)) return err(404, `unknown material '${material}'`);
      const atmosphere = params.get('atmosphere');
      if (atmosphere) {
        if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
          return err(400, `unknown atmosphere '${atmosphere}'`);
        }
        return json(200, buildCoverage(material, atmosphere));
      }
      const o2 = numParam(params, 'o2');
      const pressure = numParam(params, 'pressure');
      if (o2 != null || pressure != null) {
        if (o2 == null || pressure == null) {
          return err(400, 'give ?atmosphere=ISS|Orion|Exploration or ?o2=&pressure=');
        }
        return json(200, buildCoverageLive(material, o2, pressure));
      }
      return json(200, buildCoverage(material));
    }

    if (r === '/plan') {
      const raw = params.get('materials');
      if (!raw) return err(400, 'param materials is required (comma-separated list)');
      const materials = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (!materials.length) return err(400, 'param materials is required (comma-separated list)');
      for (const m of materials) {
        if (!(m in VERDICTS)) return err(404, `unknown material '${m}'`);
      }
      const atmosphere = params.get('atmosphere');
      if (atmosphere) {
        if (!ATMOSPHERE_KEYS.includes(atmosphere)) {
          return err(400, `unknown atmosphere '${atmosphere}'`);
        }
        return json(200, buildPlan(materials, atmosphere));
      }
      const o2 = numParam(params, 'o2');
      const pressure = numParam(params, 'pressure');
      if (o2 == null || pressure == null) {
        return err(400, 'give ?atmosphere=ISS|Orion|Exploration or ?o2=&pressure=');
      }
      return json(200, buildPlanLive(materials, o2, pressure));
    }

    if (r === '/freshness') {
      const psi = await checkPsiLive();
      return json(200, {
        psi,
        snapshot: snapshot(),
        note: 'Verdicts use the cleaned snapshot when PSI is unreachable from this host; nothing is re-fetched or faked.',
      });
    }

    return err(404, `unknown route '${r}'`);
  } catch (e) {
    // Never leak a bare 500 without a message.
    return err(500, `${e?.name || 'Error'}: ${e?.message || e}`);
  }
}

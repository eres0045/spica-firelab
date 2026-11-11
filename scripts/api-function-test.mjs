// Test the esbuild-bundled Netlify function against every endpoint and
// the known ground-truth values (mirrors backend/tests/test_verdicts.py).
//
// Run after `netlify build` — the bundle lives in .netlify/functions/:
//   node scripts/api-function-test.mjs
// or point it at an unzipped bundle dir:
//   node scripts/api-function-test.mjs /tmp/api-bundle
//
// The source (netlify/functions/api.mjs) imports src/lib/data.js, whose
// bare JSON imports raw Node rejects — so this tests the bundle, which
// is exactly what Netlify ships.
import { pathToFileURL } from 'node:url';

const bundleDir = process.argv[2] || '.netlify/functions-unzipped';
const { default: handler } = await import(pathToFileURL(`${bundleDir}/api.mjs`).href);

const call = async (path, params = {}, method = 'GET') => {
  const qs = new URLSearchParams(params).toString();
  const url = `https://spica-firelab.netlify.app${path}${qs ? `?${qs}` : ''}`;
  const res = await handler(new Request(url, { method }));
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, cors: res.headers.get('Access-Control-Allow-Origin'), body };
};

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
};

let t;
t = await call('/api/health');
assert(t.status === 200 && t.body.rows === 2012 && t.body.investigations === 19 && t.body.tables === 21,
  `health rows=2012 inv=19 tables=21 (got ${JSON.stringify(t.body)})`);
assert(t.cors === '*', 'CORS * on health');

t = await call('/api/verdict', { material: 'SIBAL fabric', atmosphere: 'Exploration' });
assert(t.body.kind === 'GAP_O2' && t.body.o2_distance_pts === 11.9 &&
  JSON.stringify(t.body.o2_nearest_row) === JSON.stringify(['PSI-99', 'Sample 2-5']),
  `SIBAL@Exploration GAP 11.9 PSI-99 Sample 2-5 (got ${JSON.stringify({ k: t.body.kind, d: t.body.o2_distance_pts, r: t.body.o2_nearest_row })})`);
assert(typeof t.body.line === 'string' && t.body.line.includes('11.9'), 'verdict line has 11.9');

t = await call('/api/verdict', { material: 'Methanol', o2: '34', pressure: '8.2', flow: '5' });
assert(t.body.kind === 'GAP_PRESSURE' && t.body.pressure_distance_psi === 1.98 &&
  t.body.pressure_nearest_psi === 10.18 && t.body.flow_cm_s === 5,
  `Methanol 34/8.2 pressure GAP 1.98 nearest 10.18 flow echoed (got ${JSON.stringify({ k: t.body.kind, d: t.body.pressure_distance_psi, p: t.body.pressure_nearest_psi, f: t.body.flow_cm_s })})`);

t = await call('/api/verdict', { material: 'SIBAL fabric', atmosphere: 'ISS' });
assert(t.body.kind === 'PARTIAL', `SIBAL@ISS PARTIAL (got ${t.body.kind})`);

t = await call('/api/verdict', { material: 'Methanol', o2: '26.5', pressure: '10.2' });
assert(t.body.kind === 'TESTED', `Methanol@Orion TESTED (got ${t.body.kind})`);

t = await call('/api/verdict', { material: 'Nope', atmosphere: 'ISS' });
assert(t.status === 404, `unknown material 404 (got ${t.status})`);
t = await call('/api/verdict', { atmosphere: 'ISS' });
assert(t.status === 400, `missing material 400 (got ${t.status})`);
t = await call('/api/verdict', { material: 'Methanol' });
assert(t.status === 400, `live without o2+pressure 400 (got ${t.status})`);
t = await call('/api/verdict', { material: 'Methanol', o2: 'abc', pressure: '8.2' });
assert(t.status === 400, `non-numeric o2 400 (got ${t.status})`);

t = await call('/api/materials');
assert(t.body.count === 34 && t.body.materials.find((m) => m.material === 'SIBAL fabric')?.n_o2_rows > 0,
  `materials count=34 (got ${t.body.count})`);

t = await call('/api/scatter', { material: 'all' });
assert(t.body.count === 997 && t.body.counts.both === 997 && t.body.counts.pNoO2 === 11,
  `scatter 997, pNoO2 11 (got ${t.body.count}/${JSON.stringify(t.body.counts)})`);
t = await call('/api/scatter', { material: 'Methanol' });
assert(t.body.count > 0 && t.body.points.every((p) => p.material === 'Methanol'), 'scatter Methanol filtered');

t = await call('/api/ranking', { atmosphere: 'Exploration' });
assert(t.body.cabin[0].material === 'SIBAL fabric' && t.body.cabin[0].gap === 11.9,
  `ranking Exploration cabin[0] SIBAL 11.9 (got ${t.body.cabin[0]?.material} ${t.body.cabin[0]?.gap})`);
t = await call('/api/ranking', { o2: '34', pressure: '8.2' });
assert(t.body.custom === true && t.body.cabin[0].gap === 11.9, 'ranking live 34/8.2');

t = await call('/api/evidence', { material: 'SIBAL fabric', atmosphere: 'Exploration' });
assert(t.body.nearest_o2_row?.row_ref === 'Sample 2-5' &&
  t.body.citations.some((c) => c.doi === '10.60555/2chp-m469'),
  `evidence nearest row Sample 2-5 + DOI 10.60555/2chp-m469 (got ${t.body.nearest_o2_row?.row_ref})`);

t = await call('/api/brief', { atmosphere: 'Exploration' });
assert(t.body.cabin[0].material === 'SIBAL fabric' && t.body.cabin[0].gap === 11.9 &&
  t.body.citations.length === 9 && t.body.reports.length === 3,
  `brief cabin[0] SIBAL 11.9, 9 citations, 3 reports (got ${t.body.citations.length}/${t.body.reports.length})`);
assert(t.body.disclaimer.includes('Coverage, not certification'), 'brief disclaimer');

t = await call('/api/freshness');
assert(typeof t.body.psi.live === 'boolean' && t.body.snapshot.rows === 2012,
  `freshness live boolean + snapshot 2012 (live=${t.body.psi.live})`);

t = await call('/api/nope');
assert(t.status === 404, `unknown route 404 (got ${t.status})`);
t = await call('/api/verdict', { material: 'Methanol' }, 'OPTIONS');
assert(t.status === 204, `OPTIONS 204 (got ${t.status})`);
t = await call('/.netlify/functions/api/verdict', { material: 'SIBAL fabric', atmosphere: 'Exploration' });
assert(t.status === 200 && t.body.o2_distance_pts === 11.9, 'direct /.netlify/functions path works');
t = await call('/api');
assert(t.status === 200 && t.body.service === 'spica-verdict-engine', 'root index');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

# SPICA verdict-engine API — Flask dev server

The backend for "The 34% Question" (NASA Space Apps 2026, Team SPICA).
It computes atmosphere-coverage verdicts **live from the 2,012-row NASA
PSI cleaned dataset** — the same math as the frontend's
`app/src/lib/data.js`, ported to Python in `verdicts.py` (this folder).
The deployed Netlify Function (`app/netlify/functions/api.mjs`) is
JavaScript and imports `data.js` directly — Netlify Functions do not
support Python — so the app and the deployed API share one logic copy,
while this Flask server is the local dev equivalent. Both are pinned to
the same known values by their test suites (`tests/test_verdicts.py`,
22 tests, and the function's own checks).

## Run

```bash
python3 app.py            # http://127.0.0.1:5000
```

Requires Flask (`pip install -r requirements.txt`; 3.1.3 verified).
The frontend's Vite dev server proxies `/api` here (see
`app/vite.config.js`), or set `VITE_API_BASE=http://127.0.0.1:5000`.

## Endpoints

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness + dataset snapshot (2,012 rows, 19 investigations) |
| `GET /api/materials` | All 34 materials with tested ranges + investigations |
| `GET /api/verdict?material=&atmosphere=` | Preset verdict (ISS / Orion / Exploration) |
| `GET /api/verdict?material=&o2=&pressure=&flow=` | Live verdict at arbitrary conditions |
| `GET /api/scatter?material=all\|<material>` | Evidence scatter points (997 with both axes) |
| `GET /api/ranking?atmosphere=` (or `?o2=&pressure=`) | Materials ranked by coverage gap |
| `GET /api/evidence?material=&atmosphere=` (or `?o2=&pressure=`) | The exact PSI rows + DOIs behind a verdict |
| `GET /api/brief?atmosphere=` | Printable mission brief (ranking + citations) |
| `GET /api/freshness` | Is live PSI reachable? Snapshot date if not — never faked |

## Honesty rules

Verdicts are **coverage** (tested vs gap), never safety certifications.
No number, DOI or test is invented; the nearest cited test is always
a real cleaned PSI row (design-range matrices are never cited).
Flow changes flame shape only; PSI verdicts are O2 x pressure.

## Deploy

The deployed API is a Netlify Function (`app/netlify/functions/api/`,
pure stdlib, no Flask) on the existing spica-firelab site, served at
`/api/*` via the redirect in `app/netlify.toml`. There is no separate
host to pay for — Ronit has no card, and Render new-service creation
is card-gated, so it is not used. If the function is ever down, the
app degrades to its bundled PSI data and says so in the panel
("on-device data").

## Tests

```bash
python3 -m pytest tests/ -q
```

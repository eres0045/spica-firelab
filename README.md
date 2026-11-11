# The 34% Question — SPICA · Flame in Freefall

NASA Space Apps 2026 · Team SPICA · Challenge: **Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data**

An interactive 3D fire lab: a rack glovebox inside a real ISS interior scan, with a live flame driven by O₂ / pressure / flow sliders and a live safety verdict computed only from real NASA PSI microgravity-combustion data (2,012 cleaned rows, 19 flight investigations).

The gap it shows: **solids were never tested above 22.2% O₂** — so at the Exploration atmosphere (34% O₂ @ 8.2 psi), SIBAL fabric carries a **GAP of 11.9 O₂ points** against the nearest real test.

## Run it

```bash
npm install
npm test        # 69 tests
npm run build   # -> dist/
npm run preview # http://localhost:4173
```

Live demo: https://eres0045.github.io/spica-firelab/

## Data & credits

- NASA PSI (Physical Sciences Informatics) microgravity combustion data — public.
- 3D models: ISS by uperesito (CC-BY), ISS interior scan by Patrick (CC-BY), floating astronaut by LasquetiSpice (CC-BY), Crew Dragon by dannzjs (CC-BY), JAXA Int-Ball by pergamond (CC-BY); NASA Shuttle / Canadarm / LRO are NASA public domain. Full attributions in the app credits line.
- Flame shown is illustrative — safety verdicts come from real PSI test data, and are coverage statements, never safety certifications.

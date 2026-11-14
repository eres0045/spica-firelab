# The 34% Question — SPICA · Flame in Freefall

NASA Space Apps 2026 · Team SPICA · Challenge: **Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data**

An interactive 3D fire lab: a rack glovebox inside a real ISS interior scan, with a live flame driven by O₂ / pressure / flow sliders and a live safety verdict computed only from real NASA PSI microgravity-combustion data (2,012 cleaned rows, 19 flight investigations).

The gap it shows: **in PSI's archived flight investigations, solids were never tested above 22.2% O₂** — so at the Exploration atmosphere (34% O₂ @ 8.2 psi), SIBAL fabric carries a **GAP of 11.9 O₂ points** against the nearest real test. The closest flight tests beyond PSI reach further — SAFFIRE-VI burned SIBAL at 31.0% O₂ — but the exact lunar point, 34% O₂ at 8.2 psi across a full material set, is still untested.

## Run it

```bash
npm install
npm test        # 139 tests
npm run build   # -> dist/
npm run preview # http://localhost:4173
```

Live demo: https://eres0045.github.io/spica-firelab/

Demo video (30 s): https://eres0045.github.io/spica-firelab/video/spica-demo-30s.mp4

## Data & credits

- NASA PSI (Physical Sciences Informatics) microgravity combustion data — public.
- 3D models: ISS by uperesito (CC-BY), ISS interior scan by Space Explorers Academy (CC BY-NC-SA 4.0), floating astronaut by LasquetiSpice (CC-BY), Crew Dragon by dannzjs (CC-BY), JAXA Int-Ball by pergamond (CC-BY); Sun texture by Solar System Scope (CC BY 4.0); NASA Shuttle / Canadarm / LRO are NASA public domain. Full attributions in the app credits line.
- Flame shown is illustrative — safety verdicts come from real PSI test data, and are coverage statements, never safety certifications.

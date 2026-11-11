# BUILD NOTES — SPICA / "The 34% Question" frontend

Built 2026-11-11 (Ronit ordered the UI + 3D assembly started now; Flask
backend still comes on building day, Nov 14–15). No backend, no deployment,
no submission in this pass.

## What was built

`app/` — Vite + React 19 + Tailwind v4, plain `three` 0.187.0 (no
react-three-fiber). Dark space theme, one screen (desktop: picker left,
scatter centre, verdict right; mobile stacks verdict first).

- `src/lib/data.js` — data layer. Bundles `src/data/cleaned.json` (2,012
  rows) + `src/data/coverage-verdicts.json` (34 materials) at build time,
  so the UI works standalone with no backend. Exposes `getScatterPoints`,
  `getVerdict`, `getRanking`, `gapEndpoint`, `verdictLine`, `detectWebGL`,
  and `tryApi()` — the Flask wiring: `tryApi()` probes
  `/api/materials`, `/api/scatter`, `/api/ranking` and falls back to the
  bundled JSON. The App only probes when `VITE_API_BASE` is set, so the
  standalone app makes no failing requests.
- `src/components/Scatter3D.jsx` — Three.js scatter: X = O₂ (0–100%),
  Y = pressure (0–75 psi), Z = flow (0–30 cm/s; only 8 rows record flow —
  the rest sit on the labelled "flow not recorded" back plane). 997 points,
  solids amber / droplets cyan / gases violet, selected material bright +
  larger, rest dimmed (except when the selected material has no plotted
  points — solids — then the whole cloud stays bright). Three atmosphere
  spheres (ISS green, Orion blue, Exploration red/orange; selected pulses),
  animated dashed gap line + floating gap label, green ring when TESTED,
  OrbitControls (damping, no pan, auto-rotate until first interaction),
  600 ms camera ease on atmosphere switch, point tooltips (material,
  accession, O₂, pressure, flow, outcome), pixel ratio capped at 2.
- `src/components/Scatter2D.jsx` — mandatory 2D fallback (SVG): same
  points, colours, atmosphere markers, gap line and verdicts. Shown
  automatically when WebGL is unavailable; also a manual 3D/2D toggle.
- `src/components/VerdictCard.jsx` — huge gap number (or TESTED / "O₂
  COVERED" for PARTIAL), plain-language line, nearest-test citations
  (accession + row ref + DOI), max-atmosphere second line, PARTIAL honesty
  note, SIBAL photo (PSI-25 BASS-II, DOI cited), "no PSI photo" note for
  FLEX droplets, mandatory honesty labels.
- `src/components/RankingBars.jsx` — cabin materials ranked by gap,
  largest first; gaseous fuels in a separate labelled group. Clicking a bar
  selects that material.
- `src/components/ModelViewer.jsx` — GLTFLoader + DRACOLoader, decoder
  WASM bundled locally under `public/draco/` (never CDN). ISS → iss-a.glb;
  Exploration → hdu-part1.glb (primary) with Apollo Lunar Module toggle;
  Orion → no model (flat-grey capsule was dropped; scatter + verdict
  only). Slow auto-rotate, no orbit controls, hides itself on load failure
  and when WebGL is unavailable.
- `src/App.jsx` — atmosphere presets (ISS 21% @ 14.7 psi / Orion 26.5%
  @ 10.2 psi / Exploration 34% @ 8.2 psi), material picker (5 headline +
  All materials), demo beats in the footer.

## How to run

```bash
cd app
npm install          # already done; 173 packages, three 0.187.0
npm run dev          # http://localhost:5173
npm test             # vitest — 21 tests
npm run build        # vite build -> dist/ (2.36 MB JS, 291 KB gzip — mostly the bundled 1.65 MB cleaned.json)
npm run preview      # serves dist/ on :4173
node scripts/smoke.mjs       # headless-browser smoke (WebGL + no-WebGL runs)
node scripts/model-probe.mjs # ISS + HDU model load probe
```

## Verified (2026-11-11, all genuinely run)

- `npm run build` — passes cleanly.
- `npm test` — **21/21 pass** (16 data tests + 5 App tests). Data tests
  assert the scatter count, the headline verdicts (SIBAL/ISS PARTIAL,
  SIBAL/Exploration GAP 11.9, Methanol/Exploration pressure GAP 1.98 psi,
  Heptane/Orion TESTED), ranking order, gas separation, gap endpoints.
  App tests run the full demo flow in jsdom: SIBAL+ISS → PARTIAL,
  Exploration → 11.9, Methanol → 1.98 psi, Orion → no model, honesty
  labels present.
- Headless Chromium (Playwright, SwiftShader) against the built app:
  **WebGL run and no-WebGL run both fully green** — title, default
  PARTIAL, Exploration GAP 11.9, Methanol GAP 1.98 psi, 2D toggle shows
  the same verdicts, **zero console errors, zero failed requests**.
  2 canvases in the WebGL run (scatter + model viewer); 0 in the no-WebGL
  run, where the SVG fallback renders 1,005 circles (997 data points +
  8 markers/rings — count reconciles exactly).
- Model viewer verified in a real browser: **iss-a.glb (200) + HDU
  hdu-part1.glb (200) + draco_decoder.wasm (200)**, loading text clears,
  zero console errors. Screenshots checked visually: 3D scatter with gap
  label, 2D fallback with staggered atmosphere labels, HDU habitat
  rendering in the viewer.
- Two real bugs found and fixed by the checks: (1) the verdict card
  rounded the 1.98 psi gap to "2" (`fmt(...,1)`); (2) solids selected
  left the whole cloud dimmed with nothing bright — now the cloud stays
  bright when the selected material has no plotted points.

## 3D-look fix (2026-11-11 ~07:35 IST — Ronit: "It's not 3D… this looks bad")

He was right. In the first preview screenshots the scatter cloud was a
tiny flat sprinkle in the middle of a huge empty wireframe box, and the
model viewer sat below the fold in the left column, invisible in the
first viewport. What was wrong, and what changed (presentation only — no
data, verdict, gap or citation changed):

1. **Camera never framed the cloud.** The camera sat at a fixed (7, 5,
   10) looking at the origin, while the cloud's centre is (-1.5, -1.3,
   -2.2) — off-centre and far away. Now the camera is FITTED to the
   actual point-cloud bounding box (points + atmosphere spheres):
   distance computed from the bbox and the viewport aspect, target on the
   bbox centre, default direction a true 3/4 angle (0.85, 0.55, 0.75).
   Atmosphere switches ease the target to a point between the cloud
   centre and the sphere so the cloud stays in frame. The cloud now
   fills the viewport.
2. **Points were hard square dots.** Now big soft glowing sprites
   (canvas radial-gradient texture) with additive blending, size
   attenuation, bright 0.38 / dim 0.26, and auto-rotate raised 0.7 → 1.8
   so the rotation is actually visible.
3. **No depth cues.** Added: a real floor grid + bottom-wall grid on the
   chart cube, bright axis lines, tick labels with real values (O₂ 0–100%,
   pressure 0–75 psi, flow), and fog (0x0e1626, 10–22) so the far side
   of the cube recedes. The scene background is now an opaque dark
   colour so the fog works.
4. **Spheres were small and faint.** Now core 0.34, halo 0.78, plus an
   additive glow sprite (scale 2.6) per sphere, pulse 1 ± 0.18.
5. **The gap line was a 1px dashed line — invisible at this scale.**
   Now a glowing tube (radius 0.07) with an endpoint marker and a
   travelling pulse sprite. (Honest limit: for PARTIAL the tube is ~0
   long — the nearest test is 0.2 O₂ pts away and the gap is in pressure,
   which PSI never recorded — and for methanol the pressure gap is 1.98
   psi on a 75 psi axis, so the tube is short; the floating label and
   the verdict card carry those gaps, the tube is a pointer, not the
   message.)
6. **Model viewer was buried.** It moved out of the left column into the
   scatter section as a bottom-right overlay on desktop (compact mode:
   smaller panel, h-36 canvas), so the ISS / habitat model is in the
   first viewport of the default screenshot. On mobile it sits in normal
   flow below the scatter. It still renders in 3D view only (plus the
   Orion "no model" note in any view, so the jsdom tests keep passing);
   lazy-loading per atmosphere, local Draco WASM, hide-on-failure, no
   model for Orion — all unchanged.
7. **Colour washout, found by looking at the new screenshots.** The
   first attempt at brighter points (1.6× colour boost) pushed
   violet/cyan/amber past 1.0, so every point rendered near-white under
   additive blending. Reverted: the 3D pass now uses deeper, more
   saturated shades of the same hues (droplet #06b6d4, gas #8b5cf6,
   solid #f59e0b — `POINT_COLORS` in Scatter3D.jsx). The legend and the
   2D fallback keep the base class colours. Note: no amber points ever
   appear in the cloud — solids (SIBAL/Nomex/PMMA) have no pressure
   recorded in PSI, so they have no plotted points; that is data, not a
   rendering bug, and the footnote says so.
8. **Smoke-script timing.** `scripts/smoke.mjs` waited a fixed 4 s after
   networkidle before checking the model loader, but in this throttled
   headless environment the GLB request starts ~1.4 s after networkidle
   and Draco lands at ~7–9 s wall-clock, so `modelLoadingGone` flaked
   even though the model loads fine. The script now waits (up to 15 s)
   for the loading text to clear instead — the check still fails if the
   loader never clears.

Re-verified after the fix: `npm run build` passes, `npm test` 21/21
green (no test changes), headless smoke WebGL + no-WebGL both fully
green with zero console errors and zero failed requests, model-probe
ISS + HDU 200s, preview screenshots re-taken (see `../preview/`).

## CORRECTION — scatter is 997 points, not 1,008

The prep notes say "1,008 points". That is wrong. 1,008 rows have
pressure and 1,222 have O₂, but only **997 have both** — 11 Flame Design
inverse rows (PSI-10) record pressure but no O₂, so they cannot be placed
on the O₂ axis. The app plots 997 and says so in the UI footnote and in
`src/lib/data.js`. The 11 rows are counted, not dropped silently. The
PREP_NOTES.md claim should be corrected on build day.

## Deliberately NOT built (per the brief)

No Flask backend, no 3D cabin model, no FLEX ML predictor, no
"will it burn?" checker, no all-investigations dashboard, no video
analysis, no deployment, no submission.

## PIVOT — Fire Lab is the centerpiece now (2026-11-11, ~07:59 IST, Ronit's call)

Ronit: "No whatever u do it won't fix this. I was thinking like a 3d game
type where they can do stuff like control that fire and we will show if
they increase or decrease that stuff live it will show safety and all type
stuff yk". The scatter dashboard is DEMOTED — it survives only as the
"Evidence — test cloud" tab. The centerpiece is now the interactive 3D
fire lab (`src/components/FireLab3D.jsx` + `src/components/Missions.jsx`).

- **FireLab3D**: a 3D glass test chamber (built in code — no chamber model
  exists that passes the realistic + light bar, see `assets/GAME_ASSETS.md`)
  holding a material sample, with a LIVE FLAME inside: four Kenney-sprite
  particle clouds in a ball (microgravity flames are spherical) + a glow
  halo + a point light. `flameParams()` (pure, tested) maps the controls to
  the flame: O2 10–40% → radius 0.30–0.85 (droplets 0.85×) and colour
  blue → amber → orange; flow 0–30 cm/s → elongation to 1.9× + downstream
  shift; pressure 6–15 psi → brightness 0.55–1.0; O2 ≤ 13% → near-extinction
  flicker + smoke puffs (smoke_03) + a one-shot ignition burst (fire_01) on
  material change or re-ignition. The flame eases toward the slider targets
  so dragging reads as the flame growing/shrinking live. OrbitControls with
  auto-rotate (stops on first drag). No-WebGL fallback panel keeps the
  sliders + verdict working.
- **Live safety**: `getLiveVerdict(material, o2, pressure)` in
  `src/lib/data.js` computes TESTED / GAP / PARTIAL at arbitrary slider
  values from the pre-computed coverage verdicts + real cleaned rows
  (nearest-row citations, FLEX-2 design rows excluded). The three anchor
  examples are tested: SIBAL @ Exploration 34% → GAP 11.9 O2 pts (nearest
  PSI-99 Sample 2-5, 22.1%); methanol @ 34% / 8.2 psi → pressure GAP 1.98
  psi (nearest 10.18 psi, FLEX test 121, outcome Extinction); SIBAL @ ISS
  21% → PARTIAL (O2 covered, pressure not recorded).
- **Missions** (`src/components/Missions.jsx`): 3 missions + free play.
  M1 SIBAL/Exploration GAP 11.9 + PSI-99 citation; M2 methanol/Exploration
  pressure GAP 1.98 psi + FLEX test 121 Extinction; M3 open-ended "find any
  TESTED combination" with a computed hint. Quiz unlocks only when the lab
  conditions match the mission target; feedback shows the real answer +
  citation. No fake scores, no invented numbers.
- **Layout**: desktop one screen (controls left, chamber centre, live
  verdict right); mobile stacks safety first, then chamber, then controls.
- **Game assets** (2026-11-11 ~08:35 IST, `assets/GAME_ASSETS.md`): HDRI
  `qwantani_night_puresky_1k.hdr` (Poly Haven, CC0) loaded via RGBELoader +
  PMREM as `scene.environment` ONLY (intensity 0.8) — never the visible
  background; Kenney Particle Pack sprites (CC0, white, tinted in-engine by
  O2): flame_05 primary, flame_01/02 wispy variants, fire_01 ignition
  burst, smoke_03 smoke, light_01 core glow, star_04 twinkling starfield.
  Copied into `app/public/hdr/` + `app/public/sprites/` (canonical copies
  untouched in `assets/game/`); a test asserts all 9 files exist in
  `public/` and the HDR starts with `#?RADIANCE`. Credits in the app
  footer. No astronaut figure — nothing free + light + realistic was found.
- **Visual iteration (same day)**: first pass read as a swarm of small
  flame tongues, not one ball, and the smoke was invisible. Fixed by
  shrinking the sprites (main 0.52→0.34) and raising counts (380/300/260),
  enlarging the glow envelope (radius×4.2), brightening the glass edges
  (full opacity, light colour) + a faint blue glass tint, and bigger smoke
  (scale 0.8–1.3, opacity 0.35, rising from the flame top). Re-verified in
  screenshots — the flame now reads as one coherent fireball at 21% (amber)
  and 34% (bigger, oranger), a small blue-violet ball at 10% with visible
  smoke, and elongated downstream at 30 cm/s flow.
- **Tests**: 46/46 green (22 data + App + FireLab3D, incl. 9 game-asset
  existence tests + the 3 anchor live-verdict tests). `npm run build`
  passes; `dist/` is 9.4 MB incl. the 1.39 MB HDR + sprites + Draco WASM.
- **Screenshots** (`preview/firelab-*.png`, headless Chromium + SwiftShader,
  preview on :4173): 01 default ISS, 02 Exploration GAP 11.9, 03 methanol,
  04 mission setup, 05 mission quiz, 06 Evidence scatter, 07 mobile
  (safety-first stack), 08 low O2 10% (blue ball + smoke, GAP 6.4),
  09 high flow 30 cm/s (elongated flame). Mobile shot needed its own
  script (`scripts/firelab-shots-mobile.mjs`, fresh browser, 120 s timeout)
  — the combined script's mobile shot timed out twice at 30 s because the
  desktop page's WebGL loop was still running in the same browser. Error
  report is clean on both pages: `scripts/firelab-error-probe.mjs`
  (desktop: preset + sliders + material switch + Evidence tab) and the
  mobile-only run both printed `{ "errors": [] }` — zero console errors,
  zero failed requests, zero HTTP ≥ 400.

## Left for build day (Nov 14–15)

1. Flask backend (`backend/app.py` per PREP_NOTES.md): serve
   `cleaned.json` + `/api/materials`, `/api/verdict`, `/api/scatter`,
   `/api/ranking` (read-only lookups over the pre-computed verdicts).
   Then set `VITE_API_BASE` and confirm the app's live-API badge flips
   from "Bundled data" to "Live API" — `tryApi()` already handles the
   fallback; the swap needs a test that verdicts from the API match the
   bundled JSON exactly.
2. Correct the "1,008 points" line in PREP_NOTES.md to 997.
3. Record the 30-sec demo (script beats are in the app footer).
4. Write the Space Apps project page (dataset + DOIs + honesty labels +
   AI-use declaration; target Best Use of Data, second Best Use of
   Science).
5. **Pre-submit checkpoint with Ronit**, then submit before Nov 15,
   23:59 local.
6. Nov 13: re-check the official challenge Resources tab + Submission /
   Judging guide; align citations if a curated dataset is listed.

## Scene models (real online models) — 2026-11-11 ~09:00 IST (Ronit's direction)

Do NOT code-build the scene — use the real models in `assets/game/models/` (see
`assets/SCENE_MODELS.md`): Earth sphere from `earth-atmos-2048.jpg` (+ specular /
normal / night-lights maps), Moon from `moon-1024.jpg`, NASA astronaut
`astronaut-nasa.glb` (Draco — already bundled), transparent glass control panel as
a DOM overlay over the full-screen 3D canvas. Human-gate (needs a Sketchfab
account download): uperesito ISS (H1) + patrick- ISS interior scan (H3) — until
fetched, fall back to `models/iss-a.glb` + the current chamber scene. The chamber
itself stays code-built: no usable chamber/glovebox model exists anywhere (verified
again this round — only the all-rights-reserved fabioorsi MSG).

## Scene models integration — DONE 2026-11-11 ~09:15–10:00 IST, verified

- Earth sphere (Blue Marble atmos + specular + normal + night-lights
  emissive, slow spin, blue halo shell + glow sprite) at (-13,-10,-10) r=5;
  Moon at (-4.6,3.2,-6.5); ISS (probed: uperesito if present, else
  `iss-a.glb`) at (-0.9,1.7,-3.8) scale 2.2; NASA astronaut
  (`astronaut-nasa.glb`, Draco) small at (2.2,0.9,2.0), drifting.
  Composition tuned over 3 rounds so nothing hides behind the glass
  panels or the Moon (ISS was panel-occluded, then Moon-overlapped).
- Glass is now PLAIN transparent (opacity 0.08), not transmission — the
  transmission pass refracted the nearby astronaut into a blurry blue
  "ghost twin" on the wall. Lid is a metal frame + glass top (no solid
  slab). Low-O₂ flame dimmed further (dim 0.45, flicker 0.11, smoke 0.45,
  deeper blue) — better, still slightly sparkle-like (stated honestly).
- Glassmorphism overlay panels (translucent dark, backdrop-blur) hold the
  sliders/material picker (left) + live VerdictCard (right) over the
  full-screen 780 px scene; mobile stacks canvas 460 px, verdict, then
  controls. Exterior / Inside-the-station toggle flies the camera in
  (0.9 s tween); interior scan lazy-loads on first toggle, else chamber
  close-up fallback (no scan yet — human-gated Sketchfab download).
  Auto-rotate OFF (deliberate composition + stable demo framing).
- `src/lib/sceneModels.js`: `resolveOptionalModel()` + `probeModelUrl()`
  = **Range GET + glTF-magic check** — vite preview's SPA fallback
  returns HTTP 200 + index.html for missing files, so HEAD "finds" them;
  sirv honours Range (present = 206 + 4 GLB bytes, missing = 206 + HTML,
  magic decides). Interior scan loads direct via GLTFLoader onError (no
  probe — avoids double-downloading a possibly 20 MB scan).
- **ISS-missing diagnosis (this round):** the ISS GLB was fetched fine
  but its onLoad fired ~16–25 s after page load in headless runs — Draco
  init + decode is slow under SwiftShader on one CPU, not a code bug.
  Fix: `window.__spicaModels = { iss, astronaut }` readiness flags set in
  the onLoad callbacks; both scene-shots scripts now `waitForFunction`
  on those flags (60 s timeout) instead of response timing. On real
  hardware Draco init is <1 s — not a user-facing issue.
- Footer credits added (Earth textures MIT/NASA via three.js; astronaut +
  ISS NASA public domain; CC-BY Sketchfab models named as not-yet-
  downloaded drop-ins). HDU bigger in compact mode (scale 2.7).
- Verification: `npm run build` passes; `npm test` **57/57 green** (12
  new scene tests: public model/texture files exist, fallback when the
  two placeholder GLBs are absent, live-verdict values unchanged);
  desktop + mobile error probes `{ "errors": [] }`; final screenshots in
  `preview/firelab-scene-01..05.png` (01 exterior, 02 Exploration 34%,
  03 interior toggle, 04 low-O₂, 05 mobile) — all read by eye: ISS +
  Earth + Moon + astronaut + chamber + glass panels all visible, zero
  console errors/requests.
- Still open: Sketchfab GLBs (uperesito ISS + interior scan) NOT
  downloaded — the browser download hit an Epic-account hCaptcha wall
  (09:35 IST); only Ronit can solve it in the live browser. Placeholder
  wiring picks them up automatically when they land in
  `app/public/models/`. Low-O₂ flame still slightly sparkle-like.

## Minimal immersive rebuild — 2026-11-11 ~10:12–10:57 IST (Ronit's order)

"Space with ISS and interior and for fire control transparent ui nothing
else nothing dashboard." The dashboard is gone; the app is now one
full-screen 3D scene + ONE transparent glass control panel.

- REMOVED from the UI: header bar, atmosphere pill row, Fire Lab /
  Evidence tabs, the big VerdictCard (DOI + photo), Missions (M1–M3 +
  quiz), Evidence scatter (2D/3D), RankingBars, ModelViewer, footer demo
  beats. Components archived (not deleted) in
  ../_archive-removed-ui-2026-11-11/ with a README. src/lib/data.js and
  src/data/ are untouched — the Flask backend (Nov 14–15) still needs
  them. lib/missions.js is now unimported (kept, archived component used
  it).
- THE PANEL (only UI): atmosphere preset chips (ISS 21% / Orion 26.5% /
  Exploration 34%), O2 (10–40%) / Pressure (6–15 psi) / Flow (0–30 cm/s)
  sliders, 5-material picker, ONE live verdict line ("SIBAL fabric ·
  Exploration 34% → GAP 11.9 O₂ pts"; PARTIAL reads "PARTIAL · O₂
  covered"; pressure gaps keep 2 decimals, "GAP 1.98 psi"), honesty line
  + CC-BY credits line (uperesito + Patrick) inside the panel. Collapsible;
  starts collapsed on mobile (bottom sheet), open on desktop (left).
- ALSO VISIBLE: tiny title chip ("The 34% Question", top-centre desktop /
  below the toggle on mobile) + small camera toggle (Exterior / Inside
  the station, top-right). Nothing else.
- POLISH folded in: astronaut 0.85 → 0.55 scale, moved to (2.6, 0.7,
  1.6); Earth moved to (-7, -10.5, -10) and exterior camera to
  (3.6, 2.0, 5.2) target (0, -0.25, 0) — Earth now reads as a crescent at
  the bottom; lid bars 0.08 → 0.06, rim 0.14 → 0.10, frame/base darkened
  (less slab); interior camera raised to (2.5, 1.45, 3.3); low-O2 flame:
  near-extinction now fades the tongue clouds hard (main 0.15, wisps
  0.12, smaller sprites) and lets the dense core + big soft glow carry
  the ball — no more purple sparkle ball.
- SKETCHFAB MODELS LANDED 10:03 IST via the Download API (Ronit's token,
  used transiently, never stored): iss-uperesito.glb 2.58 MB +
  iss-interior-scan.glb 5.91 MB in app/public/models/. The 3-s interior
  wait flaked once (shot caught the close-up fallback) — the scan now
  sets window.__spicaModels.interior on load and the shots/probe wait
  on that flag (60 s timeout).
- VERIFIED: npm test 56/56 green (4 files), npm run build green,
  firelab-scene-shots + -mobile + error-probe all ZERO errors.
  Screenshots preview/firelab-scene-01..05 (desktop exterior,
  exploration, interior, low-O2, mobile) — all read by the builder.
  Remaining honest nits: astronaut still a T-pose mannequin (small now);
  interior scan occludes the flame ball from some angles (glow reads);
  Earth is a crescent, partly behind the chamber base.

## Ronit's correction — 2026-11-11 ~11:00 IST ("box and blue area" / "sidebar so much" / "only ISS and inside zoom")

He saw the live screenshot and was unhappy with three things; all fixed
and re-verified with fresh screenshots:

1. "Why do I see a box and blue area" — the scene read as a glass BOX on
   a flat dark-BLUE void.
   - Background is now TRUE BLACK (scene.background 0x000000; html/body
     and the app root bg-black; no-WebGL fallback bg-black/60). The navy
     0x0a0f1e clear colour is gone.
   - Starfield rebuilt: the old 300-star field was INVISIBLE — a sky-clip
     probe measured max pixel 17/255, 0 px above 30 in a 260x200 sky
     region. Root cause: the Kenney star_04.png sparkle's energy lives in
     thin spikes, which mipmapping averages to nearly transparent at small
     on-screen sizes. Fix: procedural soft-round-dot CanvasTexture (bright
     core + soft falloff, LinearFilter, no mipmaps), two clouds — 1400 x
     0.4 + 250 x 1.0. Re-probe: max 178/255, 101 px >30, 38 px >80 in the
     same clip; stars are clearly visible all over the frame now.
   - Chamber stops dominating: default camera pulled back to
     (4.4, 2.3, 6.4) target (0, -0.3, 0); frame thinned (lid bars 0.05 /
     0.14, edges opacity 0.45 -> 0.3, glass tint near-white 0xf8fafc);
     base cylinder smaller (1.5/1.75) and near-black (0x0b1220); the light
     0x8b98ac frame metal is now dark 0x2b3648 (the rim was the "big white
     slab"); bottom rim shrunk to 3.0 x 0.07 (smaller than the glass box);
     floor grid + floor disc REMOVED entirely (the grid's lines crossed
     the Earth disc; the disc read as a black hole). ISS/astronaut/Dragon/
     Int-Ball scaled up slightly (2.6 / 0.68 / 0.75 / 0.42) to hold their
     screen size at the further camera.
   - Earth is now clearly visible: radius 5 -> 6, position
     (-8.5, -11.5, -10) — a big blue-marble disc (North America) at the
     bottom of the default frame, not a sliver behind the base.
2. "Sidebar so much" — the panel is now TRULY transparent glass:
   bg-white/[0.07] + backdrop-blur-md + 1px border-white/20, narrower
   (300px -> 264px); every inner element went translucent-white too
   (chips/buttons bg-white/[0.05], selected bg-white/[0.16], verdict
   bg-white/[0.08]) — no more slate-950/50 solid blocks. Text stays
   readable via a soft text-shadow (.glass-text in index.css). Stars show
   THROUGH the panel in the screenshots. A hide (X) button removes the
   panel entirely so the full visual can be enjoyed, with a small
   "Show controls" pill (bottom-left) to bring it back; collapse (v) still
   shrinks it to header + verdict line. Panel spacing tightened so the
   credits fit a 900px viewport without scrolling.
3. "Only ISS and inside zoom and all can do" — confirmed, unchanged: the
   ONLY views are Exterior (ISS + Earth + space) and Inside-the-station,
   via the one small transparent camera toggle. No other views/tabs/panels.
4. "Our main work and all fit it there" — confirmed: all fire controls
   (O2/pressure/flow sliders, material picker, atmosphere chips, the ONE
   live verdict line) live inside the single transparent panel; credits
   stay as one tiny line at the panel bottom (compressed form: "Models
   CC-BY: uperesito (ISS) · Patrick (interior) · LasquetiSpice (astronaut)
   · dannzjs (Dragon) · pergamond (Int-Ball) · Data: NASA PSI").
- VERIFIED after the correction: npm test 60/60 green (4 files, +1 new
  hide/restore test), npm run build green, desktop + mobile + error-probe
  all ZERO errors. Screenshots preview/firelab-scene-01..05 re-read by
  the builder: black space with bright stars, Earth clearly visible,
  chamber small in frame, panel see-through (stars visible through it),
  no big blue void, no big box.

## Wave 2 models — 2026-11-11 ~11:15 IST (research agent staged, integrated here)

Three public-domain NASA models, all Draco + WebP, decoded by the existing
local DRACOLoader (/draco/ decoder, never CDN). No new CC-BY credit owed;
the credits line is unchanged. Backup antropik-astronaut.glb NOT wired
(the floating LasquetiSpice stays the pick — standing pose only).

- nasa-shuttle-D.glb (2.47 MB, 42 meshes) — Space Shuttle (D), payload
  bay doors OPEN. Docked near the ISS in the exterior view: group at
  (-3.1, 1.1, -4.6), rotation.y 0.9, normalised 1.9, bobs in phase with
  the ISS. Small in frame, clearly recognisable (NASA logo visible in the
  ISS crop). Exterior only.
- nasa-canadarm.glb (271 KB, 1 mesh) — Canadarm (RMS). Along the ISS
  truss at the left end: group at (-2.3, 1.75, -3.85), rotation.y -0.4
  (aligned with the station), normalised 1.2, bobs in phase with the ISS.
  Subtle by design — reads as station hardware on the truss. Exterior only.
- nasa-lro-A.glb (654 KB, 55 meshes) — Lunar Reconnaissance Orbiter (A).
  Small distant satellite prop near the Moon: group at (-2.9, 2.4, -5.8),
  normalised 0.55, slow spin (rotation.y = t * 0.15) + gentle bob. Gold
  satellite clearly visible below the Moon. Exterior only.
- Wiring: each gets a __spicaModels flag (shuttle/canadarm/lro) and both
  shot scripts now wait for all 7 model flags (90 s timeout); the asset
  tests assert all three exist and are real glTF binaries (sceneModels.
  test.js). Dragon nudged up/right (0.65, 1.15 -> 0.85, 1.35) so it clears
  the chamber lid ring in screen space.
- Mobile framing (from the correction re-shoot): the portrait shot showed
  the chamber filling the frame (narrow horizontal FOV). The camera is now
  aspect-aware: exterior pulls back 1.45x and interior 1.15x on portrait
  aspects (camPosFor, applied at init and in the view tween).
- Wave 2 also confirmed nothing usable for Cupola/ISS modules, rovers,
  airlock/docking, standalone clouds, skybox upgrade — not chased further.
- VERIFIED: npm test 64/64 green (4 files), npm run build green,
  desktop + mobile + error-probe all ZERO errors; screenshots re-read.

## Interior-first framing + in-panel camera controls — 2026-11-11 ~12:45 IST

Ron's pick (parent's recommendation, accepted): the interior view is the
hero for the science, and the camera controls live in the glass panel
("zoom out and zoom in and all types in that sidebar as well"). The
top-right Exterior/Inside toggle is GONE — the panel's CAMERA section is
the only camera control.

- Change 1 — interior framing, measured not guessed. The scan is a long
  thin corridor (raw 15.26 long x ~3.5 diameter; app/scripts/
  scan-raycast-probe.mjs raycasts the real GLB geometry with pure three,
  no WebGL). At the old normalisation (size 9) the corridor was only
  ~2.1 wide — narrower than the 3.2-wide chamber, so the chamber poked
  through the walls and racks blocked the flame from every diagonal
  (first hit ~1.1 units; only 13/400 sampled directions clear). Fix:
  the scan is now normalised to 21.8 (~5 wide, chamber fits inside
  with room; 32/400 directions clear) and the interior camera looks
  DOWN THE MODULE AXIS from +Z — CAM_INTERIOR [0.1, 0.1, 5.0], target
  the flame centre [0, -0.15, 0] (axis sightline clear for 13.5+
  units). Exterior view untouched.
- Change 2 — CAMERA section in the FIRE CONTROL panel (after the
  verdict line): zoom out (−) / zoom in (+) buttons (dolly x1.25 /
  x0.8 along the view direction, clamped to the view limits, 0.45 s
  tween) + five preset chips — Wide, Chamber, ISS, Inside, Earth —
  each tweening the camera (0.9 s). Presets are exported as
  CAMERA_PRESETS in FireLab3D.jsx; the panel sends {seq, kind, preset}
  commands via a cameraCmd prop; zoom clears the active preset.
  Panel stays truly transparent glass (bg-white/[0.07] +
  backdrop-blur-md, border-white/20, 264px) with hide (✕) / collapse
  (▾) unchanged. Desktop panel is now scrollable
  (lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto) — the content was
  already taller than a 900px viewport before this change and the
  credits line was hard-clipped at the fold; now it scrolls like the
  mobile bottom sheet.
- Three real tween bugs found and fixed while verifying (all caught by
  the headless probes, none visible in unit tests):
  1. OrbitControls clamped the radius on the FIRST tween frame: flyTo
     set the destination's maxDistance (interior caps at 6) while the
     camera started at 8.2 out, so the camera popped ~2 units and slid
     along the clamp sphere. flyTo now widens the limits to cover the
     whole flight path and restores them (widened to contain the
     framed distance, for portrait scaling) on landing.
  2. The tween accumulated clamped dt (0.05/frame), so on a slow
     device (~0.5fps headless SwiftShader) a 0.9 s fly stretched to
     ~45 s of wall time and every screenshot caught it mid-flight.
     The tween now runs on wall-clock progress (clock.elapsedTime) —
     lands in `dur` seconds everywhere.
  3. The Earth preset's own distance (18.4) exceeded its max (16), so
     it landed clamped at radius 16 and never settled (90 s timeout
     in the probe). Earth max is now 20. New test asserts every
     preset's distance lies within its [min, max].
- Probes now wait for the camera to actually land: window.__spicaCam
  (live pos/target, added to FireLab3D) is polled until still AND
  within 0.5 of the expected framing — stillness alone fooled the
  check at ~0.5fps (the camera holds still for seconds between
  frames mid-flight). Applied in scripts/interior-probe.mjs and
  scripts/firelab-scene-shots.mjs (waitForSettledCam). Do NOT run two
  Playwright browsers in parallel on this VM (1.5 CPUs) — the error
  probe's first click timed out at 30 s under contention; solo it is
  clean.
- Shot scripts updated for the new selectors: firelab-scene-shots.mjs
  (Inside/Wide presets, + ISS/Earth/Chamber shots 05/06/07),
  firelab-error-probe.mjs (zoom in/out + all five presets). Mobile
  script unchanged (no toggle references).
- VERIFIED: npm test 69/69 green (4 files, +1 limits-invariant
  test), npm run build green, desktop scene shots (7) + mobile +
  error-probe all ZERO errors. Every preset lands exactly on its
  framing (probe logs: inside [0.1,0.1,5.0], zoom-in 4.0, zoom-out
  5.0, iss [2.2,2.4,1.8], earth [1.2,0.2,4.6], chamber [2.3,0.9,3.4]).
  Screenshots re-read: interior shows the chamber front-and-centre
  with the flame big and clearly visible through the glass (Int-Ball
  floating right); exterior unchanged and clean (black space, bright
  stars, Earth, Moon, ISS + shuttle, Dragon, astronaut); panel shows
  the CAMERA section with zoom −/+ and five presets; no top-right
  toggle anywhere; no dashboard. Minor nits left as-is: the Earth
  preset clips the flame at the top edge (Earth is the subject there);
  the lid ring is partly cut at the top of the interior frame.

## Rack glovebox rebuild (2026-11-11 ~13:35 IST — Ronit: "inside real station do it. Remove that giant box bro")

The interior-first fix only moved the camera; the object was still the same
glass box. So the chamber is GONE — deleted from both views — and the fire
lab is now a rack-mounted glovebox INSIDE the real station.

- DELETED: the whole floating glass-box chamber (glass box, sheen, edges,
  lid frame + lid glass, rim, base cylinder) and the atmosphere ring around
  the lid. Nothing floats in space anymore.
- NEW — `gloveboxGroup` in `src/components/FireLab3D.jsx` (visible ONLY in
  the interior view): a dark-metal rack cabinet (3.6 x 3.2 x 1.6, panels not
  a solid box, front face at z = 0) set into the module wall, with the work
  volume recessed into its front face — window 2.3 x 1.6, glass ONLY on the
  front face (one plane, opacity 0.06) + slim metal frame, dark matte
  interior walls, sample pedestal at the bottom. Below the window: a control
  strip (three status dots + tiny screen + the atmosphere colour strip,
  which replaces the old lid ring) and TWO round glove ports (metal torus
  rings + dark recessed circles) — the signature of a real MSG glovebox.
  A vent/label strip tops the front face.
- The flame + sample + glow + light + burst + smoke all moved INTO the
  work volume (flame centre now (0, 0.1, -0.7), exported as FLAME_CENTER).
  Flame visuals are scaled x0.5 (FLAME_VIS_SCALE, applied at the
  updateCloud/glow/burst/smoke call sites; `flameParams` itself is
  untouched and still unit-tested) so the ball fits the volume at every
  slider setting — at max flow + max O2 the flame tip can still kiss the
  front glass, which reads as glow, not a bug (the glass is 94%
  transparent). Sprite sizes x0.7.
- NEW — atmosphere haze: 220 soft dots drifting in the cabin (interior
  only), calm blue at 21% O2 warming to amber at 34% (opacity 0.06–0.11,
  slow rotation + bob). Subtle by design — it never obscures the glovebox
  or the flame.
- EXTERIOR is now just the station: ISS + shuttle + Dragon + astronaut +
  Earth + Moon + LRO + stars. Wide target re-aimed at the ISS/Earth pair
  ([-1.5, -1.2, -3.5]) since the middle of the frame is empty space now.
- PRESETS reframed: Inside = glovebox front-and-centre down the module
  axis ([0.1, 0.1, 4.6] -> flame (0, 0.1, -0.7), dist 5.30); Chamber is
  now an INTERIOR preset too — a closer look at the glovebox front
  ([0.4, 0.35, 3.6] -> (0, 0.0, -0.7), dist 4.33). First Chamber framing
  ([0.5, 0.45, 2.0]) was too close — the camera was effectively inside
  the work volume, which read as "inside a dark box" — pulled back.
  Wide/ISS/Earth unchanged except Wide's target. Tests updated: Chamber is
  interior, Inside/Chamber targets assert against FLAME_CENTER (Chamber
  aims 0.1 below the flame so the whole glovebox front centres).
- Panel, CAMERA section, zoom, drag, hide/collapse, mobile bottom sheet,
  verdict logic (`src/lib/` untouched) all unchanged. Top-right toggle
  stays removed.
- Scripts: `firelab-scene-shots.mjs` (Inside settle [0.1,0.1,4.6],
  Chamber settle [0.4,0.35,3.6]; resets O2 to Exploration 34% before the
  Chamber shot so it shows the big orange flame) and
  `interior-probe.mjs` (EXPECT updated: inside 4.6, zoom-in 4.24,
  zoom-out 5.30, chamber [0.4,0.35,3.6]). NEW
  `scripts/mobile-interior-probe.mjs` — the mobile bottom sheet is
  collapsed by default, so the probe must EXPAND it to reach the Inside
  button, then COLLAPSE it again before shooting (expanded, the sheet
  covers the glovebox; collapsed is what the user sees).
- VERIFIED: npm test 69/69 green, npm run build green, desktop scene
  shots (7) + mobile default + mobile interior + error probe all ZERO
  errors. Every preset lands exactly (inside [0.1,0.1,4.6], chamber
  [0.4,0.35,3.6], iss [2.2,2.4,1.8], earth [1.2,0.2,4.6], wide
  [4.4,2.3,6.4]; mobile inside [0.12,0.1,5.39] = the 1.15x portrait
  pull-back, as predicted). Screenshots re-read: interior shows the rack
  glovebox front-and-centre with the flame big and clearly visible
  through the front glass, both glove ports + control strip + atmosphere
  strip visible, Int-Ball floating right, scan walls around it; exterior
  is clean station over Earth with no box anywhere; Chamber close-up
  shows the whole glovebox front; mobile interior (collapsed sheet) shows
  the glovebox filling the phone screen. Haze is faint in the shots —
  subtle as designed.
- Nits left as-is: the scan wall bulges slightly in front of the
  cabinet's right edge (reads as the unit set into the wall); the cabinet
  top edge sits near the top of the interior frame; at max flow + max O2
  the flame tip can touch the front glass.

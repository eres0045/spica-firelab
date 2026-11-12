/**
 * App — "The 34% Question" Fire Lab (MINIMAL IMMERSIVE REBUILD 2026-11-11).
 *
 * Ronit: "space with iss and interior and for fire control transparent
 * ui nothing else nothing dashboard". So this is the whole app now: a
 * full-screen 3D space scene (real Earth + Moon + ISS + astronaut outside;
 * the fire lab is a rack glovebox inside the real ISS interior scan) with
 * ONE transparent glass control panel floating over it. No header, no
 * verdict card, no missions, no evidence/scatter, no ranking, no model
 * viewer. The removed dashboard components live in
 * ../_archive-removed-ui-2026-11-11/ (recoverable, not imported).
 *
 * The panel holds ONLY: atmosphere preset chips, the three fire
 * sliders (O2 / pressure / flow), the cabin material picker, and ONE
 * compact live verdict line. Plus a tiny title chip, a CAMERA section
 * (zoom −/+ and the five view presets — the ONLY camera control; the old
 * top-right Exterior/Inside toggle is gone), and one credits line inside
 * the panel (CC-BY attribution is legally required).
 *
 * CORRECTION 2026-11-11 (Ronit: "sidebar so much", "transparent sidebar
 * so they enjoy our visuals"): the panel is TRULY transparent glass —
 * white ~0.07 background + backdrop-blur + 1px border, narrow (264px),
 * so the space scene shows THROUGH it; text stays readable via a soft
 * text-shadow (.glass-text). A hide (✕) button removes the panel
 * entirely so the full visual can be enjoyed, with a small "Show
 * controls" pill to bring it back.
 *
 * State: the lab conditions are O2 %, pressure psi, flow cm/s and the
 * material. Atmosphere presets set O2 + pressure to the real cabin
 * values; moving the O2 or pressure slider switches to "Custom cabin"
 * and the verdict is computed live from the PSI data (getLiveVerdict).
 * Flow only changes the flame shape — PSI verdicts are O2 x pressure.
 * All verdict math lives in lib/data.js and is untouched by this
 * rebuild; no number here is invented.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ATMOSPHERES, ATMOSPHERE_KEYS, HEADLINE_MATERIALS,
  buildBrief, buildEvidence, buildEvidenceLive, fmt, getScatterPoints,
  buildCoverage, buildCoverageLive, buildPlan, buildPlanLive,
  getVerdict, getLiveVerdict, materialClass,
  gapNumber, KIND_LABEL, KIND_COLOR, verdictLine,
  tryApi, tryApiVerdict, tryApiLiveVerdict, tryApiBrief,
  tryApiEvidence, tryApiEvidenceLive,
  tryApiCoverage, tryApiCoverageLive, tryApiPlan, tryApiPlanLive,
} from './lib/data.js';
import FireLab3D, { CAMERA_PRESETS } from './components/FireLab3D.jsx';
import Scatter2D from './components/Scatter2D.jsx';

/** One full PSI row, as the evidence pack returns it — accession, test
 *  ref, recorded O2 / pressure / flow / outcome, DOI as a link. Nothing
 *  here is summarised: the row is the evidence. */
function EvidenceRowCard({ row, title }) {
  if (!row) return null;
  const o2 = row.o2_pct_min != null || row.o2_pct_max != null
    ? `${fmt(row.o2_pct_min ?? row.o2_pct_max, 1)}–${fmt(row.o2_pct_max ?? row.o2_pct_min, 1)}% O\u2082${row.o2_approx ? ' (approx.)' : ''}`
    : 'not recorded';
  const p = row.pressure_psi_min != null || row.pressure_psi_max != null
    ? `${fmt(row.pressure_psi_min ?? row.pressure_psi_max, 2)}–${fmt(row.pressure_psi_max ?? row.pressure_psi_min, 2)} psi`
    : 'not recorded';
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.05] p-3 text-[13px] leading-snug">
      <p className="font-semibold text-slate-100">{title} — {row.accession} · {row.row_ref}</p>
      <p className="mt-0.5 text-slate-300">{row.investigation} · {row.material_raw || row.material_canonical} ({row.material_class})</p>
      <p className="mt-1 text-slate-300">O&#8322;: {o2} · Pressure: {p} · Flow: {row.flow_cm_s != null ? `${fmt(row.flow_cm_s, 1)} cm/s` : 'not recorded'}</p>
      <p className="text-slate-300">Outcome: {row.outcome || 'not recorded in PSI table'}{row.burn_time_s != null ? ` · Burn time: ${fmt(row.burn_time_s, 1)} s` : ''}</p>
      <p className="text-slate-400">Table: {row.table_file}</p>
      {row.doi ? (
        <p className="mt-1">DOI:{' '}
          <a href={`https://doi.org/${row.doi}`} target="_blank" rel="noreferrer"
            className="font-semibold text-sky-300 underline hover:text-sky-200">{row.doi}</a>
        </p>
      ) : (
        <p className="mt-1 text-slate-400">DOI: not recorded for this row</p>
      )}
      {row.notes ? <p className="mt-1 text-slate-400">{row.notes}</p> : null}
    </div>
  );
}

/** Nearest preset atmosphere by O2 — the glovebox atmosphere strip
 *  follows it when the sliders are on a custom cabin. */
function nearestPreset(o2) {
  let best = 'ISS';
  let bestD = Infinity;
  for (const key of ATMOSPHERE_KEYS) {
    const d = Math.abs(ATMOSPHERES[key].o2 - o2);
    if (d < bestD) { bestD = d; best = key; }
  }
  return best;
}

/** The ONE verdict readout line: "SIBAL fabric · Exploration 34% →
 *  GAP 11.9 O₂ pts". Built only from the verdict record — same values
 *  the old verdict card showed, minus the DOI, photo and prose. */
function verdictLineShort(verdict, materialLabel, conditionShort) {
  const kind = KIND_LABEL[verdict.kind];
  if (verdict.kind === 'GAP_O2' || verdict.kind === 'GAP_PRESSURE') {
    const gap = gapNumber(verdict);
    // O2 gaps read "11.9 O₂ pts" (1 decimal, as ever); pressure gaps
    // keep 2 decimals ("1.98 psi") — never round away real precision.
    const digits = gap.axis === 'o2' ? 1 : 2;
    return `${materialLabel} · ${conditionShort} → GAP ${fmt(gap.value, digits)} ${gap.unit}`;
  }
  if (verdict.kind === 'PARTIAL') {
    return `${materialLabel} · ${conditionShort} → PARTIAL · O₂ covered`;
  }
  return `${materialLabel} · ${conditionShort} → ${kind}`;
}

export default function App() {
  const [atmosphere, setAtmosphere] = useState('ISS');
  const [o2, setO2] = useState(21);
  const [pressure, setPressure] = useState(14.7);
  const [flow, setFlow] = useState(0);
  const [material, setMaterial] = useState('SIBAL fabric');
  const [sceneView, setSceneView] = useState('exterior'); // 'exterior' | 'interior'
  // Walk mode (first-person inside the station — Ronit 2026-11-12:
  // "make me move when I am inside iss station chamber? 360"). Drag
  // on the scene = look, WASD/arrows + the hold-to-move D-pad = walk
  // the aisle. Any camera preset exits it. The button is in every
  // view (tapping it flies to Inside); the drag-look itself is the
  // interior default with or without Walk.
  const [walkMode, setWalkMode] = useState(false);
  // Hold-to-move flags — a mutable ref (not state) so pointer-hold
  // updates never re-render; FireLab3D reads it every frame.
  const walkMoveRef = useRef({ forward: 0, back: 0, left: 0, right: 0 });
  // Camera commands for the scene (zoom + presets) — a sequence number so
  // FireLab3D applies each click exactly once. The panel's CAMERA section
  // is the ONLY camera control (Ronit 2026-11-11: zoom in/out + all view
  // types in the sidebar as well).
  const [camCmd, setCamCmd] = useState({ seq: 0, kind: null });
  // Last chosen preset framing ('wide' on load). Zoom clears it — the
  // framing is no longer a preset once the user dollies.
  const [activePreset, setActivePreset] = useState('wide');
  const sendCamCmd = (kind, preset) => setCamCmd((c) => ({ seq: c.seq + 1, kind, preset }));
  const applyCameraPreset = (name) => {
    const preset = CAMERA_PRESETS[name];
    if (!preset) return;
    setWalkMode(false); // any preset exits walk mode
    setActivePreset(name);
    if (preset.view !== sceneView) setSceneView(preset.view);
    sendCamCmd('preset', name);
  };
  const toggleWalk = () => {
    if (!walkMode) {
      // Walk starts at the Inside framing. From the exterior, switch
      // the view and fly there with a preset command; from the interior
      // the scene's startWalk flies there if needed. Do NOT use
      // applyCameraPreset here — it clears walkMode, which would cancel
      // the walk before it starts. (2026-11-12: toggleWalk used to
      // only set the pill state, so tapping Walk from the exterior did
      // nothing at all — no view switch, no flight, no D-pad.)
      setActivePreset('inside');
      if (sceneView !== 'interior') {
        setSceneView('interior');
        sendCamCmd('preset', 'inside');
      }
    }
    setWalkMode(!walkMode);
  };
  // Hold-to-move: pointerdown sets the flag, any release clears it.
  // touch-none so a hold never scrolls the page; pointer capture so
  // releasing off the button still clears it.
  const holdMoveProps = (dir) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
      walkMoveRef.current[dir] = 1;
    },
    onPointerUp: () => { walkMoveRef.current[dir] = 0; },
    onPointerCancel: () => { walkMoveRef.current[dir] = 0; },
    onLostPointerCapture: () => { walkMoveRef.current[dir] = 0; },
    onContextMenu: (e) => e.preventDefault(),
  });
  const onZoom = (dir) => {
    setActivePreset(null);
    sendCamCmd(dir === 'in' ? 'zoom-in' : 'zoom-out');
  };
  // Panel starts open on desktop, collapsed on small screens so the
  // scene (not the panel) is what you see first on a phone.
  const [panelOpen, setPanelOpen] = useState(
    () => (typeof window === 'undefined' ? true : window.innerWidth >= 1024),
  );
  // Hide removes the panel entirely (Ronit: enjoy the full visual); the
  // restore pill brings it back. Collapse only shrinks it to header +
  // verdict line.
  const [panelHidden, setPanelHidden] = useState(false);

  // ---- Live verdict engine (Flask API, Nov 2026) --------------------
  // apiBase: undefined = still probing, null = no backend reachable,
  // string = working base ('' = same origin, i.e. the Netlify deploy).
  // Verdicts come from the API when it answers and fall back to the
  // bundled PSI data otherwise — the static deploys keep working with
  // no server up. The API verdict object has exactly the bundled
  // shape, so the readout line renders identically either way.
  const [apiBase, setApiBase] = useState(undefined);
  const [apiVerdict, setApiVerdict] = useState(null); // {key, verdict}
  const apiVerdictAbort = useRef(null);
  useEffect(() => {
    let dead = false;
    tryApi().then((r) => { if (!dead) setApiBase(r ? r.base : null); });
    return () => { dead = true; };
  }, []);
  const apiLive = apiBase !== undefined && apiBase !== null;
  const verdictKey = `${material}|${atmosphere}|${o2}|${pressure}`;
  useEffect(() => {
    if (!apiLive) return undefined;
    const t = setTimeout(() => {
      if (apiVerdictAbort.current) apiVerdictAbort.current.abort();
      const ctrl = new AbortController();
      apiVerdictAbort.current = ctrl;
      const p = atmosphere === 'custom'
        ? tryApiLiveVerdict(material, o2, pressure, apiBase)
        : tryApiVerdict(material, atmosphere, apiBase);
      p.then((v) => {
        if (ctrl.signal.aborted) return;
        setApiVerdict(v ? { key: verdictKey, verdict: v } : null);
      });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLive, apiBase, verdictKey]);

  // ---- Mission brief --------------------------------------------------
  // One printable brief per atmosphere: materials ranked by coverage
  // with gap numbers and full citations. Data comes from /api/brief
  // when the API is live, else buildBrief() from the bundled data —
  // same numbers either way.
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState(null);
  const briefAtmosphere = atmosphere === 'custom' ? nearestPreset(o2) : atmosphere;
  const openBrief = async () => {
    setBriefOpen(true);
    setBrief(null);
    let b = null;
    if (apiLive) b = await tryApiBrief(briefAtmosphere, apiBase);
    setBrief(b || buildBrief(briefAtmosphere));
  };

  // ---- Evidence ---------------------------------------------------------
  // The scatter + the exact PSI rows behind the current verdict, with
  // DOIs. Data comes from /api/evidence when the API is live, else
  // buildEvidence() from the bundled data — same numbers either way.
  // For a custom cabin the live (slider) conditions are used, exactly
  // like the verdict line above.
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidence, setEvidence] = useState(null);
  // Coverage pack for the same material — the tested ranges, test
  // counts and the confidence score for this verdict. Same source as
  // the evidence (API when live, else the bundled builders).
  const [coverage, setCoverage] = useState(null);
  const openEvidence = async () => {
    setEvidenceOpen(true);
    setEvidence(null);
    setCoverage(null);
    let e = null;
    let c = null;
    if (apiLive) {
      if (atmosphere === 'custom') {
        e = await tryApiEvidenceLive(material, o2, pressure, apiBase);
        c = await tryApiCoverageLive(material, o2, pressure, apiBase);
      } else {
        e = await tryApiEvidence(material, atmosphere, apiBase);
        c = await tryApiCoverage(material, atmosphere, apiBase);
      }
    }
    setEvidence(e || (atmosphere === 'custom'
      ? buildEvidenceLive(material, o2, pressure)
      : buildEvidence(material, atmosphere)));
    setCoverage(c || (atmosphere === 'custom'
      ? buildCoverageLive(material, o2, pressure)
      : buildCoverage(material, atmosphere)));
  };

  // ---- Mission planner --------------------------------------------------
  // Pick materials, get the verdict for each at the current atmosphere
  // plus the one-line plan. Same source as the brief (API when live,
  // else the bundled builders). The planner always uses the atmosphere
  // the panel is currently on — preset or the slider (custom) cabin.
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planMaterials, setPlanMaterials] = useState(
    () => HEADLINE_MATERIALS.map((m) => m.key));
  const openPlan = async () => {
    setPlanOpen(true);
    setPlan(null);
    const chosen = planMaterials.length ? planMaterials : HEADLINE_MATERIALS.map((m) => m.key);
    let p = null;
    if (apiLive) {
      p = atmosphere === 'custom'
        ? await tryApiPlanLive(chosen, o2, pressure, apiBase)
        : await tryApiPlan(chosen, atmosphere, apiBase);
    }
    setPlan(p || (atmosphere === 'custom'
      ? buildPlanLive(chosen, o2, pressure)
      : buildPlan(chosen, atmosphere)));
  };
  const togglePlanMaterial = (key) => {
    setPlanMaterials((prev) => (prev.includes(key)
      ? prev.filter((k) => k !== key)
      : [...prev, key]));
  };
  // The 997 plotted points never change — compute once.
  const scatterPoints = useMemo(() => getScatterPoints('all'), []);

  // Preset conditions use the pre-computed verdicts (exact citations);
  // custom slider conditions use the live computation from the same data.
  const localVerdict = useMemo(
    () => (atmosphere === 'custom'
      ? getLiveVerdict(material, o2, pressure)
      : getVerdict(material, atmosphere)),
    [material, atmosphere, o2, pressure],
  );
  const verdict = apiVerdict && apiVerdict.key === verdictKey
    ? apiVerdict.verdict : localVerdict;
  const scatterAtmosphere = atmosphere === 'custom' ? nearestPreset(o2) : atmosphere;
  const atm = atmosphere === 'custom' ? null : ATMOSPHERES[atmosphere];
  const conditionShort = atmosphere === 'custom'
    ? `Custom ${fmt(o2, 1)}% @ ${fmt(pressure, 1)} psi`
    : `${atm.name} ${atm.o2}%`;
  const materialLabel = HEADLINE_MATERIALS.find((m) => m.key === material)?.label || material;
  const verdictText = verdictLineShort(verdict, materialLabel, conditionShort);
  const verdictColor = KIND_COLOR[verdict.kind];

  const applyPreset = (key) => {
    const a = ATMOSPHERES[key];
    setAtmosphere(key);
    setO2(a.o2);
    setPressure(a.pressure);
  };
  const onO2 = (v) => { setO2(v); setAtmosphere('custom'); };
  const onPressure = (v) => { setPressure(v); setAtmosphere('custom'); };

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-slate-100">
      {/* Full-screen scene — the whole app is the 3D view. */}
      <div className="absolute inset-0">
        <FireLab3D
          o2={o2} pressure={pressure} flow={flow}
          material={material} materialClass={materialClass(material)}
          atmosphereKey={scatterAtmosphere}
          sceneView={sceneView}
          cameraCmd={camCmd}
          walkMode={walkMode}
          walkMoveRef={walkMoveRef}
        />
      </div>

      {/* Tiny title chip — one line, no subtitle. Top-centre (the old
          top-right toggle is gone, so nothing crowds it anymore). */}
      <div className="glass-text pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-xs font-bold tracking-wide text-slate-100 backdrop-blur-md">
        The 34% Question
      </div>

      {/* THE panel — the only control UI. TRULY transparent glass
          (white 0.07 + blur + 1px border, 264px wide) so the space scene
          shows through it. Desktop: floating glass card on the left.
          Mobile: bottom sheet, collapsed by default. Hidden entirely via
          the ✕ button — the restore pill below brings it back. */}
      {panelHidden ? (
        <button type="button" onClick={() => setPanelHidden(false)}
          aria-label="Show fire controls"
          className="glass-text absolute bottom-3 left-3 z-20 rounded-full border border-white/20 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-100 backdrop-blur-md">
          🔥 Show controls
        </button>
      ) : (
      <div className="glass-text absolute inset-x-0 bottom-0 z-20 max-h-[40vh] overflow-y-auto rounded-t-2xl border-t border-white/20 bg-white/[0.07] shadow-2xl backdrop-blur-md lg:inset-x-auto lg:bottom-4 lg:left-4 lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto lg:w-[264px] lg:rounded-2xl lg:border">
        <div className="p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">🔥 Fire control</h2>
            <span className="flex gap-1">
              <button type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                aria-label={panelOpen ? 'Collapse fire controls' : 'Expand fire controls'}
                className="rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-slate-200 backdrop-blur-md">
                {panelOpen ? '▾' : '▸'}
              </button>
              <button type="button"
                onClick={() => setPanelHidden(true)}
                aria-label="Hide fire control panel"
                title="Hide panel — enjoy the full visual"
                className="rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-slate-200 backdrop-blur-md">
                ✕
              </button>
            </span>
          </div>

          {/* Live verdict line — always visible, even when collapsed: it
              is the lab's output, not a dashboard panel. */}
          <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.08] px-2 py-1.5 text-[13px] font-semibold leading-snug" aria-live="polite">
            {verdictText.split('→')[0]}→{' '}
            <span style={{ color: verdictColor }}>{verdictText.split('→')[1]?.trim()}</span>
          </p>
          {/* Verdict source — tiny, honest: live API when it answers,
              bundled PSI data when it doesn't. Never hidden. */}
          {apiBase !== undefined && (
            <p className="mt-1 text-[10px] leading-none text-slate-500">
              {apiLive ? '● live API — verdict computed from NASA PSI data' : '● on-device data — API unreachable, bundled PSI data'}
            </p>
          )}

          {panelOpen && (
            <>
              {/* CAMERA — zoom in/out + all view presets. The ONLY camera
                  control (Ronit 2026-11-11: "zoom out and zoom in and all
                  types in that sidebar as well"). Zoom dollies along the
                  view direction, clamped so you can't clip the glovebox or
                  fly off; presets fly to a framing. Compact, same glass. */}
              <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Camera</h3>
              <div className="mt-1.5 flex items-center gap-1.5" role="group" aria-label="Camera zoom">
                <button type="button" onClick={() => onZoom('out')} aria-label="Zoom out" disabled={walkMode}
                  className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-sm font-bold text-slate-200 hover:border-white/30 disabled:opacity-40">−</button>
                <button type="button" onClick={() => onZoom('in')} aria-label="Zoom in" disabled={walkMode}
                  className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-sm font-bold text-slate-200 hover:border-white/30 disabled:opacity-40">+</button>
                <span className="text-[11px] text-slate-400">Zoom — drag to look around</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Camera views">
                {Object.entries(CAMERA_PRESETS).map(([name, preset]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyCameraPreset(name)}
                    aria-pressed={activePreset === name}
                    aria-label={`Camera view: ${preset.label}`}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      activePreset === name ? 'border-sky-300/60 bg-sky-400/80 text-slate-950' : 'border-white/15 bg-white/[0.05] text-slate-200 hover:border-white/30'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {/* Walk mode — one tap from anywhere (Ronit 2026-11-12:
                  the button used to hide until Inside, so he could
                  never find it; and tapping it from the exterior did
                  nothing). Tapping it flies to Inside and starts
                  walking. Drag looks around 360° in the interior with
                  or without Walk; Walk adds movement (WASD/arrows or
                  the hold-to-move arrows). Any preset above exits it. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Walk mode">
                <button
                  type="button"
                  onClick={toggleWalk}
                  aria-pressed={walkMode}
                  aria-label="Walk inside the station"
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    walkMode ? 'border-sky-300/60 bg-sky-400/80 text-slate-950' : 'border-white/15 bg-white/[0.05] text-slate-200 hover:border-white/30'
                  }`}
                >
                  🚶 Walk
                </button>
                {walkMode && (
                  <span className="text-[11px] leading-tight text-slate-400">
                    Walking — drag the scene to look around, hold the arrows to move. Tap a view to exit.
                  </span>
                )}
                {!walkMode && sceneView === 'interior' && (
                  <span className="text-[11px] leading-tight text-slate-400">
                    Drag the scene to look around 360°.
                  </span>
                )}
              </div>

              {/* Atmosphere presets — three small chips; they just set the sliders. */}
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Cabin atmosphere">
                {ATMOSPHERE_KEYS.map((key) => {
                  const a = ATMOSPHERES[key];
                  const active = key === atmosphere;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      aria-pressed={active}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                        active ? 'border-transparent text-slate-950' : 'border-white/15 bg-white/[0.05] text-slate-200 hover:border-white/30'
                      }`}
                      style={active ? { backgroundColor: a.color } : undefined}
                    >
                      {a.name} · {a.o2}% O&#8322;
                    </button>
                  );
                })}
              </div>
              {atmosphere === 'custom' && (
                <p className="mt-1.5 text-xs text-amber-200/90">
                  Custom cabin · {fmt(o2, 1)}% O&#8322; @ {fmt(pressure, 1)} psi · set by the sliders
                </p>
              )}

              {/* Sliders — tight spacing so the whole panel (credits
                  included) fits a 900px viewport without scrolling. */}
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="o2-slider" className="text-sm font-semibold text-slate-200">Oxygen O&#8322;</label>
                    <span className="text-sm font-bold tabular-nums text-slate-100">{fmt(o2, 1)}%</span>
                  </div>
                  <input id="o2-slider" type="range" min="10" max="40" step="0.5" value={o2}
                    onChange={(e) => onO2(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-amber-400" aria-label="Oxygen percent" />
                  <div className="flex justify-between text-[11px] text-slate-500"><span>10% — flame dies</span><span>40%</span></div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="pressure-slider" className="text-sm font-semibold text-slate-200">Pressure</label>
                    <span className="text-sm font-bold tabular-nums text-slate-100">{fmt(pressure, 1)} psi</span>
                  </div>
                  <input id="pressure-slider" type="range" min="6" max="15" step="0.1" value={pressure}
                    onChange={(e) => onPressure(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-amber-400" aria-label="Pressure psi" />
                  <div className="flex justify-between text-[11px] text-slate-500"><span>6 psi</span><span>15 psi</span></div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="flow-slider" className="text-sm font-semibold text-slate-200">Flow</label>
                    <span className="text-sm font-bold tabular-nums text-slate-100">{fmt(flow, 1)} cm/s</span>
                  </div>
                  <input id="flow-slider" type="range" min="0" max="30" step="0.5" value={flow}
                    onChange={(e) => setFlow(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-amber-400" aria-label="Flow cm per second" />
                  <div className="flex justify-between text-[11px] text-slate-500"><span>0 — perfect sphere</span><span>30 — stretched</span></div>
                </div>
              </div>

              {/* Material picker */}
              <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Cabin material</h3>
              <div className="mt-2 space-y-1.5">
                {HEADLINE_MATERIALS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMaterial(m.key)}
                    aria-pressed={material === m.key}
                    className={`block w-full rounded-lg border px-3 py-1 text-left text-sm font-semibold ${
                      material === m.key ? 'border-amber-400 bg-white/[0.16] text-amber-200' : 'border-white/10 bg-white/[0.05] text-slate-200 hover:border-white/30'
                    }`}
                  >
                    {m.label}
                    <span className="block text-xs font-normal text-slate-400">{m.className} · {m.key === 'Methanol' || m.key === 'Heptane' ? 'FLEX (PSI-69)' : 'BASS-II / SAFFIRE (PSI-25/98/99)'}</span>
                  </button>
                ))}
              </div>

              {/* Mission brief — printable ranking + citations for this
                  atmosphere. Data from /api/brief when live, else the
                  bundled data (same numbers either way). */}
              <button
                type="button"
                onClick={openBrief}
                aria-label="Open mission brief"
                className="mt-3 block w-full rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-sm font-semibold text-amber-200 hover:border-amber-300"
              >
                📋 Mission brief — {ATMOSPHERES[briefAtmosphere].name} {ATMOSPHERES[briefAtmosphere].o2}% O&#8322;
                <span className="block text-xs font-normal text-slate-400">Ranked materials, gaps &amp; citations — printable</span>
              </button>

              {/* Evidence — the scatter + the exact PSI rows behind the
                  current verdict, with DOIs. Data from /api/evidence
                  when live, else the bundled data (same numbers). */}
              <button
                type="button"
                onClick={openEvidence}
                aria-label="Open evidence"
                className="mt-2 block w-full rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-left text-sm font-semibold text-sky-200 hover:border-sky-300"
              >
                🔬 Evidence
                <span className="block text-xs font-normal text-slate-400">Scatter, nearest real tests &amp; citations</span>
              </button>

              {/* Mission planner — verdicts for a chosen material list at
                  the current atmosphere, with the one-line plan. Data
                  from /api/plan when live, else the bundled data. */}
              <button
                type="button"
                onClick={openPlan}
                aria-label="Open mission planner"
                className="mt-2 block w-full rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-left text-sm font-semibold text-emerald-200 hover:border-emerald-300"
              >
                🗺️ Mission planner — {conditionShort}
                <span className="block text-xs font-normal text-slate-400">Pick materials, get the verdict for each</span>
              </button>

              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Flame is illustrative — verdicts come from real NASA PSI test data.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Models: uperesito (ISS, CC-BY) · Space Explorers Academy (ISS interior, CC BY-NC-SA 4.0) · LasquetiSpice (astronaut, CC-BY) · dannzjs (Dragon, CC-BY) · pergamond (Int-Ball, CC-BY) · Sun texture: Solar System Scope, CC BY 4.0 · Data: NASA PSI
              </p>
            </>
          )}
        </div>
      </div>
      )}

      {/* Walk D-pad — on-screen hold-to-move buttons, only while walking
          inside. Floating top-right (clear of the bottom sheet on phones
          and of the left sidebar on desktop), big enough to tap-hold.
          One finger drags on the scene itself to look around. */}
      {walkMode && sceneView === 'interior' && (
        <div className="absolute right-3 top-16 z-20 select-none" role="group" aria-label="Walk movement">
          <div className="grid w-[168px] grid-cols-3 gap-1.5">
            <span aria-hidden="true" />
            <button type="button" aria-label="Move forward" {...holdMoveProps('forward')}
              className="touch-none rounded-xl border border-white/20 bg-white/[0.08] py-3 text-base font-bold text-slate-100 backdrop-blur-md active:border-sky-300/60 active:bg-sky-400/60">▲</button>
            <span aria-hidden="true" />
            <button type="button" aria-label="Move left" {...holdMoveProps('left')}
              className="touch-none rounded-xl border border-white/20 bg-white/[0.08] py-3 text-base font-bold text-slate-100 backdrop-blur-md active:border-sky-300/60 active:bg-sky-400/60">◀</button>
            <button type="button" aria-label="Move back" {...holdMoveProps('back')}
              className="touch-none rounded-xl border border-white/20 bg-white/[0.08] py-3 text-base font-bold text-slate-100 backdrop-blur-md active:border-sky-300/60 active:bg-sky-400/60">▼</button>
            <button type="button" aria-label="Move right" {...holdMoveProps('right')}
              className="touch-none rounded-xl border border-white/20 bg-white/[0.08] py-3 text-base font-bold text-slate-100 backdrop-blur-md active:border-sky-300/60 active:bg-sky-400/60">▶</button>
          </div>
          <p className="mt-1.5 w-[168px] text-center text-[10px] leading-tight text-slate-400">
            Hold to walk · drag scene to look
          </p>
        </div>
      )}

      {/* Mission brief modal — printable. Print CSS (index.css) hides
          the 3D scene and panel and shows only this card. */}
      {briefOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Mission brief">
          <div className="brief-print max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md">
            {brief ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-100">
                    Mission brief — {ATMOSPHERES[brief.atmosphere].name} {brief.conditions.o2_pct}% O&#8322; @ {brief.conditions.pressure_psi} psi
                  </h2>
                  <button type="button" onClick={() => setBriefOpen(false)} aria-label="Close mission brief"
                    className="no-print shrink-0 rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-slate-200">✕</button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {brief.conditions.blurb}
                  {atmosphere === 'custom' ? ` · Custom cabin — brief for the nearest preset, ${ATMOSPHERES[briefAtmosphere].name}.` : ''}
                </p>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Cabin materials — ranked by gap</h3>
                <table className="mt-1 w-full text-left text-[13px] leading-snug">
                  <thead>
                    <tr className="text-slate-500"><th className="py-1 pr-2">Material</th><th className="py-1 pr-2">Verdict</th><th className="py-1 pr-2">Gap</th><th className="py-1">Nearest real test</th></tr>
                  </thead>
                  <tbody>
                    {brief.cabin.map((e) => (
                      <tr key={e.material} className="border-t border-white/10">
                        <td className="py-1 pr-2 font-semibold text-slate-100">{e.label}</td>
                        <td className="py-1 pr-2" style={{ color: KIND_COLOR[e.kind] }}>{KIND_LABEL[e.kind]}</td>
                        <td className="py-1 pr-2 tabular-nums text-slate-200">{e.gap ? `${fmt(e.gap, e.gapUnit === 'psi' ? 2 : 1)} ${e.gapUnit}` : '—'}</td>
                        <td className="py-1 text-slate-300">
                          {e.gapAxis === 'pressure' ? e.nearest_pressure_test : e.nearest_o2_test}
                          {(e.gapAxis === 'pressure' ? e.nearest_pressure_doi : e.nearest_o2_doi) ? ` · DOI ${(e.gapAxis === 'pressure' ? e.nearest_pressure_doi : e.nearest_o2_doi)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Gases — separate group</h3>
                <table className="mt-1 w-full text-left text-[13px] leading-snug">
                  <tbody>
                    {brief.gases.map((e) => (
                      <tr key={e.material} className="border-t border-white/10">
                        <td className="py-1 pr-2 font-semibold text-slate-100">{e.label}</td>
                        <td className="py-1 pr-2" style={{ color: KIND_COLOR[e.kind] }}>{KIND_LABEL[e.kind]}</td>
                        <td className="py-1 pr-2 tabular-nums text-slate-200">{e.gap ? `${fmt(e.gap, e.gapUnit === 'psi' ? 2 : 1)} ${e.gapUnit}` : '—'}</td>
                        <td className="py-1 text-slate-300">
                          {e.gapAxis === 'pressure' ? e.nearest_pressure_test : e.nearest_o2_test}
                          {(e.gapAxis === 'pressure' ? e.nearest_pressure_doi : e.nearest_o2_doi) ? ` · DOI ${(e.gapAxis === 'pressure' ? e.nearest_pressure_doi : e.nearest_o2_doi)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Citations — the tests behind these numbers</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-300">
                  {brief.citations.map((c) => (
                    <li key={c.accession}>{c.accession} · {c.title}{c.doi ? ` · DOI ${c.doi}` : ''}</li>
                  ))}
                </ul>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Reports &amp; data</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-300">
                  {brief.reports.map((r) => (
                    <li key={r.ref}>{r.ref} — {r.note}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{brief.disclaimer}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Data: NASA PSI, {brief.snapshot.rows} rows, {brief.snapshot.investigations} investigations, cleaned {brief.snapshot.cleaned_at}.
                  {apiLive ? ' Served live by the verdict-engine API.' : ' Served from the bundled PSI data (API unreachable).'}
                </p>
                <div className="no-print mt-3 flex gap-2">
                  <button type="button" onClick={() => window.print()} aria-label="Print mission brief"
                    className="rounded-lg border border-amber-400/40 bg-amber-400/20 px-3 py-1.5 text-sm font-semibold text-amber-200">🖨 Print brief</button>
                  <button type="button" onClick={() => setBriefOpen(false)}
                    className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm font-semibold text-slate-200">Close</button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-300">Loading brief…</p>
            )}
          </div>
        </div>
      )}

      {/* Evidence modal — the scatter + the exact PSI rows behind the
          current verdict, with DOIs. Same glass shell as the brief modal
          (max-h 85vh, scrollable on portrait phones). */}
      {evidenceOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Evidence">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md">
            {evidence ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-100">
                    Evidence — {materialLabel} · {ATMOSPHERES[briefAtmosphere].name} {ATMOSPHERES[briefAtmosphere].o2}% O&#8322; @ {ATMOSPHERES[briefAtmosphere].pressure} psi
                  </h2>
                  <button type="button" onClick={() => setEvidenceOpen(false)} aria-label="Close evidence"
                    className="shrink-0 rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-slate-200">✕</button>
                </div>
                <p className="mt-1 text-[13px] font-semibold leading-snug" style={{ color: KIND_COLOR[evidence.verdict.kind] }}>
                  {verdictLineShort(evidence.verdict, materialLabel, conditionShort)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{evidence.line}</p>

                {coverage && (() => {
                  const entry = coverage.atmospheres[atmosphere === 'custom' ? 'custom' : atmosphere];
                  return entry ? (
                    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.05] p-3 text-[13px] leading-snug">
                      <p className="font-semibold text-slate-100">Coverage — {coverage.label}</p>
                      <p className="mt-0.5 text-slate-300">
                        O&#8322; tested {coverage.o2 ? `${fmt(coverage.o2.min, 1)}–${fmt(coverage.o2.max, 1)}% across ${coverage.o2.n_levels} levels (${coverage.o2.n_rows} rows)` : 'never tested'} ·{' '}
                        {coverage.pressure.recorded
                          ? `pressure ${fmt(coverage.pressure.min, 2)}–${fmt(coverage.pressure.max, 2)} psi (${coverage.pressure.n_rows} rows)`
                          : 'pressure never recorded'} · {coverage.rows_total} PSI rows for this material.
                      </p>
                      <p className="mt-0.5 text-slate-300">
                        Confidence {entry.confidence == null ? '—' : entry.confidence.toFixed(2)} — {entry.confidence_note}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{coverage.confidence_method}</p>
                    </div>
                  ) : null;
                })()}

                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Test cloud — O&#8322; vs pressure</h3>
                <Scatter2D points={scatterPoints} selectedMaterial={material} atmosphere={scatterAtmosphere} verdict={evidence.verdict} />

                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">The rows behind this verdict</h3>
                <EvidenceRowCard row={evidence.nearest_o2_row} title="Nearest O&#8322; test" />
                {evidence.nearest_pressure_row ? (
                  <EvidenceRowCard row={evidence.nearest_pressure_row} title="Nearest pressure test" />
                ) : (
                  <p className="mt-2 text-[13px] text-slate-400">No pressure row recorded in PSI for this material — the verdict is O&#8322;-only, and no pressure is assumed.</p>
                )}

                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Citations — the investigations behind these numbers</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-300">
                  {evidence.citations.map((c) => (
                    <li key={c.accession}>{c.accession} · {c.title}{c.doi ? (<> · DOI <a href={c.url} target="_blank" rel="noreferrer" className="font-semibold text-sky-300 underline hover:text-sky-200">{c.doi}</a></>) : ''}</li>
                  ))}
                </ul>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Reports &amp; data</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-300">
                  {evidence.reports.map((r) => (
                    <li key={r.ref}>{r.ref} — {r.note}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{evidence.disclaimer}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Data: NASA PSI, {evidence.snapshot.rows} rows, {evidence.snapshot.investigations} investigations, cleaned {evidence.snapshot.cleaned_at}.
                  {apiLive ? ' Served live by the verdict-engine API.' : ' Served from the bundled PSI data (API unreachable).'}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setEvidenceOpen(false)}
                    className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm font-semibold text-slate-200">Close</button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-300">Loading evidence…</p>
            )}
          </div>
        </div>
      )}

      {/* Mission planner modal — pick materials, get each verdict at the
          current atmosphere plus the one-line plan. Same glass shell as
          the brief modal (max-h 85vh, scrollable on portrait phones). */}
      {planOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Mission planner">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/20 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-bold text-slate-100">
                Mission planner — {conditionShort}
              </h2>
              <button type="button" onClick={() => setPlanOpen(false)} aria-label="Close planner"
                className="shrink-0 rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-slate-200">✕</button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Pick the materials this mission carries. The verdict for each comes from the nearest real PSI test at {conditionShort} — nothing is assumed covered.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {HEADLINE_MATERIALS.map((m) => (
                <label key={m.key} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1.5 text-sm text-slate-200">
                  <input type="checkbox" checked={planMaterials.includes(m.key)}
                    onChange={() => togglePlanMaterial(m.key)} aria-label={`Plan ${m.label}`} />
                  {m.label}
                </label>
              ))}
            </div>
            <button type="button" onClick={openPlan} disabled={planMaterials.length === 0}
              className="mt-3 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:border-emerald-300 disabled:opacity-40"
            >
              Build plan
            </button>
            {plan ? (
              <>
                <p className="mt-3 text-sm font-semibold leading-snug text-slate-100">{plan.plan_line}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {plan.summary.tested} tested · {plan.summary.gap} gap{plan.summary.gap === 1 ? '' : 's'} · {plan.summary.partial} partial · {plan.summary.no_data} without PSI data
                </p>
                <ul className="mt-3 space-y-2">
                  {plan.materials.map((e) => (
                    <li key={e.material} className="rounded-lg border border-white/10 bg-white/[0.05] p-3 text-[13px] leading-snug">
                      <p className="font-semibold" style={{ color: KIND_COLOR[e.kind] }}>{e.label} — {e.overall}</p>
                      <p className="mt-0.5 text-slate-300">{e.line}</p>
                      <p className="mt-0.5 text-slate-400">
                        Confidence {e.confidence == null ? '—' : e.confidence.toFixed(2)} — {e.confidence_note}
                        {e.nearest_o2_doi ? (<> · nearest test <a href={`https://doi.org/${e.nearest_o2_doi}`} target="_blank" rel="noreferrer" className="font-semibold text-sky-300 underline hover:text-sky-200">{e.nearest_o2_doi}</a></>) : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Citations — the investigations behind these numbers</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-300">
                  {plan.citations.map((c) => (
                    <li key={c.accession}>{c.accession} · {c.title}{c.doi ? (<> · DOI <a href={c.url} target="_blank" rel="noreferrer" className="font-semibold text-sky-300 underline hover:text-sky-200">{c.doi}</a></>) : ''}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{plan.disclaimer}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Data: NASA PSI, {plan.snapshot.rows} rows, {plan.snapshot.investigations} investigations, cleaned {plan.snapshot.cleaned_at}.
                  {apiLive ? ' Served live by the verdict-engine API.' : ' Served from the bundled PSI data (API unreachable).'}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-300">Building plan…</p>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setPlanOpen(false)}
                className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-sm font-semibold text-slate-200">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

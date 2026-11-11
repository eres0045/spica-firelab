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
import { useMemo, useState } from 'react';
import {
  ATMOSPHERES, ATMOSPHERE_KEYS, HEADLINE_MATERIALS,
  fmt, getVerdict, getLiveVerdict, materialClass,
  gapNumber, KIND_LABEL, KIND_COLOR,
} from './lib/data.js';
import FireLab3D, { CAMERA_PRESETS } from './components/FireLab3D.jsx';

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
    setActivePreset(name);
    if (preset.view !== sceneView) setSceneView(preset.view);
    sendCamCmd('preset', name);
  };
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

  // Preset conditions use the pre-computed verdicts (exact citations);
  // custom slider conditions use the live computation from the same data.
  const verdict = useMemo(
    () => (atmosphere === 'custom'
      ? getLiveVerdict(material, o2, pressure)
      : getVerdict(material, atmosphere)),
    [material, atmosphere, o2, pressure],
  );
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
      <div className="glass-text absolute inset-x-0 bottom-0 z-20 max-h-[56vh] overflow-y-auto rounded-t-2xl border-t border-white/20 bg-white/[0.07] shadow-2xl backdrop-blur-md lg:inset-x-auto lg:bottom-4 lg:left-4 lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto lg:w-[264px] lg:rounded-2xl lg:border">
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

          {panelOpen && (
            <>
              {/* CAMERA — zoom in/out + all view presets. The ONLY camera
                  control (Ronit 2026-11-11: "zoom out and zoom in and all
                  types in that sidebar as well"). Zoom dollies along the
                  view direction, clamped so you can't clip the glovebox or
                  fly off; presets fly to a framing. Compact, same glass. */}
              <h3 className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Camera</h3>
              <div className="mt-1.5 flex items-center gap-1.5" role="group" aria-label="Camera zoom">
                <button type="button" onClick={() => onZoom('out')} aria-label="Zoom out"
                  className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-sm font-bold text-slate-200 hover:border-white/30">−</button>
                <button type="button" onClick={() => onZoom('in')} aria-label="Zoom in"
                  className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1 text-sm font-bold text-slate-200 hover:border-white/30">+</button>
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
    </div>
  );
}

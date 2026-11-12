/**
 * Scatter2D — the Evidence modal's plot (recovered from the Nov 11
 * dashboard archive, unchanged maths). Same data, same colours, same
 * atmosphere markers and gap line as the 3D scatter. Judges must be able
 * to read the verdict from this view alone.
 *
 * Axes: X = O2 (0-100%), Y = pressure (0-75 psi — data-driven: max tested
 * pressure is 73.5 psi). Rows with O2 but no pressure (225) are counted in
 * the strip below, never plotted at an assumed pressure. The 11 rows with
 * pressure but no O2 (PSI-10 inverse) cannot be placed on the O2 axis
 * either — counted in the footnote.
 */
import { ATMOSPHERES, classColor, gapEndpoint, scatterCounts } from '../lib/data.js';

const W = 800;
const H = 520;
const ML = 56;
const MR = 24;
const MT = 28;
const MB = 44;
const P_MAX = 75; // psi — covers the max tested pressure (73.5 psi)

function x(o2) { return ML + (o2 / 100) * (W - ML - MR); }
function y(p) { return H - MB - (p / P_MAX) * (H - MT - MB); }

export default function Scatter2D({ points, selectedMaterial, atmosphere, verdict }) {
  const atm = ATMOSPHERES[atmosphere];
  const ep = gapEndpoint(verdict);
  const counts = scatterCounts();
  const ax = x(atm.o2);
  const ay = y(atm.pressure);
  const selected = selectedMaterial === 'all'
    ? points
    : points.filter((p) => p.material === selectedMaterial);
  const others = selectedMaterial === 'all' ? [] : points.filter((p) => p.material !== selectedMaterial);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`2D scatter of ${points.length} PSI test rows: oxygen versus pressure`}>
        {/* gridlines */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={`gx${v}`}>
            <line x1={x(v)} y1={MT} x2={x(v)} y2={H - MB} stroke="#1e293b" strokeWidth="1" />
            <text x={x(v)} y={H - MB + 18} fill="#64748b" fontSize="11" textAnchor="middle">{v}%</text>
          </g>
        ))}
        {[0, 15, 30, 45, 60, 75].map((v) => (
          <g key={`gy${v}`}>
            <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
            <text x={ML - 8} y={y(v) + 4} fill="#64748b" fontSize="11" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} fill="#94a3b8" fontSize="12" textAnchor="middle">Oxygen O&#8322; (% by volume)</text>
        <text x={14} y={H / 2} fill="#94a3b8" fontSize="12" textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>Pressure (psi)</text>

        {/* dimmed cloud */}
        {others.map((p, i) => (
          <circle key={`o${i}`} cx={x(p.o2)} cy={y(p.pressure)} r={2.5} fill={classColor(p.className)} opacity={0.25} />
        ))}
        {/* selected material — bright */}
        {selected.map((p, i) => (
          <circle key={`s${i}`} cx={x(p.o2)} cy={y(p.pressure)} r={3.5} fill={classColor(p.className)} opacity={0.95}>
            <title>{`${p.material} · ${p.accession} ${p.rowRef} · O\u2082 ${p.o2}% · ${p.pressure.toFixed(2)} psi${p.outcome ? ` · ${p.outcome}` : ''}`}</title>
          </circle>
        ))}

        {/* atmosphere markers — all three, selected one ringed.
            Labels are staggered (ISS above, Orion below, Exploration above)
            because the three markers sit close together. */}
        {Object.values(ATMOSPHERES).map((a) => {
          const lab = { ISS: { dy: -20, anchor: 'middle' }, Orion: { dy: 30, anchor: 'middle' }, Exploration: { dy: -20, anchor: 'middle' } }[a.key];
          return (
          <g key={a.key}>
            <circle cx={x(a.o2)} cy={y(a.pressure)} r={a.key === atmosphere ? 13 : 9} fill={a.color} opacity={0.25} />
            <circle cx={x(a.o2)} cy={y(a.pressure)} r={a.key === atmosphere ? 7 : 5} fill={a.color} stroke="#0f172a" strokeWidth="1.5" />
            {a.key === atmosphere && (
              <circle cx={x(a.o2)} cy={y(a.pressure)} r={17} fill="none" stroke={a.color} strokeWidth="1.5" strokeDasharray="4 3" />
            )}
            <text x={x(a.o2)} y={y(a.pressure) + lab.dy} fill={a.color} fontSize="12" fontWeight="700" textAnchor={lab.anchor}>
              {a.name} {a.o2}%
            </text>
          </g>
          );
        })}

        {/* gap line to the nearest tested row */}
        {ep && ep.o2 != null && (verdict.kind === 'GAP_O2' || verdict.kind === 'GAP_PRESSURE' || verdict.kind === 'PARTIAL') && (
          <g>
            <line x1={ax} y1={ay} x2={x(ep.o2)} y2={y(ep.pressure)} stroke={verdict.kind === 'PARTIAL' ? '#f59e0b' : '#ef4444'} strokeWidth="2" strokeDasharray="6 4" />
            <circle cx={x(ep.o2)} cy={y(ep.pressure)} r={5} fill="none" stroke="#fff" strokeWidth="1.5" />
            <text x={(ax + x(ep.o2)) / 2} y={(ay + y(ep.pressure)) / 2 - 10} fill={verdict.kind === 'PARTIAL' ? '#f59e0b' : '#ef4444'} fontSize="12" fontWeight="700" textAnchor="middle">
              {verdict.kind === 'GAP_O2' && `${verdict.o2_distance_pts} O\u2082 pts below`}
              {verdict.kind === 'GAP_PRESSURE' && `${verdict.pressure_distance_psi} psi above nearest test`}
              {verdict.kind === 'PARTIAL' && 'O\u2082 covered — pressure not recorded'}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-1 text-xs text-slate-400">
        {points.length} PSI test rows plotted (O&#8322; + pressure both recorded).{' '}
        {counts.o2NoP} rows have O&#8322; but no pressure — shown as a count, never plotted at an assumed pressure.{' '}
        {counts.pNoO2} Flame Design inverse rows record pressure but no O&#8322; and cannot be placed on the O&#8322; axis.
      </p>
    </div>
  );
}

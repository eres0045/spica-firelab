/**
 * App tests — the MINIMAL immersive rebuild (2026-11-11, Ronit: "space
 * with iss and interior and for fire control transparent ui nothing else
 * nothing dashboard").
 *
 * jsdom has no WebGL, so FireLab3D shows its no-WebGL fallback — the
 * panel, verdict line and camera section are all App-level and fully
 * testable here. Verdict MATH is asserted through the one-line readout
 * (same getVerdict/getLiveVerdict values the old card showed).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import App from './App.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App — minimal fire lab (jsdom has no WebGL)', () => {
  it('renders the title chip, the panel and the SIBAL + ISS PARTIAL verdict line on load', () => {
    render(<App />);
    expect(screen.getByText('The 34% Question')).toBeTruthy();
    expect(screen.getByText('🔥 Fire control')).toBeTruthy();
    // Default state: SIBAL fabric + ISS -> PARTIAL (O2 covered).
    expect(screen.getByText(/SIBAL fabric · ISS 21%/)).toBeTruthy();
    expect(screen.getByText(/PARTIAL · O₂ covered/)).toBeTruthy();
    // No-WebGL fallback from the scene (jsdom only).
    expect(screen.getByText(/The 3D fire lab needs WebGL/)).toBeTruthy();
    // Honesty + credits lines live in the panel now.
    expect(screen.getByText(/Flame is illustrative — verdicts come from real NASA PSI test data\./)).toBeTruthy();
    expect(screen.getByText(/Models: uperesito \(ISS, CC-BY\) · Space Explorers Academy \(ISS interior, CC BY-NC-SA 4\.0\) · LasquetiSpice \(astronaut, CC-BY\) · dannzjs \(Dragon, CC-BY\) · pergamond \(Int-Ball, CC-BY\) · Sun texture: Solar System Scope, CC BY 4\.0 · Data: NASA PSI/)).toBeTruthy();
  });

  it('the only UI is the panel + title + camera section — no dashboard anywhere', () => {
    render(<App />);
    // Sliders + material picker + camera section are present.
    expect(screen.getByLabelText('Oxygen percent')).toBeTruthy();
    expect(screen.getByLabelText('Pressure psi')).toBeTruthy();
    expect(screen.getByLabelText('Flow cm per second')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Methanol droplet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    for (const label of ['Wide', 'Chamber', 'ISS', 'Inside', 'Earth']) {
      expect(screen.getByRole('button', { name: `Camera view: ${label}` })).toBeTruthy();
    }
    // No top-right toggle anymore — the panel's CAMERA section is the
    // only camera control.
    expect(screen.queryByRole('button', { name: /Exterior — Earth \+ ISS/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Inside the station/ })).toBeNull();
    // Dashboard pieces are GONE: no tabs, no verdict card, no missions,
    // no evidence/scatter, no ranking, no model viewer, no DOI text.
    expect(screen.queryByText(/Evidence — test cloud/)).toBeNull();
    expect(screen.queryByText(/Start mission/)).toBeNull();
    expect(screen.queryByText(/Coverage ≠ safety\./)).toBeNull();
    expect(screen.queryByText(/30-second demo beats/)).toBeNull();
    expect(screen.queryByText(/997 PSI test rows plotted/)).toBeNull();
    expect(screen.queryByText(/No model for Orion/)).toBeNull();
    expect(screen.queryByText(/DOI/)).toBeNull();
  });

  it('demo flow: Exploration chip -> SIBAL GAP 11.9 O2 pts', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Exploration · 34% O₂/ }));
    expect(screen.getByText(/SIBAL fabric · Exploration 34%/)).toBeTruthy();
    expect(screen.getByText(/GAP 11\.9 O₂ pts/)).toBeTruthy();
  });

  it('demo flow: Methanol droplet at Exploration -> pressure GAP 1.98 psi', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Exploration · 34% O₂/ }));
    fireEvent.click(screen.getByRole('button', { name: /Methanol droplet/ }));
    expect(screen.getByText(/Methanol droplet · Exploration 34%/)).toBeTruthy();
    expect(screen.getByText(/GAP 1\.98 psi/)).toBeTruthy();
  });

  it('demo flow: Methanol droplet at Orion -> TESTED', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Orion · 26\.5% O₂/ }));
    fireEvent.click(screen.getByRole('button', { name: /Methanol droplet/ }));
    expect(screen.getByText(/Methanol droplet · Orion 26\.5%/)).toBeTruthy();
    expect(screen.getByText(/TESTED/)).toBeTruthy();
  });

  it('free play: dragging the O2 slider to 34% gives the same live GAP 11.9', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Oxygen percent'), { target: { value: '34' } });
    fireEvent.change(screen.getByLabelText('Pressure psi'), { target: { value: '8.2' } });
    expect(screen.getByText(/Custom cabin · 34% O₂ @ 8\.2 psi/)).toBeTruthy();
    expect(screen.getByText(/GAP 11\.9 O₂ pts/)).toBeTruthy();
  });

  it('camera presets switch views — Inside goes in, Wide comes back out', () => {
    render(<App />);
    const inside = screen.getByRole('button', { name: 'Camera view: Inside' });
    const wide = screen.getByRole('button', { name: 'Camera view: Wide' });
    expect(wide.getAttribute('aria-pressed')).toBe('true');
    expect(inside.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(inside);
    expect(inside.getAttribute('aria-pressed')).toBe('true');
    expect(wide.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(wide);
    expect(wide.getAttribute('aria-pressed')).toBe('true');
    expect(inside.getAttribute('aria-pressed')).toBe('false');
  });

  it('zoom buttons exist and clear the active preset', () => {
    render(<App />);
    const chamber = screen.getByRole('button', { name: 'Camera view: Chamber' });
    fireEvent.click(chamber);
    expect(chamber.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(chamber.getAttribute('aria-pressed')).toBe('false');
    // Zoom out is a plain action too — no crash, no preset re-selected.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByRole('button', { name: 'Camera view: Wide' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('panel collapses to header + verdict line, and expands again', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse fire controls' }));
    expect(screen.queryByLabelText('Oxygen percent')).toBeNull();
    expect(screen.queryByRole('button', { name: /Methanol droplet/ })).toBeNull();
    // The verdict line stays visible when collapsed.
    expect(screen.getByText(/PARTIAL · O₂ covered/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand fire controls' }));
    expect(screen.getByLabelText('Oxygen percent')).toBeTruthy();
  });

  it('panel hides entirely via the ✕ button and comes back via the restore pill', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Show fire controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide fire control panel' }));
    // The whole panel is gone — sliders, verdict line, credits.
    expect(screen.queryByLabelText('Oxygen percent')).toBeNull();
    expect(screen.queryByText(/PARTIAL · O₂ covered/)).toBeNull();
    expect(screen.queryByText(/^Models:/)).toBeNull();
    // Title chip stays; the camera section is IN the panel, so it is gone too.
    expect(screen.getByText('The 34% Question')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Camera view: Inside' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show fire controls' }));
    expect(screen.getByLabelText('Oxygen percent')).toBeTruthy();
    expect(screen.getByText(/PARTIAL · O₂ covered/)).toBeTruthy();
  });

  it('live API: the UI renders the API verdict, not the bundled one', async () => {
    // The mock API deliberately returns a DIFFERENT verdict for the
    // default SIBAL + ISS state (a GAP the bundled data does not have),
    // so the test proves the line comes from the API response.
    const apiVerdict = {
      material: 'SIBAL fabric', atmosphere: 'ISS', kind: 'GAP_O2',
      overall: 'GAP (O2)', o2_nearest: 22.1, o2_distance_pts: 11.9,
      o2_nearest_row: ['PSI-99', 'Sample 2-5'], o2_verdict: 'GAP',
      pressure_verdict: 'NOT RECORDED',
    };
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/api/verdict')) return { ok: true, json: async () => apiVerdict };
      if (u.includes('/api/materials')) return { ok: true, json: async () => ({ materials: [] }) };
      if (u.includes('/api/scatter')) return { ok: true, json: async () => ({ points: [] }) };
      if (u.includes('/api/ranking')) return { ok: true, json: async () => ({ cabin: [], gases: [] }) };
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    // Probe succeeds -> the live-API tag appears...
    expect(await screen.findByText(/live API/)).toBeTruthy();
    // ...and the verdict line switches to the API's value.
    await waitFor(() => expect(screen.getByText(/GAP 11\.9 O₂ pts/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/verdict?material=SIBAL'), expect.anything());
  });

  it('API down: the verdict line falls back to the bundled PSI data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no server'); }));
    render(<App />);
    expect(await screen.findByText(/on-device data/)).toBeTruthy();
    // Same numbers as ever — the fallback is the bundled data.
    expect(screen.getByText(/PARTIAL · O₂ covered/)).toBeTruthy();
  });

  it('mission brief button opens a printable brief with the ranking + citations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no server'); }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open mission brief' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mission brief' });
    expect(within(dialog).getByText(/Mission brief — ISS/)).toBeTruthy();
    // ISS ranking: SIBAL is PARTIAL, nearest test T25, DOI cited.
    expect(within(dialog).getByText('PSI-25 · Test T25 · DOI 10.60555/4qc4-de67')).toBeTruthy();
    // Citations section lists the investigations; reports list BASS-II.
    expect(within(dialog).getByText(/PSI-25 · Burning and Suppression of Solids - II/)).toBeTruthy();
    expect(within(dialog).getByText(/BASS-II — NASA\/TM-20210011385/)).toBeTruthy();
    expect(within(dialog).getByText(/Coverage, not certification/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Print mission brief' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close mission brief' }));
    expect(screen.queryByRole('dialog', { name: 'Mission brief' })).toBeNull();
  });
});

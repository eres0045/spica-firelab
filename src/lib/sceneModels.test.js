/**
 * sceneModels tests — the optional-model fallback logic + the shipped
 * scene assets in public/ (SCENE_MODELS.md).
 *
 * The two Sketchfab GLBs (iss-uperesito.glb, iss-interior-scan.glb)
 * LANDED 2026-11-11 10:03 IST via the Sketchfab Download API
 * (personal API token, Token auth) — no browser/captcha needed. The
 * disk test below asserts they are present and real glTF binaries; the
 * pure resolver tests prove the preferred file wins the moment it
 * exists, and the fallback paths stay covered by the resolver tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ISS_PREFERRED_URL, ISS_FALLBACK_URL,
  resolveOptionalModel, probeModelUrl, fetchWithTimeout,
  loadWithRetries, loadIssModel,
} from './sceneModels.js';

describe('resolveOptionalModel — preferred wins when present, fallback otherwise', () => {
  it('uses the preferred ISS when the human-gate download exists', () => {
    const exists = (u) => u === ISS_PREFERRED_URL;
    expect(resolveOptionalModel(ISS_PREFERRED_URL, ISS_FALLBACK_URL, exists))
      .toBe(ISS_PREFERRED_URL);
  });
  it('falls back to iss-a.glb when the preferred ISS is absent', () => {
    const exists = () => false;
    expect(resolveOptionalModel(ISS_PREFERRED_URL, ISS_FALLBACK_URL, exists))
      .toBe(ISS_FALLBACK_URL);
  });
  // The interior scan has no resolver: the component loads it directly
  // with a GLTFLoader onError fallback (a Range probe would double
  // -download a possibly 20 MB scan on hosts that ignore Range). Its
  // fallback — the chamber close-up with the scan absent — is verified
  // visually in preview/firelab-scene-03-desktop-interior.png.
});

describe('probeModelUrl — Range GET + glTF magic, with a timeout (2026-11-12 fix)', () => {
  const gltfBytes = () => new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer; // 'glTF'
  const htmlBytes = () => new TextEncoder().encode('<!doctype html>').buffer;
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('returns true when the first 4 bytes are the glTF magic', async () => {
    globalThis.fetch = vi.fn(async () => ({ arrayBuffer: async () => gltfBytes() }));
    await expect(probeModelUrl('/models/iss-uperesito.glb')).resolves.toBe(true);
  });
  it('returns false for the SPA fallback HTML (wrong magic)', async () => {
    globalThis.fetch = vi.fn(async () => ({ arrayBuffer: async () => htmlBytes() }));
    await expect(probeModelUrl('/models/missing.glb')).resolves.toBe(false);
  });
  it('returns false when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
    await expect(probeModelUrl('/models/iss-uperesito.glb')).resolves.toBe(false);
  });
  it('returns false on timeout instead of hanging forever', async () => {
    vi.useFakeTimers();
    // A fetch that honours the abort signal (like a real one) but never resolves.
    globalThis.fetch = vi.fn((url, { signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const promise = probeModelUrl('/models/iss-uperesito.glb', 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe(false);
  });
});

describe('fetchWithTimeout — rejects on HTTP error, failure, and timeout', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('returns the response when fetch succeeds', async () => {
    const res = { ok: true, status: 200 };
    globalThis.fetch = vi.fn(async () => res);
    await expect(fetchWithTimeout('/models/iss-uperesito.glb', 1000)).resolves.toBe(res);
  });
  it('rejects on HTTP >= 400', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    await expect(fetchWithTimeout('/models/missing.glb', 1000)).rejects.toThrow('HTTP 404');
  });
  it('rejects on timeout instead of hanging', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((url, { signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const promise = fetchWithTimeout('/models/iss-uperesito.glb', 50);
    // Attach the rejection handler BEFORE advancing timers, or the
    // abort rejection is briefly unhandled and vitest reports it.
    const assertion = expect(promise).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe('loadWithRetries — retry policy (2026-11-12 ISS fix)', () => {
  it('succeeds on the first attempt', async () => {
    const loadFn = vi.fn(async () => 'gltf');
    await expect(loadWithRetries(loadFn, '/u', { delayMs: 0 })).resolves.toBe('gltf');
    expect(loadFn).toHaveBeenCalledTimes(1);
  });
  it('retries after failures and returns the first success', async () => {
    const loadFn = vi.fn()
      .mockRejectedValueOnce(new Error('flake 1'))
      .mockRejectedValueOnce(new Error('flake 2'))
      .mockResolvedValueOnce('gltf');
    await expect(loadWithRetries(loadFn, '/u', { delayMs: 0 })).resolves.toBe('gltf');
    expect(loadFn).toHaveBeenCalledTimes(3);
  });
  it('throws the last error after maxAttempts and warns on every failure', async () => {
    const loadFn = vi.fn(async () => { throw new Error('down'); });
    const onWarn = vi.fn();
    await expect(loadWithRetries(loadFn, '/u', { maxAttempts: 3, delayMs: 0, onWarn }))
      .rejects.toThrow('down');
    expect(loadFn).toHaveBeenCalledTimes(3);
    expect(onWarn).toHaveBeenCalledTimes(3);
    expect(onWarn).toHaveBeenNthCalledWith(1, '/u', 1, expect.any(Error));
    expect(onWarn).toHaveBeenNthCalledWith(3, '/u', 3, expect.any(Error));
  });
});

describe('loadIssModel — preferred with retries, then fallback (2026-11-12 ISS fix)', () => {
  const preferred = ISS_PREFERRED_URL;
  const fallback = ISS_FALLBACK_URL;
  it('loads the preferred model on the first try', async () => {
    const loadFn = vi.fn(async (u) => `loaded:${u}`);
    const out = await loadIssModel(loadFn, { delayMs: 0 });
    expect(out).toEqual({ url: preferred, result: `loaded:${preferred}` });
    expect(loadFn).toHaveBeenCalledTimes(1);
  });
  it('falls back to iss-a.glb after the preferred model exhausts its retries', async () => {
    const loadFn = vi.fn(async (u) => {
      if (u === preferred) throw new Error('preferred flaky');
      return `loaded:${u}`;
    });
    const onWarn = vi.fn();
    const out = await loadIssModel(loadFn, { delayMs: 0, onWarn });
    expect(out).toEqual({ url: fallback, result: `loaded:${fallback}` });
    expect(loadFn).toHaveBeenCalledTimes(4); // 3 preferred + 1 fallback
    expect(onWarn).toHaveBeenCalledTimes(3);
  });
  it('throws after every attempt on both URLs fails', async () => {
    const loadFn = vi.fn(async () => { throw new Error('all down'); });
    const onWarn = vi.fn();
    await expect(loadIssModel(loadFn, { delayMs: 0, onWarn })).rejects.toThrow('all down');
    expect(loadFn).toHaveBeenCalledTimes(6); // 3 preferred + 3 fallback
    expect(onWarn).toHaveBeenCalledTimes(6);
  });
});

describe('scene assets shipped in public/ (SCENE_MODELS.md)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pub = join(here, '..', '..', 'public');
  const expected = [
    'textures/earth-atmos-2048.jpg',
    'textures/earth-specular-2048.jpg',
    'textures/earth-normal-2048.jpg',
    'textures/earth-lights-2048.png',
    'textures/moon-1024.jpg',
    'models/astronaut-floating-lasqueti.glb',
    'models/crew-dragon.glb',
    'models/intball-jaxa.glb',
    'models/nasa-shuttle-D.glb',
    'models/nasa-canadarm.glb',
    'models/nasa-lro-A.glb',
  ];
  it.each(expected)('%s exists and is non-empty', (rel) => {
    const p = join(pub, rel);
    expect(existsSync(p), `${rel} missing from public/`).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(0);
  });
  it('Earth textures are real JPEG/PNG files, not placeholders', () => {
    const atmos = readFileSync(join(pub, 'textures/earth-atmos-2048.jpg'));
    expect(atmos[0]).toBe(0xff);
    expect(atmos[1]).toBe(0xd8); // JPEG SOI
    const lights = readFileSync(join(pub, 'textures/earth-lights-2048.png'));
    expect(lights.slice(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  });
  it('the astronaut is a real glTF binary, not a placeholder', () => {
    const buf = readFileSync(join(pub, 'models/astronaut-floating-lasqueti.glb'));
    expect(buf.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(buf.length).toBeGreaterThan(3000000); // ~3.1 MB, animated
  });
  it('Crew Dragon + Int-Ball are real glTF binaries', () => {
    for (const rel of ['models/crew-dragon.glb', 'models/intball-jaxa.glb']) {
      const buf = readFileSync(join(pub, rel));
      expect(buf.slice(0, 4).toString('ascii')).toBe('glTF');
    }
  });
  it('Wave 2 NASA models are real glTF binaries, public domain, Draco + WebP (no new CC-BY owed)', () => {
    const shuttle = readFileSync(join(pub, 'models/nasa-shuttle-D.glb'));
    expect(shuttle.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(shuttle.length).toBeGreaterThan(2000000); // ~2.47 MB, 42 meshes
    const canadarm = readFileSync(join(pub, 'models/nasa-canadarm.glb'));
    expect(canadarm.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(canadarm.length).toBeGreaterThan(200000); // ~271 KB, 1 mesh
    const lro = readFileSync(join(pub, 'models/nasa-lro-A.glb'));
    expect(lro.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(lro.length).toBeGreaterThan(500000); // ~654 KB, 55 meshes
  });
  it('Sketchfab GLBs are present and real glTF binaries (landed 2026-11-11 via Download API)', () => {
    const iss = readFileSync(join(pub, 'models/iss-uperesito.glb'));
    expect(iss.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(iss.length).toBeGreaterThan(1000000); // ~2.58 MB
    const interior = readFileSync(join(pub, 'models/iss-interior-scan.glb'));
    expect(interior.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(interior.length).toBeGreaterThan(1000000); // ~8.16 MB (4096 texture, 2026-11-11 blur fix)
  });
  it('the full-station interior tour is present and real (Academy upload, landed 2026-11-11 evening)', () => {
    const tour = readFileSync(join(pub, 'models/academy-iss-interior.glb'));
    expect(tour.slice(0, 4).toString('ascii')).toBe('glTF');
    expect(tour.length).toBeGreaterThan(30000000); // ~37.11 MB, 234 meshes, 29 textures, no compression
  });
});

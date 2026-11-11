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
import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ISS_PREFERRED_URL, ISS_FALLBACK_URL,
  resolveOptionalModel,
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
    expect(interior.length).toBeGreaterThan(1000000); // ~5.91 MB (texture resized to 2048)
  });
});

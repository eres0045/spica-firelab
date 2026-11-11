/**
 * sceneModels — optional scene models for the fire lab (see
 * assets/SCENE_MODELS.md).
 *
 * The scene ships with real downloaded models (Earth textures, NASA
 * astronaut GLB). Two better models sat behind a Sketchfab account gate
 * and LANDED 2026-11-11 10:03 IST via the Sketchfab Download API
 * (personal API token, Token auth — no browser/captcha) as GLBs in
 * app/public/models/:
 *
 *   - iss-uperesito.glb — ISS by uperesito (CC-BY, Sketchfab), the
 *     realistic ISS exterior. Until it lands, the scene falls back to
 *     NASA's iss-a.glb (public domain).
 *   - iss-interior-scan.glb — ISS module interior photogrammetry scan by
 *     patrick- (CC-BY, Sketchfab). Until it lands, the interior view
 *     falls back to the glovebox close-up — never a broken state.
 *     SUPERSEDED 2026-11-11 evening: the full walkable ISS interior tour
 *     (Space Explorers Academy, CC BY-NC-SA 4.0 — the same NASA/JSC
 *     IGOAL scan as the Raiz tour, which is not downloadable) replaces
 *     it as `academy-iss-interior.glb` (INTERIOR_TOUR_URL). The old
 *     single-module file stays on disk, unloaded.
 *
 * The probe is a Range GET + glTF-magic check (see probeModelUrl): a 404
 * on one of these two URLs is the DESIGNED fallback signal, not an error.
 * The headless error probes report any HTTP >= 400 (no whitelist — both
 * GLBs are downloaded now).
 */
/**
 * Public-asset base: Vite sets import.meta.env.BASE_URL from vite.config
 * `base` ('./' for GitHub Pages sub-path hosting, '/' locally). Every
 * public/ asset URL in the app goes through pub() so the same build works
 * at root and under /spica-firelab/. In tests BASE_URL defaults to '/',
 so
 * the constants keep their '/models/...' values there.
 */
export const PUB = import.meta.env.BASE_URL;
export const pub = (p) => `${PUB}${p}`;

export const ISS_PREFERRED_URL = pub('models/iss-uperesito.glb');
export const ISS_FALLBACK_URL = pub('models/iss-a.glb');
export const INTERIOR_SCAN_URL = pub('models/iss-interior-scan.glb');
/** Full walkable ISS interior tour (Space Explorers Academy, CC BY-NC-SA 4.0). */
export const INTERIOR_TOUR_URL = pub('models/academy-iss-interior.glb');

/** Pure resolver — unit-tested. `exists` is a predicate over a URL. */
export function resolveOptionalModel(preferredUrl, fallbackUrl, exists) {
  return exists(preferredUrl) ? preferredUrl : fallbackUrl;
}

/**
 * Range-probe a public/ GLB URL: fetch the first 4 bytes and check for
 * the 'glTF' magic. Returns false on 404 / network failure / wrong
 * magic — never throws.
 *
 * Why not HEAD: the dev/preview server (vite preview, sirv) answers HEAD
 * with 200 + the SPA fallback HTML for missing files, so a status check
 * cannot tell present from absent — the first probe round resolved the
 * missing uperesito ISS as "present" and the loader then choked on HTML.
 * A Range GET is honoured by sirv (206 + 4 bytes) for present files and
 * returns the HTML fallback for missing ones — the magic check decides.
 */
export async function probeModelUrl(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-3' } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return (
      buf.length >= 4 &&
      buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46 // 'glTF'
    );
  } catch {
    return false;
  }
}

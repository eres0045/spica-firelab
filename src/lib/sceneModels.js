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
// Node-safe: plain Node (and the Netlify Function bundle, which imports
// src/lib/data.js for the shared verdict math) has no import.meta.env —
// fall back to '/' there, exactly what the tests assume. Vite still
// replaces import.meta.env.BASE_URL at build time, so the browser value
// is unchanged.
export const PUB = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
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
 *
 * Timeout (2026-11-12): the probe used to await fetch with NO timeout,
 * so a hanging request stalled the ISS loader IIFE forever and the
 * station never appeared. An AbortController caps the probe at
 * `timeoutMs` (default 8 s); a timeout is a plain `false`.
 */
export async function probeModelUrl(url, timeoutMs = 8000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-3' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return (
      buf.length >= 4 &&
      buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46 // 'glTF'
    );
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * ISS load policy (2026-11-12 fix — the station vanished from Ronit's
 * phone because the old probe-first loader had one silent attempt and
 * no timeout: one transient failure = no ISS for the whole page load).
 * The bundled preferred file is tried directly, with retries and a
 * per-attempt network cap; the fallback gets the same treatment.
 *   - MAX_ATTEMPTS: tries per URL before moving on.
 *   - ATTEMPT_TIMEOUT_MS: network cap per try (fetch abort). The
 *     decode is capped separately (DECODE_TIMEOUT_MS) because Draco
 *     decode under SwiftShader takes 16–25 s — a single short cap over
 *     the whole load would time out healthy decodes.
 *   - RETRY_DELAY_MS: pause between attempts on the same URL.
 */
export const ISS_LOAD_MAX_ATTEMPTS = 3;
export const ISS_LOAD_ATTEMPT_TIMEOUT_MS = 15000;
export const ISS_LOAD_DECODE_TIMEOUT_MS = 60000;
export const ISS_LOAD_RETRY_DELAY_MS = 1000;

/**
 * Fetch a URL with an abort timeout. Rejects on HTTP >= 400, on
 * network failure, and on timeout — never hangs. Pure fetch wrapper,
 * unit-tested with a mocked fetch.
 */
export async function fetchWithTimeout(url, timeoutMs = ISS_LOAD_ATTEMPT_TIMEOUT_MS) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...(controller ? { signal: controller.signal } : {}) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Call `loadFn(url)` with retries: up to `maxAttempts` tries, `delayMs`
 * between them, `onWarn(url, attempt, err)` on every failure. Returns
 * the first success; throws the last error after the final attempt.
 * `loadFn` is injected so the policy is unit-testable without WebGL.
 */
export async function loadWithRetries(loadFn, url, {
  maxAttempts = ISS_LOAD_MAX_ATTEMPTS,
  delayMs = ISS_LOAD_RETRY_DELAY_MS,
  onWarn,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await loadFn(url);
    } catch (err) {
      lastError = err;
      if (onWarn) onWarn(url, attempt, err);
      if (attempt < maxAttempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * ISS load plan: try the preferred model (iss-uperesito.glb) with
 * retries, then the fallback (iss-a.glb) with the same retries.
 * Returns `{ url, result }` for the URL that loaded. Throws the
 * fallback's last error only after every attempt on both URLs failed.
 */
export async function loadIssModel(loadFn, {
  preferredUrl = ISS_PREFERRED_URL,
  fallbackUrl = ISS_FALLBACK_URL,
  maxAttempts = ISS_LOAD_MAX_ATTEMPTS,
  delayMs = ISS_LOAD_RETRY_DELAY_MS,
  onWarn,
} = {}) {
  try {
    const result = await loadWithRetries(loadFn, preferredUrl, { maxAttempts, delayMs, onWarn });
    return { url: preferredUrl, result };
  } catch {
    // Preferred exhausted — same retry policy on the fallback.
    const result = await loadWithRetries(loadFn, fallbackUrl, { maxAttempts, delayMs, onWarn });
    return { url: fallbackUrl, result };
  }
}

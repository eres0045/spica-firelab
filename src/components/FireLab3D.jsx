/**
 * FireLab3D — the interactive 3D fire lab (plain `three`, no react-three-fiber).
 *
 * A rack-mounted glovebox (MSG-style) set into the wall of the real ISS
 * interior, holding a material sample with a LIVE FLAME inside it.
 * Microgravity flames are spherical — no buoyancy, no tall teardrop — so the
 * flame is a glowing ball: small and blue at low O2, bigger/brighter/oranger
 * as O2 rises, shrinking and flickering hard near extinction at low O2, and
 * elongating slightly downstream when flow is high. The flame visibly changes
 * the moment a control moves.
 *
 * THE SCENE IS REAL MODELS, NOT CODE-BUILT SCENERY (assets/SCENE_MODELS.md):
 * - Earth: photographic Blue Marble textures on a sphere (three.js example
 *   set, NASA-derived, MIT) — map + specular + normal + night-lights
 *   emissive — low in frame, with a blue atmosphere halo. Moon: small
 *   textured sphere. Generated starfield behind it all.
 * - ISS: the uperesito Sketchfab model (CC-BY), landed 2026-11-11 via the
 *   Sketchfab Download API as `public/models/iss-uperesito.glb`. Probed
 *   with a Range GET + glTF-magic check (a HEAD probe cannot tell present
 *   from absent on the preview server's SPA fallback); the miss is the
 *   designed fallback signal, not an error — NASA's iss-a.glb (public
 *   domain) is the fallback.
 * - Astronaut: "Animated Floating Astronaut" by LasquetiSpice (CC-BY,
 *   Sketchfab) — natural relaxed floating pose, 7 s loop via
 *   AnimationMixer. Small in frame, drifting near the station. Never a
 *   close-up hero.
 * - Crew Dragon (dannzjs, CC-BY): small capsule docked just below-right
 *   of the ISS in the exterior view. Int-Ball (pergamond, CC-BY): the
 *   JAXA ISS interior drone, a small floating prop in the interior view.
 * - ISS interior: the patrick- module-interior photogrammetry scan (CC-BY),
 *   landed 2026-11-11 as `public/models/iss-interior-scan.glb` — lazy-
 *   loaded only when the user switches to the interior view. A load
 *   failure silently keeps the glovebox close-up (no probe — a Range probe
 *   would double-download a ~6 MB scan on hosts that ignore Range).
 *   Never a broken state.
 * - The GLOVEBOX is code-built (a rack-mounted MSG-style unit set into
 *   the module wall: dark metal cabinet, two glove ports, control strip,
 *   glass ONLY on the front face of the work volume — never a free-floating
 *   glass box). No usable glovebox model exists anywhere (verified
 *   exhaustively — see SCENE_MODELS.md), so the real models go AROUND the
 *   code-built hardware. The front glass is plain transparent (opacity
 *   ~0.06), not transmission — the transmission pass refracted the nearby
 *   astronaut into a ghost twin on the wall.
 *
 * GAME ASSETS (assets/GAME_ASSETS.md — all CC0, verified on disk):
 * - qwantani_night_puresky_1k.hdr (Poly Haven) is the scene ENVIRONMENT map
 *   only (RGBELoader + PMREM -> scene.environment, intensity ~0.8) — it gives
 *   the transmission glass and the metal frame real reflections and a key
 *   light. It is NEVER the visible background; the background is dark space
 *   + Earth + stars.
 * - Kenney Particle Pack sprites (white, tinted in-engine by O2): flame_05
 *   is the primary flame tongue, flame_01/flame_02 are wispier variants
 *   mixed in so the cloud never repeats one shape, light_01 is the flame
 *   core glow + halo, fire_01 is a one-shot ignition burst, smoke_03 are
 *   soft puffs at low O2 / after extinction, star_04 is the twinkling
 *   background starfield. Flame particles are emitted in a BALL.
 *
 * HONESTY: the flame is ILLUSTRATIVE — its size/colour respond to O2,
 * pressure and flow the way real microgravity flames do, but it is NOT a
 * physics simulation and NOT a prediction of whether the material will
 * burn. The safety verdict next to the glovebox comes from real NASA PSI
 * test data only (see data.js getLiveVerdict). The label on screen says so.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ATMOSPHERES, detectWebGL } from '../lib/data.js';
import {
  ISS_PREFERRED_URL, ISS_FALLBACK_URL, INTERIOR_SCAN_URL,
  resolveOptionalModel, probeModelUrl, pub,
} from '../lib/sceneModels.js';

/**
 * Flame visual parameters from lab conditions. Pure function — unit-tested.
 * O2 10-40% -> radius 0.30-0.85 (droplets 0.85x), colour blue -> amber ->
 * orange; flow 0-30 cm/s -> downstream elongation up to 1.9x; pressure
 * 6-15 psi -> brightness 0.55-1.0; O2 <= 13% -> near-extinction flicker.
 */
export function flameParams({ materialClass, o2, pressure, flow }) {
  const t = Math.min(1, Math.max(0, (o2 - 10) / 30));
  const radius = (0.30 + t * 0.55) * (materialClass === 'droplet' ? 0.85 : 1);
  const elong = 1 + (flow / 30) * 0.9;
  const brightness = 0.55 + ((pressure - 6) / 9) * 0.45;
  const nearExtinct = o2 <= 13;
  const flicker = nearExtinct ? 0.11 : 0.06 + (flow / 30) * 0.06;
  // Colour ramp: deep blue (37,99,235) -> amber (245,158,11) -> orange
  // (249,115,22). The low end is a DIM blue on purpose — the v1 bright
  // blue read as a purple sparkle ball at near-extinction; the renderer
  // also dims the core + glow when nearExtinct (see animate).
  const lerp = (a, b, k) => a + (b - a) * k;
  let r, g, b;
  if (t < 0.5) {
    const k = t / 0.5;
    r = lerp(37, 245, k); g = lerp(99, 158, k); b = lerp(235, 11, k);
  } else {
    const k = (t - 0.5) / 0.5;
    r = lerp(245, 249, k); g = lerp(158, 115, k); b = lerp(11, 22, k);
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return {
    radius, elong, brightness, flicker, nearExtinct,
    color: `#${hex(r)}${hex(g)}${hex(b)}`,
    flowShift: (flow / 30) * 0.35,
  };
}

/** Random points in a unit sphere (uniform volume). */
function spherePoints(n, seedJitter = 1) {
  const pos = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.cbrt(Math.random()) * seedJitter;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    phase[i] = Math.random() * Math.PI * 2;
  }
  return { pos, phase };
}

/** Centre + normalise a loaded GLTF scene so its longest side is `size`. */
function normaliseGltf(obj, size) {
  const box = new THREE.Box3().setFromObject(obj);
  const dims = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;
  const scale = size / maxDim;
  obj.scale.setScalar(scale);
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.sub(centre.multiplyScalar(scale));
  return obj;
}

// The flame burns inside the glovebox work volume (front glass at z = 0,
// back wall at z = -1.55), just above the sample on its pedestal. The
// flame visuals are scaled x0.5 (FLAME_VIS_SCALE, applied at the
// updateCloud/glow/burst/smoke call sites — flameParams itself is untouched
// and unit-tested) so the ball fits the work volume at every slider setting.
export const FLAME_CENTER = new THREE.Vector3(0, 0.1, -0.7);
const FLAME_VIS_SCALE = 0.5;
const FLAME_SPRITE_SCALE = 0.7;
// Exterior (2026-11-11, Ronit: the giant floating box is GONE — the
// exterior is just the station: ISS + shuttle + Dragon + astronaut over
// Earth). The camera frames the ISS/Earth pair; nothing floats in the
// middle of the frame anymore.
const CAM_EXTERIOR = { view: 'exterior', pos: [4.4, 2.3, 6.4], target: [-1.5, -1.2, -3.5], min: 4, max: 16 };
// Interior-first framing (2026-11-11, Ronit: the interior view is the hero
// for the science): the camera looks DOWN THE MODULE AXIS from +Z at the
// rack glovebox mounted in the module wall, flame clearly visible through
// the front glass. Measured, not guessed: scripts/scan-raycast-probe.mjs
// raycasts the real scan geometry — the scan is a long thin corridor (raw
// 15.26 long x ~3.5 diameter), and only near-axis directions have a clear
// sightline to the flame (13/400 sampled directions at the old scale;
// diagonal views are blocked by racks at ~1.1 units). The scan is also
// scaled up (see loadInteriorScan) so the corridor is ~5 wide and the
// 3.6-wide rack cabinet fits INSIDE it instead of poking through the walls.
const CAM_INTERIOR = { view: 'interior', pos: [0.1, 0.1, 4.6], target: [0, 0.1, -0.7], min: 1.2, max: 6 };

/**
 * Camera presets — the ONLY camera control (they live in the panel's
 * CAMERA section in App.jsx; the old top-right Exterior/Inside toggle is
 * gone). Each preset is a view + framing; `inside`/`chamber` are the
 * interior view (the glovebox is the hero), the rest are exterior
 * framings. `wide`/`inside` reuse the default view framings so the two
 * paths can never drift apart. Pure data — unit-tested.
 */
export const CAMERA_PRESETS = {
  wide:    { view: 'exterior', label: 'Wide',    ...CAM_EXTERIOR },
  chamber: { view: 'interior', label: 'Chamber', pos: [0.4, 0.35, 3.6], target: [0, 0.0, -0.7], min: 1.2, max: 6 },
  iss:     { view: 'exterior', label: 'ISS',     pos: [2.2, 2.4, 1.8], target: [-1.5, 1.4, -4.0], min: 2, max: 16 },
  inside:  { view: 'interior', label: 'Inside',  ...CAM_INTERIOR },
  earth:   { view: 'exterior', label: 'Earth',   pos: [1.2, 0.2, 4.6], target: [-6.5, -9.5, -9], min: 2, max: 20 },
};

/** Zoom step: the new camera distance, clamped to the current view's limits. Pure — unit-tested. */
export function zoomDistance(current, factor, min, max) {
  return Math.min(max, Math.max(min, current * factor));
}

/**
 * Readiness flags for the screenshot scripts (and any external check):
 * window.__spicaModels = { iss, astronaut, dragon, intball, shuttle,
 * canadarm, lro, interior }.
 * Set when each GLB finishes decoding — Draco init is slow under
 * SwiftShader (the ISS took ~16–25 s to appear in headless runs), so the
 * shots wait on these flags instead of on fixed timeouts. Harmless in
 * production.
 */
function markModelLoaded(name) {
  if (typeof window !== 'undefined') {
    window.__spicaModels = { ...(window.__spicaModels || {}), [name]: true };
  }
}

export default function FireLab3D({ o2, pressure, flow, material, materialClass, atmosphereKey, sceneView = 'exterior', cameraCmd = null }) {
  const mountRef = useRef(null);
  const webglOK = detectWebGL();
  const stateRef = useRef({ o2, pressure, flow, material, materialClass, atmosphereKey, sceneView, cameraCmd });
  stateRef.current = { o2, pressure, flow, material, materialClass, atmosphereKey, sceneView, cameraCmd };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !webglOK) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // TRUE BLACK space (2026-11-11, Ronit: the navy background read as a
    // "flat dark-blue void"). No blue tint anywhere in the clear color.
    scene.background = new THREE.Color(0x000000);
    // No fog: the scene now has real depth (Earth ~23 units out) and fog
    // would wash the planet out. Depth comes from the Earth/ISS placement.
    scene.environmentIntensity = 0.8;
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 200);
    // Portrait (mobile) framing: the horizontal FOV is narrow, so the
    // glovebox fills the width. Pull the camera back on portrait aspects
    // so the whole lab + Earth + ISS read in frame (2026-11-11: the
    // mobile shot showed the glovebox filling the frame). Exterior gets
    // 1.45x, interior only 1.15x (the scan needs to stay close).
    // Framing for a camera definition { view, pos, target }: the position
    // is scaled away from the target on portrait aspects. Used by the
    // initial framing, the view tween and every preset.
    const framingFor = (cam) => {
      const a = mount.clientWidth / mount.clientHeight;
      const s = a >= 1 ? 1 : (cam.view === 'interior' ? 1.15 : 1.45);
      return [
        cam.target[0] + (cam.pos[0] - cam.target[0]) * s,
        cam.target[1] + (cam.pos[1] - cam.target[1]) * s,
        cam.target[2] + (cam.pos[2] - cam.target[2]) * s,
      ];
    };
    camera.position.set(...framingFor(CAM_EXTERIOR));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = CAM_EXTERIOR.min;
    controls.maxDistance = CAM_EXTERIOR.max;
    controls.target.set(...CAM_EXTERIOR.target);
    // No auto-rotate: the composition is deliberate (Earth lower-left,
    // ISS upper-right, astronaut right of the station) and the demo video
    // needs stable framing. The user can still drag to rotate; the flame,
    // Earth spin and astronaut drift keep the scene alive.
    controls.autoRotate = false;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(4, 6, 3);
    scene.add(key);

    // --- HDRI environment (Poly Haven night sky, CC0) — environment ONLY,
    //     never the visible background. Gives the glass + metal real
    //     reflections and a key light. Loads async; the scene builds first
    //     and the reflections arrive when the HDR decodes. ---
    const texLoader = new THREE.TextureLoader();
    let envRT = null;
    let envCancelled = false;
    new RGBELoader().load(pub('hdr/qwantani_night_puresky_1k.hdr'), (tex) => {
      if (envCancelled) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromEquirectangular(tex);
      scene.environment = envRT.texture;
      tex.dispose();
      pmrem.dispose();
    });

    // --- Kenney sprites (CC0, white — tinted in-engine by O2) ---
    const texFlame05 = texLoader.load(pub('sprites/flame_05.png'));
    const texFlame01 = texLoader.load(pub('sprites/flame_01.png'));
    const texFlame02 = texLoader.load(pub('sprites/flame_02.png'));
    const texFire = texLoader.load(pub('sprites/fire_01.png'));
    const texSmoke = texLoader.load(pub('sprites/smoke_03.png'));
    const texLight = texLoader.load(pub('sprites/light_01.png'));
    // NOTE: star_04.png is NOT used for the starfield anymore (see the
    // procedural dot texture below) — the file stays on disk, unloaded.

    // --- Stars: DENSE, BRIGHT, varied sizes (2026-11-11, Ronit: the old
    //     300-star field was too faint to read as real space). Two clouds
    //     so the sky has both a dense faint field and bright big stars.
    //     PROCEDURAL soft-round-dot texture, NOT the Kenney star_04.png
    //     sparkle: the sparkle's energy lives in thin spikes, and at the
    //     small on-screen sizes mipmapping averages those spikes to
    //     nearly transparent — the field measured 0 bright pixels in a
    //     260x200 sky clip (max 17/255). A round dot spreads its energy
    //     over the whole sprite so it survives downsampling, and the
    //     texture is LinearFilter (no mipmaps) for the same reason. ---
    const makeStarTexture = () => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      return t;
    };
    const texStarDot = makeStarTexture();
    const mkStars = (count, size, opacity, rMin, rMax) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(Math.random() * 2 - 1);
        const r = rMin + Math.random() * (rMax - rMin);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        map: texStarDot, color: 0xffffff, size, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      return { pts, mat, baseOpacity: opacity };
    };
    const starField = mkStars(1400, 0.4, 0.9, 14, 45); // dense faint field
    const starBright = mkStars(250, 1.0, 1.0, 14, 35); // bright big stars
    const stars = starField.pts;
    const starMat = starField.mat;

    // --- EARTH (real Blue Marble textures, NASA-derived via three.js
    //     examples, MIT) — BIG in frame now (2026-11-11, Ronit: it was a
    //     sliver behind the old chamber base). Radius 6, low in frame,
    //     slow spin, night side glowing with city lights,
    //     blue atmosphere halo. ---
    const earthGroup = new THREE.Group();
    earthGroup.position.set(-8.5, -11.5, -10);
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(6.0, 48, 32),
      new THREE.MeshPhongMaterial({
        map: texLoader.load(pub('textures/earth-atmos-2048.jpg')),
        specularMap: texLoader.load(pub('textures/earth-specular-2048.jpg')),
        specular: new THREE.Color(0x333333),
        shininess: 18,
        normalMap: texLoader.load(pub('textures/earth-normal-2048.jpg')),
        normalScale: new THREE.Vector2(0.6, 0.6),
        emissiveMap: texLoader.load(pub('textures/earth-lights-2048.png')),
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.7,
      }),
    );
    earthGroup.add(earth);
    // Atmosphere halo: a slightly larger back-side additive shell + a big
    // soft blue glow sprite behind the globe.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(6.0 * 1.14, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x3b82f6, transparent: true, opacity: 0.12,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    earthGroup.add(halo);
    const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texLight, color: 0x60a5fa, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    earthGlow.scale.setScalar(6.0 * 3.1);
    earthGroup.add(earthGlow);
    scene.add(earthGroup);

    // --- MOON (real texture, same set) — small, far, up-right. ---
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 32, 24),
      new THREE.MeshPhongMaterial({ map: texLoader.load(pub('textures/moon-1024.jpg')), shininess: 4 }),
    );
    moon.position.set(-4.6, 3.2, -6.5); // upper-left, clear of the ISS
    scene.add(moon);

    // --- GLTF models: ISS + astronaut + (lazy) interior scan. Draco
    //     decoder is bundled locally under /draco/ — never CDN. ---
    const draco = new DRACOLoader();
    draco.setDecoderPath(pub('draco/'));
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(draco);
    let sceneCancelled = false;

    // ISS group — probed at mount: uperesito (CC-BY) if a human dropped it
    // in, else NASA's iss-a.glb (public domain). Silent on load failure.
    // Positioned upper-right of the default view, clear of the glass
    // panels — the visible canvas strip between the two overlay panels
    // is narrow, so off-axis placement hides it behind a panel.
    const issGroup = new THREE.Group();
    issGroup.position.set(-0.9, 1.7, -3.8);
    issGroup.rotation.y = -0.4;
    scene.add(issGroup);
    (async () => {
      const preferredExists = await probeModelUrl(ISS_PREFERRED_URL);
      const issUrl = resolveOptionalModel(
        ISS_PREFERRED_URL, ISS_FALLBACK_URL,
        (u) => u === ISS_PREFERRED_URL && preferredExists,
      );
      if (sceneCancelled) return;
      gltfLoader.load(issUrl, (gltf) => {
        if (sceneCancelled) return;
        normaliseGltf(gltf.scene, 2.6);
        issGroup.add(gltf.scene);
        markModelLoaded('iss');
      }, undefined, () => { /* silent — the scene works without the ISS */ });
    })();

    // Astronaut — "Animated Floating Astronaut" by LasquetiSpice (CC-BY,
    // Sketchfab, landed 2026-11-11). Natural relaxed floating pose with
    // a 7 s loop ("Animation", 165 tracks) — replaces NASA's T-pose GLB,
    // which read as a plastic mannequin. SMALL in frame, drifting near
    // the station, clear of the glovebox (the glovebox is interior-only
    // now, so the figure can never sit half-behind its glass — the old
    // transmission-glass ghost-twin problem is gone with the chamber).
    // The loop needs a THREE.AnimationMixer, ticked in
    // animate(); the clip's materials were converted spec/gloss →
    // metal/rough (three r187 dropped KHR_materials_pbrSpecularGlossiness).
    const astroGroup = new THREE.Group();
    astroGroup.position.set(2.6, 0.7, 1.6);
    astroGroup.rotation.z = 0.08;
    scene.add(astroGroup);
    let astroMixer = null;
    gltfLoader.load(pub('models/astronaut-floating-lasqueti.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 0.68);
      astroGroup.add(gltf.scene);
      if (gltf.animations && gltf.animations.length > 0) {
        const clip = gltf.animations.find((c) => c.name === 'Animation') || gltf.animations[0];
        astroMixer = new THREE.AnimationMixer(gltf.scene);
        astroMixer.clipAction(clip).play();
      }
      markModelLoaded('astronaut');
    }, undefined, () => { /* silent — the scene works without the figure */ });

    // Crew Dragon (dannzjs, CC-BY) — small recognisable capsule docked
    // just below-right of the ISS in the exterior view. Bobs in phase
    // with the ISS so the docked look holds (see animate). Sits high
    // enough (y 1.35) to read clearly against the station in screen space.
    const dragonGroup = new THREE.Group();
    dragonGroup.position.set(0.85, 1.35, -3.3);
    dragonGroup.rotation.y = 0.6;
    scene.add(dragonGroup);
    gltfLoader.load(pub('models/crew-dragon.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 0.75);
      dragonGroup.add(gltf.scene);
      markModelLoaded('dragon');
    }, undefined, () => { /* silent — the scene works without the Dragon */ });

    // JAXA Int-Ball (pergamond, CC-BY) — the real ISS interior drone, a
    // small floating prop for the interior view only. Eager-loaded at
    // mount (985 KB); hidden until the user switches inside.
    const intBallGroup = new THREE.Group();
    intBallGroup.position.set(1.35, 0.55, 1.1);
    intBallGroup.visible = false;
    scene.add(intBallGroup);
    gltfLoader.load(pub('models/intball-jaxa.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 0.42);
      intBallGroup.add(gltf.scene);
      markModelLoaded('intball');
    }, undefined, () => { /* silent — the scene works without the drone */ });

    // WAVE 2 (2026-11-11): three public-domain NASA models, all Draco +
    // WebP (the DRACOLoader above decodes them; no re-compression needed).
    // No new CC-BY credit owed — NASA public domain.
    // Space Shuttle (D) — payload bay doors OPEN (real on-orbit config),
    // docked near the ISS in the exterior view. Small in frame, not a
    // hero; bobs in phase with the ISS so the docked look holds.
    const shuttleGroup = new THREE.Group();
    shuttleGroup.position.set(-3.1, 1.1, -4.6);
    shuttleGroup.rotation.y = 0.9;
    shuttleGroup.rotation.z = 0.08;
    scene.add(shuttleGroup);
    gltfLoader.load(pub('models/nasa-shuttle-D.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 1.9);
      shuttleGroup.add(gltf.scene);
      markModelLoaded('shuttle');
    }, undefined, () => { /* silent — the scene works without the shuttle */ });

    // Canadarm (Remote Manipulator System) — along the ISS truss at the
    // left end, aligned with the station (rotation.y matches the ISS),
    // subtle. Bobs in phase with the ISS.
    const canadarmGroup = new THREE.Group();
    canadarmGroup.position.set(-2.3, 1.75, -3.85);
    canadarmGroup.rotation.y = -0.4;
    scene.add(canadarmGroup);
    gltfLoader.load(pub('models/nasa-canadarm.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 1.2);
      canadarmGroup.add(gltf.scene);
      markModelLoaded('canadarm');
    }, undefined, () => { /* silent — the scene works without the arm */ });

    // Lunar Reconnaissance Orbiter (A) — small distant satellite prop
    // near the Moon. Slow spin + gentle bob; exterior view only.
    const lroGroup = new THREE.Group();
    lroGroup.position.set(-2.9, 2.4, -5.8);
    scene.add(lroGroup);
    gltfLoader.load(pub('models/nasa-lro-A.glb'), (gltf) => {
      if (sceneCancelled) return;
      normaliseGltf(gltf.scene, 0.55);
      lroGroup.add(gltf.scene);
      markModelLoaded('lro');
    }, undefined, () => { /* silent — the scene works without the LRO */ });

    // ISS interior scan (patrick-, CC-BY) — lazy: the GLB itself loads
    // only the first time the user switches to the interior view, and a
    // load failure silently keeps the glovebox close-up (no probe — a
    // Range probe would double-download a possibly 20 MB scan on hosts
    // that ignore Range). Until it exists, the interior view is the
    // glovebox close-up (no broken state, no error).
    const interiorRef = { group: null, loading: false, loaded: false };
    const loadInteriorScan = () => {
      if (interiorRef.loading || interiorRef.loaded) return;
      interiorRef.loading = true;
      gltfLoader.load(INTERIOR_SCAN_URL, (gltf) => {
        if (sceneCancelled) return;
        const group = new THREE.Group();
        // Normalised to 21.8, NOT 9: the scan is a long thin corridor (raw
        // 15.26 long x ~3.5 diameter), and size 9 made it only ~2.1 wide —
        // narrower than the 3.6-wide rack cabinet, so the cabinet would
        // poke through the walls and racks would block the flame from every
        // side angle (raycast probe: diagonal sightlines hit at ~1.1
        // units). At 21.8 the corridor is ~5 wide, the cabinet fits
        // inside it with room, and the axis sightline is clear (probe:
        // 13.5+ units). See scripts/scan-raycast-probe.mjs for the
        // measurement.
        normaliseGltf(gltf.scene, 21.8);
        group.add(gltf.scene);
        // Photogrammetry scans get mushy up close — the camera stays at
        // module scale (see CAM_INTERIOR) and never pushes into the mesh.
        group.visible = stateRef.current.sceneView === 'interior';
        scene.add(group);
        interiorRef.group = group;
        interiorRef.loaded = true;
        markModelLoaded('interior');
      }, undefined, () => {
        interiorRef.loading = false; // silent — keep the close-up fallback
      });
    };

    // --- Rack-mounted glovebox (MSG-style) INSIDE the real station
    //     (2026-11-11, Ronit: "remove that giant box" — the floating glass
    //     aquarium is GONE from both views). The glovebox is a piece of
    //     station hardware: a dark metal rack cabinet set into the module
    //     wall, with the work volume recessed into its front face — two
    //     round glove ports + a control strip below the window, glass ONLY
    //     on the front face of the work volume. No glovebox model exists
    //     that passes the realistic + light bar, so it is code-built; the
    //     real ISS interior scan (lazy-loaded, see loadInteriorScan) is the
    //     room around it. The whole unit lives in gloveboxGroup, visible
    //     ONLY in the interior view — the exterior is just the station. ---
    const gloveboxGroup = new THREE.Group();
    gloveboxGroup.visible = stateRef.current.sceneView === 'interior';
    scene.add(gloveboxGroup);
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x232c3d, metalness: 0.75, roughness: 0.45 });
    const rackDarkMat = new THREE.MeshStandardMaterial({ color: 0x161d2a, metalness: 0.7, roughness: 0.55 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a465c, metalness: 0.85, roughness: 0.3 });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.2, roughness: 0.9 });
    // Cabinet shell — built from panels, NOT a solid box, so the work
    // volume is a real recess in the front face. 3.6 wide x 3.2 tall x
    // 1.6 deep, centre (0, -0.25, -0.8); front face at z = 0. Fits
    // inside the ~5-wide scan corridor with room on every side.
    const cabBack = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 0.08), rackMat);
    cabBack.position.set(0, -0.25, -1.56);
    const cabTop = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.6), rackMat);
    cabTop.position.set(0, 1.31, -0.8);
    const cabBottom = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.6), rackMat);
    cabBottom.position.set(0, -1.81, -0.8);
    const cabLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 1.6), rackMat);
    cabLeft.position.set(-1.76, -0.25, -0.8);
    const cabRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 1.6), rackMat);
    cabRight.position.set(1.76, -0.25, -0.8);
    // Front face: a frame around the window (opening 2.3 x 1.6, centre
    // (0, 0.25)) + the solid lower section that carries the control strip
    // and the glove ports. Front surface at z = 0.
    const frontTop = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 0.08), rackMat);
    frontTop.position.set(0, 1.2, -0.04);
    const frontLeft = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.6, 0.08), rackMat);
    frontLeft.position.set(-1.475, 0.25, -0.04);
    const frontRight = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.6, 0.08), rackMat);
    frontRight.position.set(1.475, 0.25, -0.04);
    const frontLower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.26, 0.08), rackMat);
    frontLower.position.set(0, -1.18, -0.04);
    gloveboxGroup.add(cabBack, cabTop, cabBottom, cabLeft, cabRight, frontTop, frontLeft, frontRight, frontLower);
    // Work volume interior: dark matte walls recessed behind the window
    // (back z = -1.5, sides x = +/-1.15, top y = 1.05, floor y = -0.55).
    const volBack = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 0.05), innerMat);
    volBack.position.set(0, 0.25, -1.5);
    const volLeft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 1.5), innerMat);
    volLeft.position.set(-1.125, 0.25, -0.78);
    const volRight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 1.5), innerMat);
    volRight.position.set(1.125, 0.25, -0.78);
    const volTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 1.5), innerMat);
    volTop.position.set(0, 1.025, -0.78);
    const volFloor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 1.5), innerMat);
    volFloor.position.set(0, -0.52, -0.78);
    gloveboxGroup.add(volBack, volLeft, volRight, volTop, volFloor);
    // Front glass — ONE pane over the window only (opacity ~0.06, plain
    // transparent, not transmission) + a slim metal frame around it.
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc, metalness: 0, roughness: 0.05,
      transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
      envMapIntensity: 1.5,
    });
    const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.6), glassMat);
    frontGlass.position.set(0, 0.25, 0.02);
    frontGlass.renderOrder = 3;
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.08, 0.06), trimMat);
    frameTop.position.set(0, 1.09, 0.01);
    const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.08, 0.06), trimMat);
    frameBottom.position.set(0, -0.59, 0.01);
    const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.76, 0.06), trimMat);
    frameLeft.position.set(-1.19, 0.25, 0.01);
    const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.76, 0.06), trimMat);
    frameRight.position.set(1.19, 0.25, 0.01);
    gloveboxGroup.add(frontGlass, frameTop, frameBottom, frameLeft, frameRight);
    // Control strip: a proud panel below the window with three status
    // dots, a tiny screen, and the atmosphere colour strip (replaces the
    // old ring around the chamber lid — the strip follows the atmosphere
    // colour, see animate).
    const ctrlPanel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 0.04), trimMat);
    ctrlPanel.position.set(0, -0.8, 0.02);
    const atmStripMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const atmStrip = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.02), atmStripMat);
    atmStrip.position.set(0, -0.68, 0.045);
    const dotGeo = new THREE.CircleGeometry(0.035, 16);
    const dotGreen = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    dotGreen.position.set(-0.8, -0.8, 0.045);
    const dotAmber = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
    dotAmber.position.set(-0.65, -0.8, 0.045);
    const dotBlue = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    dotBlue.position.set(-0.5, -0.8, 0.045);
    const ctrlScreen = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.4, roughness: 0.4, emissive: 0x1e3a5f, emissiveIntensity: 0.6 }),
    );
    ctrlScreen.position.set(0.7, -0.8, 0.045);
    gloveboxGroup.add(ctrlPanel, atmStrip, dotGreen, dotAmber, dotBlue, ctrlScreen);
    // TWO glove ports on the front face, below the control strip — the
    // signature of a real glovebox: a metal ring + a dark recessed circle.
    const portRingGeo = new THREE.TorusGeometry(0.27, 0.045, 10, 32);
    const portHoleGeo = new THREE.CircleGeometry(0.25, 32);
    const portHoleMat = new THREE.MeshBasicMaterial({ color: 0x05070a });
    for (const px of [-0.62, 0.62]) {
      const ring = new THREE.Mesh(portRingGeo, trimMat);
      ring.position.set(px, -1.3, 0.02);
      const hole = new THREE.Mesh(portHoleGeo, portHoleMat);
      hole.position.set(px, -1.3, 0.015);
      gloveboxGroup.add(ring, hole);
    }
    // Vent/label strip across the top of the front face.
    const ventPanel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.02), rackDarkMat);
    ventPanel.position.set(0, 1.2, 0.005);
    gloveboxGroup.add(ventPanel);

    // (The old atmosphere ring around the chamber lid is gone with the
    // chamber — the colour-coding now lives on the glovebox control strip,
    // see atmStripMat above and animate below.)

    // --- Sample: fabric swatch (solids) or droplet sphere, on a holder
    //     inside the work volume (floor top at y = -0.49). ---
    const holderMat = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.9, roughness: 0.35 });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.3, 16), holderMat);
    stand.position.set(0, -0.34, -0.7);
    const solidSample = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.05, 0.75),
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.9 }),
    );
    solidSample.position.set(0, -0.165, -0.7);
    const dropletSample = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 24, 16),
      new THREE.MeshPhongMaterial({ color: 0x22d3ee, shininess: 100, transparent: true, opacity: 0.95 }),
    );
    dropletSample.position.set(0, 0.0, -0.7);
    gloveboxGroup.add(stand, solidSample, dropletSample);

    // --- The flame: four Kenney-sprite particle clouds in a BALL
    //     (microgravity flames are spherical), tinted live by O2. ---
    const mkCloud = (texture, count, baseScale, size, opacity) => {
      const data = spherePoints(count, baseScale);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.pos.slice(), 3));
      const mat = new THREE.PointsMaterial({
        size, map: texture, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      gloveboxGroup.add(pts);
      return { pts, data, baseScale };
    };
    // Flame sprites are SMALL and DENSE so the cloud reads as ONE glowing
    // ball with texture — big sprites made the individual flame tongues
    // legible and the ball read as a swarm of small flames. The additive
    // glow envelope behind them binds the cloud together.
    const coreCloud = mkCloud(texFlame05, 140, 0.5, 0.22, 0.95); // bright core
    const mainCloud = mkCloud(texFlame05, 380, 1.0, 0.34, 0.75); // primary tongue
    const wisp1Cloud = mkCloud(texFlame01, 300, 1.0, 0.42, 0.5); // wispy variant
    const wisp2Cloud = mkCloud(texFlame02, 260, 1.0, 0.38, 0.5); // streak variant
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texLight, color: 0xf59e0b, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.copy(FLAME_CENTER);
    glow.scale.setScalar(2.4 * FLAME_VIS_SCALE);
    gloveboxGroup.add(glow);
    const flameLight = new THREE.PointLight(0xf59e0b, 3, 9, 1.5);
    flameLight.position.copy(FLAME_CENTER);
    gloveboxGroup.add(flameLight);

    // --- Ignition burst (fire_01): one-shot flash on material change or
    //     on re-ignition (O2 crossing 13% upward from near-extinction). ---
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFire, color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    burst.position.copy(FLAME_CENTER);
    burst.scale.setScalar(0.5 * FLAME_VIS_SCALE);
    gloveboxGroup.add(burst);
    let burstT = -1; // -1 = inactive, else 0..1 progress over 0.8 s

    // --- Smoke puffs (smoke_03): drift up slowly when the flame is near
    //     extinction (O2 <= 13%). Grey-blue, normal blending. ---
    const smokeGroup = new THREE.Group();
    const smokeSprites = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSmoke, color: 0x8ea2b8, transparent: true, opacity: 0, depthWrite: false }));
      smokeGroup.add(s);
      smokeSprites.push({
        sprite: s,
        angle: Math.random() * Math.PI * 2,
        radius: 0.3 + Math.random() * 0.6,
        speed: 0.12 + Math.random() * 0.2,
        phase: Math.random(),
      });
    }
    gloveboxGroup.add(smokeGroup);
    // --- Atmosphere haze (2026-11-11, Ronit: make the 34% story VISIBLE,
    //     not just a line of text): a subtle cloud of soft dots drifting
    //     in the cabin, calm blue at 21% O2 warming to amber at 34%.
    //     Interior view only; opacity stays low so the glovebox and the
    //     flame are never obscured. ---
    const hazeGroup = new THREE.Group();
    hazeGroup.visible = stateRef.current.sceneView === 'interior';
    scene.add(hazeGroup);
    const hazeCount = 220;
    const hazePos = new Float32Array(hazeCount * 3);
    for (let i = 0; i < hazeCount; i++) {
      hazePos[i * 3] = (Math.random() * 2 - 1) * 3.0;
      hazePos[i * 3 + 1] = (Math.random() * 2 - 1) * 2.2;
      hazePos[i * 3 + 2] = -3 + Math.random() * 7.5;
    }
    const hazeGeo = new THREE.BufferGeometry();
    hazeGeo.setAttribute('position', new THREE.BufferAttribute(hazePos, 3));
    const hazeMat = new THREE.PointsMaterial({
      size: 0.09, map: texStarDot, color: 0x3b82f6, transparent: true, opacity: 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const haze = new THREE.Points(hazeGeo, hazeMat);
    hazeGroup.add(haze);
    const hazeBlue = new THREE.Color('#3b82f6');
    const hazeAmber = new THREE.Color('#f59e0b');

    // Smooth state: the flame eases toward the slider targets instead of
    // snapping, so dragging a slider reads as the flame growing/shrinking.
    const cur = { radius: 0.4, elong: 1, brightness: 0.7, color: new THREE.Color('#f59e0b') };
    const targetColor = new THREE.Color();
    const prevRef = { o2: stateRef.current.o2, material: stateRef.current.material };

    // Camera fly-to tween. OrbitControls owns the camera the rest of the
    // time; during the tween it is disabled, then both come back. One
    // flyTo serves view changes, presets and zoom — the tween always
    // restarts from the CURRENT camera position, so a click mid-flight
    // never jumps.
    const tween = {
      active: false, t: 0, dur: 0.9, startT: 0,
      fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(),
      fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3(),
      min: 1.2, max: 16,
    };
    const flyTo = (toPos, toTgt, dur = 0.9, min = controls.minDistance, max = controls.maxDistance) => {
      const p = Array.isArray(toPos) ? new THREE.Vector3(...toPos) : toPos;
      const tg = Array.isArray(toTgt) ? new THREE.Vector3(...toTgt) : toTgt;
      tween.fromPos.copy(camera.position);
      tween.toPos.copy(p);
      tween.fromTgt.copy(controls.target);
      tween.toTgt.copy(tg);
      tween.t = 0;
      tween.dur = dur;
      // Wall-clock start (clock.elapsedTime, seconds): the tween must
      // take `dur` SECONDS, not `dur` worth of frames. dt is clamped to
      // 0.05/frame, so on a slow device (~0.5fps headless SwiftShader)
      // a dt-accumulated tween stretches to ~45s of wall time and the
      // camera crawls. Wall-clock progress lands on time everywhere.
      tween.startT = clock.elapsedTime;
      tween.active = true;
      controls.enabled = false;
      controls.autoRotate = false;
      // The tween path starts at the CURRENT radius, which may sit
      // outside [min, max] — exterior is 8.2 out while the interior caps
      // at 6. If the limits are set to the destination's now, the first
      // controls.update() clamps the radius and the camera POPS ~2 units
      // in one frame, then slides along the clamp sphere instead of
      // flying straight. So widen the limits to cover the whole path
      // while flying; the real limits are restored when the tween lands.
      const fromDist = camera.position.distanceTo(controls.target);
      const toDist = p.distanceTo(tg);
      controls.minDistance = Math.min(min, fromDist, toDist);
      controls.maxDistance = Math.max(max, fromDist, toDist);
      tween.min = min;
      tween.max = max;
    };
    const prevViewRef = { view: stateRef.current.sceneView };
    // Last camera command applied from the panel (zoom / preset), by
    // sequence number — a new seq means "do this once".
    const cmdRef = { seq: 0 };
    // Swap the visible world between Exterior (ISS + Earth + space) and
    // Inside (module scan + Int-Ball); lazy-loads the scan on first entry.
    const applyView = (interior) => {
      prevViewRef.view = interior ? 'interior' : 'exterior';
      earthGroup.visible = !interior;
      moon.visible = !interior;
      issGroup.visible = !interior;
      dragonGroup.visible = !interior;
      shuttleGroup.visible = !interior;
      canadarmGroup.visible = !interior;
      lroGroup.visible = !interior;
      intBallGroup.visible = interior;
      gloveboxGroup.visible = interior;
      hazeGroup.visible = interior;
      if (interiorRef.group) interiorRef.group.visible = interior;
      if (interior) loadInteriorScan();
    };

    const clock = new THREE.Clock();
    let raf = 0;
    const updateCloud = (cloud, radius, elong, flicker, t, shift) => {
      const attr = cloud.pts.geometry.getAttribute('position');
      const arr = attr.array;
      const { data } = cloud;
      for (let i = 0; i < data.phase.length; i++) {
        const ph = data.phase[i];
        const f = 1 + flicker * Math.sin(t * 7 + ph) + 0.5 * flicker * Math.sin(t * 13 + ph * 2);
        const r = radius * cloud.baseScale * f;
        arr[i * 3] = FLAME_CENTER.x + data.pos[i * 3] * r;
        arr[i * 3 + 1] = FLAME_CENTER.y + data.pos[i * 3 + 1] * r;
        arr[i * 3 + 2] = FLAME_CENTER.z + data.pos[i * 3 + 2] * r * elong + shift;
      }
      attr.needsUpdate = true;
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const s = stateRef.current;
      // Debug readout (like window.__spicaModels): the live camera
      // position + target, so a headless probe can verify a framing.
      if (typeof window !== 'undefined') {
        window.__spicaCam = {
          pos: camera.position.toArray().map((v) => +v.toFixed(2)),
          tgt: controls.target.toArray().map((v) => +v.toFixed(2)),
        };
      }
      const p = flameParams({ materialClass: s.materialClass, o2: s.o2, pressure: s.pressure, flow: s.flow });

      // Camera commands from the panel (zoom + presets) — handled BEFORE
      // the plain view change, so a preset click that also flips the view
      // flies straight to the preset framing instead of the default view
      // framing. A zoom dollies along the current view direction, clamped
      // to the current view's limits; it never changes the view.
      if (s.cameraCmd && s.cameraCmd.seq !== cmdRef.seq) {
        cmdRef.seq = s.cameraCmd.seq;
        const cmd = s.cameraCmd;
        if (cmd.kind === 'zoom-in' || cmd.kind === 'zoom-out') {
          const factor = cmd.kind === 'zoom-in' ? 0.8 : 1.25;
          const dist = camera.position.distanceTo(controls.target);
          const newDist = zoomDistance(dist, factor, controls.minDistance, controls.maxDistance);
          const dir = camera.position.clone().sub(controls.target).normalize();
          const newPos = controls.target.clone().add(dir.multiplyScalar(newDist));
          flyTo(newPos, controls.target.clone(), 0.45);
        } else if (cmd.kind === 'preset') {
          const preset = CAMERA_PRESETS[cmd.preset];
          if (preset) {
            const interior = preset.view === 'interior';
            if ((prevViewRef.view === 'interior') !== interior) applyView(interior);
            flyTo(framingFor(preset), preset.target, 0.9, preset.min, preset.max);
          }
        }
      }

      // Exterior / Interior view change (only when no preset command just
      // handled it — applyView already set prevViewRef then).
      if (s.sceneView !== prevViewRef.view) {
        const interior = s.sceneView === 'interior';
        applyView(interior);
        const cam = interior ? CAM_INTERIOR : CAM_EXTERIOR;
        flyTo(framingFor(cam), cam.target, 0.9, cam.min, cam.max);
      }

      // Camera tween (ease-in-out), then hand the camera back to OrbitControls.
      // Wall-clock progress (see flyTo): on a slow device a dt-accumulated
      // tween would stretch to tens of seconds; this lands in `dur` seconds.
      if (tween.active) {
        tween.t = (t - tween.startT) / tween.dur;
        const k = tween.t >= 1 ? 1 : (tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2);
        camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
        controls.target.lerpVectors(tween.fromTgt, tween.toTgt, k);
        if (tween.t >= 1) {
          tween.active = false;
          controls.enabled = true;
          // Restore the destination view's real zoom limits (flyTo
          // widened them to cover the flight path — see above). Widened
          // to contain the FRAMED distance too: portrait scaling can push
          // it past the declared max (Earth is 18.4 out on desktop but
          // ~26.7 on a phone), and the landing limits must never clamp
          // the framing the preset just flew to.
          const landDist = tween.toPos.distanceTo(tween.toTgt);
          controls.minDistance = Math.min(tween.min, landDist);
          controls.maxDistance = Math.max(tween.max, landDist);
          // autoRotate stays off (see above) — the tween only flies the
          // camera between the exterior and interior framings.
        }
      }

      // Ignition burst triggers.
      if (s.material !== prevRef.material || (prevRef.o2 <= 13 && s.o2 > 13)) burstT = 0;
      prevRef.o2 = s.o2;
      prevRef.material = s.material;
      if (burstT >= 0) {
        burstT += dt / 0.8;
        if (burstT >= 1) {
          burstT = -1;
          burst.material.opacity = 0;
        } else {
          burst.scale.setScalar((0.5 + burstT * 2.3) * FLAME_VIS_SCALE);
          burst.material.opacity = 0.85 * (1 - burstT);
        }
      }

      // Ease toward targets (fast enough to feel live, slow enough to read).
      const k = 1 - Math.exp(-dt * 6);
      cur.radius += (p.radius - cur.radius) * k;
      cur.elong += (p.elong - cur.elong) * k;
      cur.brightness += (p.brightness - cur.brightness) * k;
      targetColor.set(p.color);
      cur.color.lerp(targetColor, k);

      // Near extinction the flame is a FAINT dim blue ball, not a bright
      // sparkle: dim the core and the glow envelope, and calm the flicker
      // (v1 nit fix — the twinkling read as a purple sparkle ball). The
      // wispy clouds get the strongest calming: at low O2 their big
      // individual tongues were the sparkle — nearly hidden, smaller and
      // steadier, the ball is the dense core + glow only. The main cloud
      // is dimmed too so no single tongue legibly spikes out.
      const dim = p.nearExtinct ? 0.45 : 1;
      const calm = p.nearExtinct ? 0.55 : 1;
      updateCloud(coreCloud, cur.radius * 0.62 * FLAME_VIS_SCALE, cur.elong, p.flicker, t, p.flowShift * 0.5 * FLAME_VIS_SCALE);
      updateCloud(mainCloud, cur.radius * FLAME_VIS_SCALE, cur.elong, p.flicker, t, p.flowShift * FLAME_VIS_SCALE);
      updateCloud(wisp1Cloud, cur.radius * FLAME_VIS_SCALE, cur.elong, p.flicker * calm, t, p.flowShift * FLAME_VIS_SCALE);
      updateCloud(wisp2Cloud, cur.radius * FLAME_VIS_SCALE, cur.elong, p.flicker * calm, t, p.flowShift * FLAME_VIS_SCALE);
      coreCloud.pts.material.opacity = (0.55 + 0.4 * cur.brightness) * dim;
      // At near-extinction the tongue sprites are the sparkle: fade the
      // main cloud hard and shrink every tongue so nothing legibly spikes
      // out — the ball is the dense core + the soft round glow only.
      mainCloud.pts.material.opacity = p.nearExtinct
        ? 0.15
        : 0.45 + 0.35 * cur.brightness;
      mainCloud.pts.material.size = (p.nearExtinct ? 0.22 : 0.34) * FLAME_SPRITE_SCALE;
      coreCloud.pts.material.size = (p.nearExtinct ? 0.16 : 0.22) * FLAME_SPRITE_SCALE;
      wisp1Cloud.pts.material.opacity = (0.3 + 0.25 * cur.brightness) * (p.nearExtinct ? 0.12 : 1);
      wisp2Cloud.pts.material.opacity = (0.3 + 0.25 * cur.brightness) * (p.nearExtinct ? 0.12 : 1);
      wisp1Cloud.pts.material.size = 0.42 * FLAME_SPRITE_SCALE * (p.nearExtinct ? 0.6 : 1);
      wisp2Cloud.pts.material.size = 0.38 * FLAME_SPRITE_SCALE * (p.nearExtinct ? 0.6 : 1);
      mainCloud.pts.material.color.copy(cur.color);
      wisp1Cloud.pts.material.color.copy(cur.color);
      wisp2Cloud.pts.material.color.copy(cur.color);
      coreCloud.pts.material.color.set('#fff7d6').lerp(cur.color, p.nearExtinct ? 0.15 : 0.35);
      glow.material.color.copy(cur.color);
      glow.material.opacity = (0.28 + 0.22 * cur.brightness) * dim * (p.nearExtinct ? 1.6 : 1);
      glow.scale.setScalar(cur.radius * (p.nearExtinct ? 6.0 : 4.2) * FLAME_VIS_SCALE);
      flameLight.color.copy(cur.color);
      flameLight.intensity = 1.2 + cur.brightness * 2.4;

      // Smoke: only when near extinction; puffs rise from the flame top and
      // fade in a loop. Big and grey-blue enough to actually be seen.
      for (const sp of smokeSprites) {
        const m = sp.sprite.material;
        const rise = ((t * sp.speed + sp.phase) % 1.7);
        sp.sprite.position.set(
          FLAME_CENTER.x + Math.cos(sp.angle) * sp.radius * FLAME_VIS_SCALE * (0.6 + 0.3 * Math.sin(t + sp.phase * 6)),
          FLAME_CENTER.y + 0.1 * FLAME_VIS_SCALE + rise * FLAME_VIS_SCALE,
          FLAME_CENTER.z + Math.sin(sp.angle) * sp.radius * FLAME_VIS_SCALE,
        );
        sp.sprite.scale.setScalar((0.8 + rise * 0.5) * FLAME_VIS_SCALE);
        // Fade with height, visible only when near extinction.
        m.opacity = p.nearExtinct ? 0.45 * (1 - rise / 1.7) : 0;
      }

      // Sample visibility follows the material class.
      solidSample.visible = s.materialClass === 'solid';
      dropletSample.visible = s.materialClass === 'droplet';
      stand.visible = s.materialClass !== 'gas';

      // Atmosphere strip colour (on the glovebox control strip) + haze
      // colour follow the selected atmosphere / O2. The haze is calm blue
      // at 21% O2, warming to amber at 34% — visible, never obscuring.
      const atm = ATMOSPHERES[s.atmosphereKey];
      atmStripMat.color.set(atm ? atm.color : '#94a3b8');
      const hazeT = Math.min(1, Math.max(0, (s.o2 - 10) / 30));
      hazeMat.color.copy(hazeBlue).lerp(hazeAmber, hazeT);
      hazeMat.opacity = 0.06 + hazeT * 0.05;
      hazeGroup.rotation.y = t * 0.008;
      hazeGroup.position.y = Math.sin(t * 0.12) * 0.12;
      starMat.opacity = starField.baseOpacity * (0.9 + 0.1 * Math.sin(t * 0.8));
      starBright.mat.opacity = starBright.baseOpacity * (0.85 + 0.15 * Math.sin(t * 1.3 + 1));
      earth.rotation.y = t * 0.02;
      issGroup.position.y = 1.7 + Math.sin(t * 0.35) * 0.05;
      dragonGroup.position.y = 1.35 + Math.sin(t * 0.35) * 0.05;
      shuttleGroup.position.y = 1.1 + Math.sin(t * 0.35) * 0.05;
      canadarmGroup.position.y = 1.75 + Math.sin(t * 0.35) * 0.05;
      lroGroup.position.y = 2.4 + Math.sin(t * 0.4) * 0.06;
      lroGroup.rotation.y = t * 0.15;
      astroGroup.position.y = 0.7 + Math.sin(t * 0.5) * 0.07;
      astroGroup.rotation.y = t * 0.12;
      if (astroMixer) astroMixer.update(dt);
      intBallGroup.position.y = 0.55 + Math.sin(t * 0.6) * 0.08;
      intBallGroup.rotation.y = t * 0.3;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      envCancelled = true;
      sceneCancelled = true;
      if (envRT) envRT.dispose();
      controls.dispose();
      draco.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [webglOK]);

  if (!webglOK) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-black/60 p-6 text-center">
        <p className="text-base font-semibold text-slate-200">The 3D fire lab needs WebGL</p>
        <p className="max-w-[420px] text-sm text-slate-400">
          This device cannot run the 3D fire lab. The sliders and the safety
          verdict still work — the verdicts come from real NASA PSI test
          data, not from the 3D view.
        </p>
      </div>
    );
  }

  // Minimal rebuild (2026-11-11): the canvas is the whole app — no
  // in-canvas labels. The title, the CAMERA section in the panel and the
  // single control panel live in App.jsx; the honesty + credits lines live
  // in the panel.
  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}

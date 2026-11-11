// Blur investigation for the FULL-STATION tour — UI-reachability map,
// LEAN (pure geometry, no WebGL). Adapted from clamp-sphere-map.mjs:
// loads the Academy tour GLB, applies the app's Destiny placement
// (scale so Destiny's width is 5.0, rotY -90deg, Destiny centre to the
// origin — MUST match destinyInteriorTransform() in FireLab3D.jsx),
// then samples camera positions on spheres around the Inside target
// [0, 0.1, -0.7] at OrbitControls radii 1.2 / 3 / 5.3 / 6 / 9. For each
// pose, raycasts the view cone (forward + 8 rays within 35 deg) and
// records the nearest tour surface. Results stream to
// clamp-sphere-map-tour-results.txt as each radius completes.
import * as THREE from 'three';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const OUT = '/home/hatch/workspace/blur-investigation/clamp-sphere-map-tour-results.txt';
const GLB = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/public/models/academy-iss-interior.glb';
const TARGET = new THREE.Vector3(0, 0.1, -0.7);
// Wall clamp under test — MUST match INTERIOR_CLAMP /
// clampInteriorCamera in src/components/FireLab3D.jsx. Env overrides
// (CLAMP_LAT, CLAMP_KNEE, CLAMP_ZMIN, CLAMP_ZMAX) for tuning sweeps.
const CLAMP = {
  lateral: +(process.env.CLAMP_LAT ?? 1.0),
  knee: +(process.env.CLAMP_KNEE ?? 3),
  mountLateral: +(process.env.CLAMP_MOUNT_LAT ?? 0.55),
  mountZMax: +(process.env.CLAMP_MOUNT_ZMAX ?? 2.5),
  zMin: +(process.env.CLAMP_ZMIN ?? 0.3),
  zMax: +(process.env.CLAMP_ZMAX ?? 5.5),
};
function clampCam(v) {
  const ox = v.x - TARGET.x, oy = v.y - TARGET.y, oz = v.z - TARGET.z;
  const R = Math.hypot(ox, oy, oz);
  if (R < 1e-9) return TARGET.clone();
  const lat = Math.hypot(ox, oy);
  const zCapped = Math.min(CLAMP.zMax, Math.max(CLAMP.zMin, v.z));
  const nearCap = zCapped <= CLAMP.mountZMax ? CLAMP.mountLateral : CLAMP.lateral;
  const cap = Math.min(nearCap, (CLAMP.lateral * CLAMP.knee) / R, R);
  let nx = ox, ny = oy, nz = oz;
  if (lat > cap && lat > 1e-9) {
    const k = cap / lat;
    nx = ox * k; ny = oy * k;
    nz = Math.sign(oz || 1) * Math.sqrt(Math.max(0, R * R - cap * cap));
  }
  const z = Math.min(CLAMP.zMax, Math.max(CLAMP.zMin, TARGET.z + nz));
  return new THREE.Vector3(TARGET.x + nx, TARGET.y + ny, z);
}
writeFileSync(OUT, 'clamp sphere-map (TOUR) — camera positions projected through the clamp first\n');

const buf = readFileSync(GLB);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;

function accessorArray(accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const compSize = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[acc.componentType];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[acc.componentType];
  const stride = bv.byteStride || compSize * nComp;
  if (stride === compSize * nComp) return new Ctor(buf.buffer, buf.byteOffset + off, acc.count * nComp);
  const out = new Ctor(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < nComp; c++) out[i * nComp + c] = buf.readFloatLE(off + i * stride + c * compSize);
  return out;
}
function nodeMatrix(node) {
  const m = new THREE.Matrix4();
  if (node.matrix) { m.fromArray(node.matrix); return m; }
  const t = node.translation || [0, 0, 0];
  const q = node.rotation ? new THREE.Quaternion(...node.rotation) : new THREE.Quaternion();
  const s = node.scale || [1, 1, 1];
  m.compose(new THREE.Vector3(...t), q, new THREE.Vector3(...s));
  return m;
}
const geoms = [];
function walk(nodeIdx, parentMatrix) {
  const node = json.nodes[nodeIdx];
  const world = parentMatrix.clone().multiply(nodeMatrix(node));
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      const pos = accessorArray(prim.attributes.POSITION);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(accessorArray(prim.indices).slice(), 1));
      geo.applyMatrix4(world);
      geoms.push(geo);
    }
  }
  for (const child of node.children || []) walk(child, world);
}
walk(json.scenes[0].nodes[0], new THREE.Matrix4());

// Destiny placement — MUST match destinyInteriorTransform() in
// src/components/FireLab3D.jsx (same constants, same composition).
const DESTINY_CENTER = new THREE.Vector3(63.32, 0.30, -33.75);
const SCALE = 5.0 / 33.74;
const scaled = DESTINY_CENTER.clone().multiplyScalar(SCALE);
const rotated = scaled.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const destMat = new THREE.Matrix4().compose(
  rotated.negate(),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  new THREE.Vector3(SCALE, SCALE, SCALE),
);
for (const g of geoms) g.applyMatrix4(destMat);

// Destiny's placed bounds (sanity: x ±2.50, y ±3.18, z ±6.21).
const dbox = new THREE.Box3();
for (const g of geoms) { g.computeBoundingBox(); dbox.union(g.boundingBox); }
const ddims = dbox.getSize(new THREE.Vector3());
console.log(`placed station dims x=${ddims.x.toFixed(2)} y=${ddims.y.toFixed(2)} z=${ddims.z.toFixed(2)}`);

// Total surface area (placed units) + triangle count + texture pixels.
let area = 0; let tris = 0;
{
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
  for (const g of geoms) {
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const n = idx ? idx.count / 3 : pos.count / 3;
    tris += n;
    for (let i = 0; i < n; i++) {
      const ia = idx ? idx.getX(i * 3) : i * 3, ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      ab.subVectors(b, a); ac.subVectors(c, a); cr.crossVectors(ab, ac);
      area += 0.5 * cr.length();
    }
  }
}
// Texture pixels: 30 per-module PNGs (IHDR width/height from the BIN chunk).
let texPixels = 0; let texCount = 0;
for (const img of json.images || []) {
  const bv = json.bufferViews[img.bufferView];
  const off = binStart + (bv.byteOffset || 0);
  if (buf[off] === 0x89 && buf.toString('ascii', off + 1, off + 4) === 'PNG') {
    const w = buf.readUInt32BE(off + 16);
    const h = buf.readUInt32BE(off + 20);
    texPixels += w * h; texCount++;
  }
}
const line1 = `placed dims x=${ddims.x.toFixed(2)} y=${ddims.y.toFixed(2)} z=${ddims.z.toFixed(2)} | tris=${tris} | surface area=${area.toFixed(1)} sq units | textures=${texCount} totalling ${(texPixels / 1e6).toFixed(1)}M px | texels/unit^2=${(texPixels / area).toFixed(0)} (linear ${Math.sqrt(texPixels / area).toFixed(0)}/unit)`;
console.log(line1);
appendFileSync(OUT, line1 + '\n');

const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const meshes = geoms.map((g) => new THREE.Mesh(g, mat));
const ray = new THREE.Raycaster();
ray.far = 100;

function coneDirs(fwd) {
  const dirs = [fwd.clone()];
  const up = Math.abs(fwd.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 0.55; // sin(33deg) — edge of the view cone
    dirs.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize());
  }
  return dirs;
}

for (const R of [1.2, 3, 5.3, 6, 9]) {
  const N = 150;
  let mush = 0, soft = 0, ok = 0;
  const worst = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    const cam = clampCam(TARGET.clone().addScaledVector(dir, R));
    const fwd = TARGET.clone().sub(cam).normalize();
    let minD = Infinity;
    for (const d of coneDirs(fwd)) {
      ray.set(cam, d);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length && hits[0].distance < minD) minD = hits[0].distance;
    }
    if (minD < 0.5) { mush++; worst.push({ minD: +minD.toFixed(3), cam: cam.toArray().map((v) => +v.toFixed(2)) }); }
    else if (minD < 1.0) soft++;
    else ok++;
  }
  worst.sort((a, b) => a.minD - b.minD);
  const line = `RADIUS ${R}: mush(<0.5u) ${mush}/${N} (${(100 * mush / N).toFixed(0)}%), soft(0.5-1u) ${soft}, ok(>1u) ${ok} | worst: ${worst.slice(0, 3).map((w) => `${w.minD}u @(${w.cam.join(',')})`).join(' ; ')}`;
  console.log(line);
  appendFileSync(OUT, line + '\n');
}
console.log('DONE');
appendFileSync(OUT, 'DONE\n');

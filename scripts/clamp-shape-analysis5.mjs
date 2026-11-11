// Clamp-shape analysis v4 — cone-p1.0 (the only shape with 0 central
// mush at R<=6) plus a z-cap to fix R9. v3 showed R9 mush clusters at
// the corridor ends (z ~ +8.3 and ~ -9.6) where end structures protrude
// near the axis — no lateral cap can avoid them, because the camera at
// R9 sits at z ~ +-8-9.7 no matter the lateral. A z-cap keeps the
// camera off the end structures; the radius then settles where the wall
// is (a wall collision, not a zoom bug). Tests three z-caps.
import * as THREE from 'three';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const OUT = '/home/hatch/workspace/blur-investigation/clamp-shape-results5.txt';
const GLB = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/public/models/iss-interior-scan.glb';
const TARGET = new THREE.Vector3(0, 0.1, -0.7);
writeFileSync(OUT, 'clamp-shape analysis v4 run (cone-p1.0 + tighter z-cap)\n');

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
const box = new THREE.Box3();
for (const g of geoms) { g.computeBoundingBox(); box.union(g.boundingBox); }
const dims = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
const scale = 21.8 / Math.max(dims.x, dims.y, dims.z);
const norm = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
for (const g of geoms) g.applyMatrix4(norm);
const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const meshes = geoms.map((g) => new THREE.Mesh(g, mat));
const ray = new THREE.Raycaster();
ray.far = 100;
function raysFor(fwd) {
  const up = Math.abs(fwd.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const mk = (deg, n) => {
    const r = Math.tan((deg * Math.PI) / 180);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize());
    }
    return out;
  };
  return { central: [fwd.clone(), ...mk(15, 4)], edge: mk(33, 8) };
}
const RADII = [1.2, 3, 5.3, 6, 9];
const positions = [];
for (const R of RADII) {
  const N = 150;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    positions.push({ R, cam: TARGET.clone().addScaledVector(dir, R) });
  }
}
// cone-p1.0 lateral cap (1.2 for R<=3, else 3.6/R) + z-cap. Lateral cap
// first (radius-preserving), then the z-cap (radius settles at the wall).
function makeClamp(zCap) {
  return (v) => {
    const ox = v.x - TARGET.x, oy = v.y - TARGET.y, oz = v.z - TARGET.z;
    const R = Math.hypot(ox, oy, oz);
    const lat = Math.hypot(ox, oy);
    const cap = Math.min(R <= 3 ? 1.2 : 3.6 / R, R);
    const out = v.clone();
    if (lat > cap && lat > 1e-9) {
      const k = cap / lat;
      out.x = TARGET.x + ox * k;
      out.y = TARGET.y + oy * k;
      out.z = TARGET.z + Math.sign(oz || 1) * Math.sqrt(Math.max(0, R * R - cap * cap));
    }
    out.z = Math.min(zCap, Math.max(-zCap, out.z));
    return out;
  };
}
const CANDIDATES = [
  ['cone-p1.0+z6.0', makeClamp(6.0)],
  ['cone-p1.0+z6.5', makeClamp(6.5)],
];
for (const [name, clamp] of CANDIDATES) {
  const per = {};
  for (const R of RADII) per[R] = { cMush: 0, cSoft: 0, eMush: 0, outside: 0, moved: 0, worstC: [] };
  for (const { R, cam } of positions) {
    const c = clamp(cam);
    const fwd = TARGET.clone().sub(c).normalize();
    const { central, edge } = raysFor(fwd);
    let minC = Infinity, minE = Infinity;
    for (const d of central) {
      ray.set(c, d);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length && hits[0].distance < minC) minC = hits[0].distance;
    }
    for (const d of edge) {
      ray.set(c, d);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length && hits[0].distance < minE) minE = hits[0].distance;
    }
    const b = per[R];
    if (c.distanceTo(cam) > 0.05) b.moved++;
    if (minC < 0.5) { b.cMush++; b.worstC.push({ minC: +minC.toFixed(3), cam: c.toArray().map((v) => +v.toFixed(2)) }); }
    else if (minC < 1.0) b.cSoft++;
    if (minE < 0.5) b.eMush++;
    if (Math.abs(c.x) > 2.47 || Math.abs(c.y) > 2.6 || Math.abs(c.z) > 10.9) b.outside++;
  }
  for (const R of RADII) {
    const b = per[R];
    b.worstC.sort((a, c) => a.minC - c.minC);
    const line = `${name} RADIUS ${R}: CENTRAL-mush ${b.cMush}/150, central-soft ${b.cSoft}, EDGE-mush ${b.eMush}/150, outside ${b.outside}, moved ${b.moved}/150 | worst-central: ${b.worstC.slice(0, 3).map((w) => `${w.minC}u @(${w.cam.join(',')})`).join(' ; ')}`;
    console.log(line);
    appendFileSync(OUT, line + '\n');
  }
}
console.log('DONE');
appendFileSync(OUT, 'DONE\n');

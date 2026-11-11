// Clamp-shape analysis — finds a camera clamp with ~0 mush directions.
// Same sampling as sphere-map-lean (150 directions x radii 1.2/3/6/9,
// 9-ray view cone), but each candidate clamp is applied to the sampled
// camera position BEFORE raycasting, exactly as the app does per-frame.
// Candidates: cylinders around the corridor axis (line x=0, y=0.1,
// parallel to z) with optional z caps. The box clamp from the first
// attempt FAILED here (its corners stick into the racks: R6 26% mush,
// R9 33% mush — worse than unclamped), so the shape must have no
// corners. Results stream to clamp-shape-results.txt.
import * as THREE from 'three';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const OUT = '/home/hatch/workspace/blur-investigation/clamp-shape-results.txt';
const GLB = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/public/models/iss-interior-scan.glb';
const TARGET = new THREE.Vector3(0, 0.1, -0.7);
writeFileSync(OUT, 'clamp-shape analysis run\n');

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

function coneDirs(fwd) {
  const dirs = [fwd.clone()];
  const up = Math.abs(fwd.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 0.55;
    dirs.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize());
  }
  return dirs;
}

// Sampled camera positions (same Fibonacci sphere as the lean run).
const positions = [];
for (const R of [1.2, 3, 6, 9]) {
  const N = 150;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    positions.push({ R, cam: TARGET.clone().addScaledVector(dir, R) });
  }
}

// Candidate clamps: cylinder around the axis line x=0, y=0.1 (parallel
// to z), with an optional z cap. Projection scales the lateral offset
// toward the axis, so the camera slides along the cylinder wall.
function cylClamp(r, zMax) {
  return (v) => {
    const dx = v.x - TARGET.x;
    const dy = v.y - TARGET.y;
    const lat = Math.hypot(dx, dy);
    const out = v.clone();
    if (lat > r) {
      const k = r / lat;
      out.x = TARGET.x + dx * k;
      out.y = TARGET.y + dy * k;
    }
    if (zMax !== undefined) out.z = Math.min(zMax, Math.max(-9.9, out.z));
    else out.z = Math.min(9.9, Math.max(-9.9, out.z));
    return out;
  };
}
const CANDIDATES = [
  ['cyl-1.2', cylClamp(1.2)],
  ['cyl-1.0', cylClamp(1.0)],
  ['cyl-1.2-z8', cylClamp(1.2, 8.0)],
  ['cyl-1.2-z8.5', cylClamp(1.2, 8.5)],
];

for (const [name, clamp] of CANDIDATES) {
  const per = {};
  for (const R of [1.2, 3, 6, 9]) per[R] = { mush: 0, soft: 0, ok: 0, worst: [] };
  for (const { R, cam } of positions) {
    const c = clamp(cam);
    const fwd = TARGET.clone().sub(c).normalize();
    let minD = Infinity;
    for (const d of coneDirs(fwd)) {
      ray.set(c, d);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length && hits[0].distance < minD) minD = hits[0].distance;
    }
    const bucket = per[R];
    if (minD < 0.5) { bucket.mush++; bucket.worst.push({ minD: +minD.toFixed(3), cam: c.toArray().map((v) => +v.toFixed(2)) }); }
    else if (minD < 1.0) bucket.soft++;
    else bucket.ok++;
  }
  for (const R of [1.2, 3, 6, 9]) {
    const b = per[R];
    b.worst.sort((a, c) => a.minD - c.minD);
    const line = `${name} RADIUS ${R}: mush ${b.mush}/150 (${(100 * b.mush / 150).toFixed(0)}%), soft ${b.soft}, ok ${b.ok} | worst: ${b.worst.slice(0, 3).map((w) => `${w.minD}u @(${w.cam.join(',')})`).join(' ; ')}`;
    console.log(line);
    appendFileSync(OUT, line + '\n');
  }
}
console.log('DONE');
appendFileSync(OUT, 'DONE\n');

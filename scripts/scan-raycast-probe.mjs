// Raycast probe: find camera directions with a CLEAR sightline to the flame
// through the ISS interior scan. Reads the scan GLB directly (no WebGL —
// pure geometry + THREE.Raycaster in Node), replicates the app's
// normaliseGltf(size 9, centred at origin), then samples directions on a
// sphere around the flame centre and reports which ones are unobstructed.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const GLB = '/home/hatch/workspace/goals/hackathon-registration-drive/projects/nasa-spica-flame/app/public/models/iss-interior-scan.glb';
const FLAME = new THREE.Vector3(0, -0.15, 0);

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
  if (stride === compSize * nComp) {
    return new Ctor(buf.buffer, buf.byteOffset + off, acc.count * nComp);
  }
  // Interleaved — de-interleave.
  const out = new Ctor(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nComp; c++) {
      const src = buf.readFloatLE(off + i * stride + c * compSize);
      out[i * nComp + c] = src;
    }
  }
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

// Walk the node tree, collect world-transformed geometries.
const geoms = [];
function walk(nodeIdx, parentMatrix) {
  const node = json.nodes[nodeIdx];
  const world = parentMatrix.clone().multiply(nodeMatrix(node));
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      const posAcc = json.accessors[prim.attributes.POSITION];
      const pos = accessorArray(prim.attributes.POSITION);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      if (prim.indices !== undefined) {
        const idx = accessorArray(prim.indices);
        geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
      }
      geo.applyMatrix4(world);
      geoms.push(geo);
      console.log(`mesh ${node.mesh} prim: ${posAcc.count} verts, ${prim.indices !== undefined ? json.accessors[prim.indices].count : 'no-index'} idx`);
    }
  }
  for (const child of node.children || []) walk(child, world);
}
walk(json.scenes[0].nodes[0], new THREE.Matrix4());

// Replicate the app's normaliseGltf(size 9): longest side -> 9, centre at origin.
// NORM_MULT scales the whole scan up (the app's size-9 normalisation makes
// the corridor only ~2.1 wide — narrower than the 3.2-wide chamber, so the
// chamber pokes through the walls; mult 2.42 -> size 21.8 -> ~5.0 diameter).
const NORM_MULT = parseFloat(process.argv[2] || '1');
const CAM_DIST = parseFloat(process.argv[3] || '3.0');
const box = new THREE.Box3();
for (const g of geoms) { g.computeBoundingBox(); box.union(g.boundingBox); }
const dims = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
const maxDim = Math.max(dims.x, dims.y, dims.z);
const scale = (9 * NORM_MULT) / maxDim;
console.log(`scan bbox raw dims: x=${dims.x.toFixed(2)} y=${dims.y.toFixed(2)} z=${dims.z.toFixed(2)} (longest ${maxDim.toFixed(2)}), centre=(${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}, ${centre.z.toFixed(2)}), scale=${scale.toFixed(3)} -> normalised dims x=${(dims.x * scale).toFixed(2)} y=${(dims.y * scale).toFixed(2)} z=${(dims.z * scale).toFixed(2)}`);
const norm = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z).premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
for (const g of geoms) g.applyMatrix4(norm);

const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const meshes = geoms.map((g) => new THREE.Mesh(g, mat));
const ray = new THREE.Raycaster();

// Sightline test: camera at flame + dir*dist, looking at the flame. Clear
// if the first scan hit is further than (dist - 0.6) — i.e. nothing within
// the flame ball's neighbourhood on the way in.
function clearance(dir, dist) {
  const cam = FLAME.clone().addScaledVector(dir, dist);
  ray.set(cam, FLAME.clone().sub(cam).normalize());
  const hits = ray.intersectObjects(meshes, false);
  return hits.length === 0 ? Infinity : hits[0].distance;
}

// Fibonacci sphere sampling at CAM_DIST.
const N = 400;
const results = [];
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = Math.PI * (1 + Math.sqrt(5)) * i;
  const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
  const c = clearance(dir, CAM_DIST);
  const clear = c > CAM_DIST - 0.6;
  const az = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
  const el = (Math.asin(dir.y) * 180) / Math.PI;
  results.push({ dir, clear, hitDist: c, az, el });
}
const clearDirs = results.filter((r) => r.clear).sort((a, b) => b.hitDist - a.hitDist);
console.log(`\n${clearDirs.length}/${N} sampled directions are CLEAR at ${CAM_DIST} units (hit > ${(CAM_DIST - 0.6).toFixed(1)} from camera)`);
for (const r of clearDirs.slice(0, 15)) {
  const pos = FLAME.clone().addScaledVector(r.dir, CAM_DIST);
  console.log(`  CLEAR az=${r.az.toFixed(0)}° el=${r.el.toFixed(0)}° hit=${r.hitDist === Infinity ? 'none' : r.hitDist.toFixed(2)} -> cam pos (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
}
// Check the current + hand-picked candidate camera directions.
console.log('\nCandidate directions (from flame):');
for (const [name, v] of [
  ['axis +Z [0.1,0.25,5.0]', [0.1, 0.25, 5.0]],
  ['axis -Z [0.1,0.25,-5.0]', [0.1, 0.25, -5.0]],
  ['axis +Z low [0.0,-0.05,5.0]', [0.0, 0.1, 5.0]],
  ['diag [1.4,0.6,2.3]', [1.4, 0.6, 2.3]],
  ['diag mirror [-1.4,0.6,2.3]', [-1.4, 0.6, 2.3]],
  ['from above [0.3,2.75,1.4]', [0.3, 2.75, 1.4]],
]) {
  const dir = new THREE.Vector3(...v).normalize();
  const dist = new THREE.Vector3(...v).length();
  const c = clearance(dir, dist);
  console.log(`  ${name}: dist=${dist.toFixed(2)} firstHit=${c === Infinity ? 'none' : c.toFixed(2)} ${c > dist - 0.6 ? 'CLEAR' : 'BLOCKED'}`);
}

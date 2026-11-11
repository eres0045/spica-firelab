// Exact nearest-surface distance from key camera poses to the scan mesh
// (brute-force closestPointToPoint over all triangles — offline only).
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GLB = join(here, '..', 'public', 'models', 'iss-interior-scan.glb');
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

// Flatten all triangles once.
const tris = [];
{
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  for (const g of geoms) {
    const pos = g.getAttribute('position');
    const ix = g.getIndex();
    const n = ix ? ix.count / 3 : pos.count / 3;
    for (let t = 0; t < n; t++) {
      v0.fromBufferAttribute(pos, ix ? ix.getX(t * 3) : t * 3);
      v1.fromBufferAttribute(pos, ix ? ix.getX(t * 3 + 1) : t * 3 + 1);
      v2.fromBufferAttribute(pos, ix ? ix.getX(t * 3 + 2) : t * 3 + 2);
      tris.push([v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
    }
  }
}
console.log(`triangles: ${tris.length}`);
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
const P = new THREE.Vector3(), Q = new THREE.Vector3();
const tri = new THREE.Triangle(A, B, C);
function nearestDist(p) {
  P.set(...p);
  let best = Infinity, bestPt = null;
  for (const t of tris) {
    A.set(t[0], t[1], t[2]); B.set(t[3], t[4], t[5]); C.set(t[6], t[7], t[8]);
    tri.closestPointToPoint(P, Q);
    const d = Q.distanceTo(P);
    if (d < best) { best = d; bestPt = Q.toArray(); }
  }
  return { d: best, pt: bestPt };
}
const poses = {
  'Inside landing [0.1,0.1,4.6]': [0.1, 0.1, 4.6],
  'Chamber landing [0.4,0.35,3.6]': [0.4, 0.35, 3.6],
  'Wide landing [0,0,9] (sceneView wide, interior target)': [0, 0, 9],
  'Inside target [0,0.1,-0.7]': [0, 0.1, -0.7],
  'zoom-in R1.2 +x [1.2,0.1,-0.7]': [1.2, 0.1, -0.7],
  'zoom-in R1.2 -x [-1.2,0.1,-0.7]': [-1.2, 0.1, -0.7],
  'zoom-in R1.2 +y [0,1.3,-0.7]': [0, 1.3, -0.7],
  'zoom-in R1.2 +z [0,0.1,0.5]': [0, 0.1, 0.5],
  'old worst mush (1.1,2.13,-2.61)': [1.1, 2.13, -2.61],
  'cyl-1.2 R9 mush (0.79,-0.81,-7.26)': [0.79, -0.81, -7.26],
  'cyl-1.2 R6 mush (-0.6,1.14,4.81)': [-0.6, 1.14, 4.81],
  'axis +z [0,0.1,8]': [0, 0.1, 8],
  'axis -z [0,0.1,-8]': [0, 0.1, -8],
};
for (const [name, p] of Object.entries(poses)) {
  const { d, pt } = nearestDist(p);
  console.log(`  ${d.toFixed(3)}u  ${name}  nearest surface @ (${pt.map(x => x.toFixed(2))})`);
}

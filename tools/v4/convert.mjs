// glTF/GLB -> Ridge Runner vehicle format (json + base64 bin + webp textures)
// usage: node convert.mjs <id> [outDir]   (config below)
// Source GLBs are read from $RR_DL (default /home/claude/dl).
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld, simplify, dedup, prune} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import {MeshoptDecoder, MeshoptSimplifier} from 'meshoptimizer';
import {mat4, mat3, vec3} from 'gl-matrix';
import sharp from 'sharp';
import fs from 'fs';

const CFG = {
  jeep: {src: 'jeep-wrangler-rubicon.glb', target: 110000, cand: (n, m) => /wheel_lf/.test(n), nWheels: 4,
    texMax: 1024, rename: [[/^PaletteMaterial006$/, 'Headlight'], [/^PaletteMaterial007$/, 'Brakelight']], glass: /PaletteMaterial005|PaletteMaterial003/, keepAlpha: true},
  cougar: {src: 'GroundVehicle.glb', target: 60000, cand: (n) => /^Wheels/.test(n), nWheels: 6, texMax: 2048},
  rover: {src: 'Perseverance.glb', target: 95000, cand: (n) => /Wheels_objs/.test(n), nWheels: 6, texMax: 1024, keepAlpha: true},
  challenger: {src: 'dodge-challenger.glb', target: 80000, scale: 0.76, err: 0.01, rotY: 180, cand: (n, m) => /^wheel\.001|^hubcap|^Cylinder/.test(n), nWheels: 4,
    texMax: 1024, rename: [[/^PaletteMaterial007$/, 'Headlight']], glass: /PaletteMaterial005|frontglass/, keepAlpha: true},
  supra: {src: 'toyota-supra-gt300.glb', target: 110000, cand: (n, m) => /^19_-_Default/.test(m), nWheels: 4, texMax: 2048,
    glass: /windows_int|06_-_Default/, fixed: /^$/},
  mclaren: {src: 'mclaren-mp4-5.glb', target: 100000, scale: 0.62, cand: (n, m) => /(back|front)_wheels/.test(n), minAbsX: 0.62, nWheels: 4, texMax: 2048,
    glass: /glass_details/},
};

const id = process.argv[2];
const C = CFG[id];
const OUT = process.argv[3] || '/home/claude/build/assets/vehicles';
const DL = process.env.RR_DL || '/home/claude/dl';
fs.mkdirSync(OUT, {recursive: true});
await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder});
const doc = await io.read(DL + '/' + C.src);
const root = doc.getRoot();

const triCount = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) =>
  a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
// count instanced tris
const instTris = () => root.listNodes().reduce((s, n) => s + (n.getMesh() ? n.getMesh().listPrimitives().reduce((a, p) =>
  a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0) : 0), 0);
let t0 = instTris();
await doc.transform(dedup(), weld());
if (t0 > C.target) {
  const ratio = Math.min(1, C.target / t0);
  await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio, error: C.err || 0.004, lockBorder: false}));
  // second pass if still too heavy
  let t1 = instTris();
  if (t1 > C.target * 1.25) await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio: C.target / t1, error: (C.err || 0.004) * 3}));
}
console.log(id, 'tris', t0 | 0, '->', instTris() | 0);

// global transform: rotation about Y, uniform scale
const G = mat4.create();
if (C.scale) mat4.scale(G, G, [C.scale, C.scale, C.scale]);
if (C.rotY) mat4.rotateY(G, G, C.rotY * Math.PI / 180);

const namePath = n => { const a = []; for (let q = n; q; q = q.getParentNode && q.getParentNode()) a.push(q.getName() || ''); return a.join('/'); };
// ---- gather primitives in world space
const prims = []; // {mat, pos Float32Array(world), nor, uv, uv1, idx Uint32Array, cand}
for (const n of root.listNodes()) {
  const mesh = n.getMesh(); if (!mesh || n.getSkin()) continue;
  const W = mat4.multiply(mat4.create(), G, n.getWorldMatrix());
  const N = mat3.normalFromMat4(mat3.create(), W);
  for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4) continue;
    const mat = p.getMaterial();
    const P = p.getAttribute('POSITION'), cnt = P.getCount();
    const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3);
    const NA = p.getAttribute('NORMAL'), U0 = p.getAttribute('TEXCOORD_0'), U1 = p.getAttribute('TEXCOORD_1');
    const v = [0, 0, 0];
    for (let i = 0; i < cnt; i++) {
      P.getElement(i, v); vec3.transformMat4(v, v, W); pos.set(v, i * 3);
      if (NA) { NA.getElement(i, v); vec3.transformMat3(v, v, N); vec3.normalize(v, v); nor.set(v, i * 3); }
    }
    let idx = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: cnt}, (_, i) => i);
    if (mat4.determinant(W) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    if (!NA) { // compute smooth normals
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
        const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
        const f = vec3.cross([], e1, e2);
        for (const k of [a, b, c]) { nor[k] += f[0]; nor[k + 1] += f[1]; nor[k + 2] += f[2]; }
      }
      for (let i = 0; i < cnt; i++) { const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1; nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l; }
    }
    const getUV = A => { if (!A) return null; const o = new Float32Array(cnt * 2), t = [0, 0]; for (let i = 0; i < cnt; i++) { A.getElement(i, t); o[i * 2] = t[0]; o[i * 2 + 1] = t[1]; } return o; };
    prims.push({mat, pos, nor, uv: getUV(U0), uv1: getUV(U1), idx, cand: C.cand(namePath(n), mat?.getName() || '')});
  }
}

// ---- detect wheels from candidate vertices (only verts referenced by indices)
const pts0 = [];
for (const p of prims) if (p.cand) { const seen = new Set(p.idx); for (const i of seen) pts0.push([p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]]); }
const pts = pts0.filter(p => Math.abs(p[0]) >= (C.minAbsX || 0));
function clusterZ(arr) {
  arr.sort((a, b) => a[2] - b[2]); const out = [[arr[0]]];
  for (let i = 1; i < arr.length; i++) { if (arr[i][2] - arr[i - 1][2] > 0.12) out.push([]); out[out.length - 1].push(arr[i]); }
  return out.filter(c => c.length > 30);
}
const wheels = [];
for (const side of [-1, 1]) {
  for (const cl of clusterZ(pts.filter(p => p[0] * side > 0))) {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of cl) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], p[j]); mx[j] = Math.max(mx[j], p[j]); }
    wheels.push({n: cl.length, side, x: (mn[0] + mx[0]) / 2, y: (mn[1] + mx[1]) / 2, z: (mn[2] + mx[2]) / 2, r: Math.max(mx[1] - mn[1], mx[2] - mn[2]) / 2, w: mx[0] - mn[0], xmin: mn[0], xmax: mx[0]});
  }
}
wheels.sort((a, b) => b.n - a.n); wheels.splice(C.nWheels);
if (wheels.length !== C.nWheels) { console.error('wheel detection found', wheels.length, wheels); process.exit(1); }
// order: (-x front), (+x front), (-x rear), (+x rear), then extras (-x, +x)
const zs = [...new Set(wheels.map(w => Math.round(w.z * 4)))];
const byZ = s => wheels.filter(w => w.side === s).sort((a, b) => b.z - a.z);
const L = byZ(-1), R = byZ(1);
const ordered = [L[0], R[0], L[L.length - 1], R[R.length - 1]];
if (C.nWheels === 6) ordered.push(L[1], R[1]);
// ---- assign triangles
const inWheel = (w, x, y, z) => x >= w.xmin - 0.015 && x <= w.xmax + 0.015 && Math.hypot(y - w.y, z - w.z) <= w.r * 1.04;
const groups = new Map(); // key part|matIndex -> {part, mat, tris:[[prim, a,b,c]]}
const mats = [];
const matIdx = m => { let i = mats.indexOf(m); if (i < 0) { mats.push(m); i = mats.length - 1; } return i; };
for (const p of prims) {
  const mi = matIdx(p.mat);
  for (let t = 0; t < p.idx.length; t += 3) {
    let part = 'body';
    for (let k = 0; k < ordered.length; k++) {
      const w = ordered[k]; let ok = true;
      for (let j = 0; j < 3 && ok; j++) { const i = p.idx[t + j] * 3; ok = inWheel(w, p.pos[i], p.pos[i + 1], p.pos[i + 2]); }
      if (ok) { part = 'wheel' + k + (C.fixed && p.mat && C.fixed.test(p.mat.getName()) ? 'f' : ''); break; }
    }
    const key = part + '|' + mi;
    if (!groups.has(key)) groups.set(key, {part, mi, list: []});
    groups.get(key).list.push(p, t);
  }
}
// ---- textures
const texList = [];
const texName = [];
async function texRef(tex, info, srgb) {
  if (!tex) return null;
  let i = texList.indexOf(tex);
  if (i < 0) {
    texList.push(tex); i = texList.length - 1;
    const name = `${id}_${i}.webp`; texName.push(name);
    let img = sharp(Buffer.from(tex.getImage()));
    const meta = await img.metadata();
    const max = C.texMax || 1024;
    if (Math.max(meta.width, meta.height) > max) img = img.resize({width: meta.width >= meta.height ? max : null, height: meta.height > meta.width ? max : null});
    await img.webp({quality: srgb ? 82 : 88, alphaQuality: 90}).toFile(OUT + '/' + name);
  }
  const r = {img: i, uv: info.getTexCoord()};
  const tt = info.getExtension('KHR_texture_transform');
  if (tt) { r.offset = tt.getOffset(); r.repeat = tt.getScale(); r.rotation = tt.getRotation(); if (tt.getTexCoord() != null) r.uv = tt.getTexCoord(); }
  return r;
}
const matsOut = [];
for (const m of mats) {
  if (!m) { matsOut.push(null); continue; }
  let name = m.getName() || '';
  for (const [re, nn] of C.rename || []) if (re.test(name)) name = nn;
  const cc = m.getExtension('KHR_materials_clearcoat'), tr = m.getExtension('KHR_materials_transmission'), es = m.getExtension('KHR_materials_emissive_strength');
  const isGlass = C.glass ? C.glass.test(m.getName()) : !!(tr && tr.getTransmissionFactor() > 0);
  matsOut.push({
    name, color: m.getBaseColorFactor(), metalness: m.getMetallicFactor(), roughness: m.getRoughnessFactor(),
    emissive: m.getEmissiveFactor(), emissiveIntensity: es ? es.getEmissiveStrength() : 1, doubleSided: m.getDoubleSided(),
    alpha: C.keepAlpha === false ? 'OPAQUE' : m.getAlphaMode(), alphaCutoff: m.getAlphaCutoff(),
    clearcoat: cc ? cc.getClearcoatFactor() : 0, clearcoatRoughness: cc ? cc.getClearcoatRoughnessFactor() : 0,
    transmission: isGlass ? 1 : 0,
    map: await texRef(m.getBaseColorTexture(), m.getBaseColorTextureInfo(), true),
    normalMap: await texRef(m.getNormalTexture(), m.getNormalTextureInfo()), normalScale: m.getNormalScale(),
    mrMap: await texRef(m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()),
    aoMap: await texRef(m.getOcclusionTexture(), m.getOcclusionTextureInfo()), aoStrength: m.getOcclusionStrength(),
    emissiveMap: await texRef(m.getEmissiveTexture(), m.getEmissiveTextureInfo(), true),
  });
}
// ---- build buffers
const chunks = []; let off = 0;
const push = ta => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); const o = off; chunks.push(b); off += b.length; const pad = (4 - off % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } return o; };
const parts = [];
const bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
const order = [...groups.values()].sort((a, b) => (a.part === 'body' ? 0 : 1) - (b.part === 'body' ? 0 : 1) || a.mi - b.mi);
for (const g of order) {
  const m = matsOut[g.mi];
  const needUV1 = m && [m.map, m.normalMap, m.mrMap, m.aoMap, m.emissiveMap].some(t => t && t.uv === 1);
  const needUV = m && [m.map, m.normalMap, m.mrMap, m.aoMap, m.emissiveMap].some(t => t);
  const k = /^wheel(\d)/.exec(g.part); const wc = k ? ordered[+k[1]] : null;
  const vmap = new Map(); const P = [], Nn = [], U = [], U1 = [], I = [];
  for (let q = 0; q < g.list.length; q += 2) {
    const p = g.list[q], t = g.list[q + 1];
    for (let j = 0; j < 3; j++) {
      const vi = p.idx[t + j]; let key = p; let mp = vmap.get(p); if (!mp) { mp = new Map(); vmap.set(p, mp); }
      let ni = mp.get(vi);
      if (ni === undefined) {
        ni = P.length / 3; mp.set(vi, ni);
        let x = p.pos[vi * 3], y = p.pos[vi * 3 + 1], z = p.pos[vi * 3 + 2];
        if (!wc) { bmin[0] = Math.min(bmin[0], x); bmin[1] = Math.min(bmin[1], y); bmin[2] = Math.min(bmin[2], z); bmax[0] = Math.max(bmax[0], x); bmax[1] = Math.max(bmax[1], y); bmax[2] = Math.max(bmax[2], z); }
        if (wc) { x -= wc.x; y -= wc.y; z -= wc.z; }
        P.push(x, y, z); Nn.push(p.nor[vi * 3], p.nor[vi * 3 + 1], p.nor[vi * 3 + 2]);
        if (needUV) U.push(p.uv ? p.uv[vi * 2] : 0, p.uv ? p.uv[vi * 2 + 1] : 0);
        if (needUV1) U1.push(p.uv1 ? p.uv1[vi * 2] : 0, p.uv1 ? p.uv1[vi * 2 + 1] : 0);
      }
      I.push(ni);
    }
  }
  const count = P.length / 3, i32 = count > 65535;
  const part = {part: g.part, mat: g.mi, count, icount: I.length, pos: push(new Float32Array(P)), nor: push(new Float32Array(Nn))};
  if (needUV) part.uv = push(new Float32Array(U));
  if (needUV1) part.uv1 = push(new Float32Array(U1));
  part.idx = push(i32 ? new Uint32Array(I) : new Uint16Array(I)); part.i32 = i32;
  parts.push(part);
}
const r4 = v => Math.round(v * 1e4) / 1e4;
const json = {id, bounds: {min: bmin.map(r4), max: bmax.map(r4)},
  wheels: ordered.map(w => ({x: r4(w.x), y: r4(w.y), z: r4(w.z), r: r4(w.r), w: r4(w.w)})),
  materials: matsOut, images: texName, parts};
fs.writeFileSync(`${OUT}/${id}.json`, JSON.stringify(json));
fs.writeFileSync(`${OUT}/${id}.bin.txt`, Buffer.concat(chunks).toString('base64'));
const tris = parts.reduce((s, p) => s + p.icount / 3, 0);
console.log(JSON.stringify({id, tris, parts: parts.length, mats: matsOut.length, tex: texName.length, binKB: off >> 10, bounds: json.bounds, wheels: json.wheels}));

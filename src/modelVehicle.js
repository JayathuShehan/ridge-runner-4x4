// Loads a realistic glTF-derived vehicle (assets/vehicles/<model>.json + .bin + .webp, written by
// tools/convertVehicle.mjs) and builds a model with the same userData layout as truckModel.buildRealTruck,
// so syncRealTruck / lights / mud / paint all work unchanged.
import * as THREE from 'three';
import { addMud } from './truckModel.js';

const imgCache = new Map();
function loadImage(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('image ' + url)); i.src = url; }));
  return imgCache.get(url);
}
const fileCache = new Map();
function loadFiles(model) {
  if (!fileCache.has(model)) {
    const base = `assets/vehicles/${model}`;
    const p = Promise.all([
      fetch(base + '.json').then(r => { if (!r.ok) throw new Error(`${base}.json ${r.status}`); return r.json(); }),
      fetch(base + '.bin').then(r => { if (!r.ok) throw new Error(`${base}.bin ${r.status}`); return r.arrayBuffer(); }),
    ]);
    p.catch(() => fileCache.delete(model));
    fileCache.set(model, p);
  }
  return fileCache.get(model);
}
// start downloading a model in the background (e.g. when its card is hovered)
export function preloadModel(model) { loadFiles(model).catch(() => {}); }

// Light/mud materials the game drives directly (same names as truckModel's makeMaterials).
function gameMaterials(color) {
  return {
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.25 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x6d0a0a, emissive: 0xff1a0a, emissiveIntensity: 0.35 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 }),
    ledbar: new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffffff, emissiveIntensity: 0 }),
    paint: null, color,
  };
}

/**
 * @param def   vehicle definition from vehicles3d.js
 * @param color paint colour (used only when the model has a paintable material)
 */
export async function buildModelVehicle(def, color) {
  const [J, buf] = await loadFiles(def.model);
  const images = await Promise.all(J.images.map(f => loadImage(`assets/vehicles/${f}`)));
  // the GPU keeps its own copies once uploaded; don't hold several MB per model in JS (the HTTP cache re-serves them)
  fileCache.delete(def.model); for (const f of J.images) imgCache.delete(`assets/vehicles/${f}`);
  const m = gameMaterials(color);
  const dirt = { value: 0 };
  const paintRe = def.paintMat ? new RegExp(def.paintMat) : null;
  const tex = (t, srgb) => {
    if (!t) return null;
    const x = new THREE.Texture(images[t.img]);
    x.flipY = false; x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 4; x.channel = t.uv || 0;
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    if (t.offset) x.offset.fromArray(t.offset);
    if (t.repeat) x.repeat.fromArray(t.repeat);
    if (t.rotation) x.rotation = t.rotation;
    x.needsUpdate = true;
    return x;
  };
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 1.8, side: THREE.DoubleSide, depthWrite: false });
  const mats = J.materials.map(d => {
    if (!d) return null;
    const name = d.name || '', isPaint = !!(paintRe && paintRe.test(name));
    if (d.transmission > 0 || /glass/i.test(name)) return glass;
    const blend = d.alpha === 'BLEND';
    const o = {
      color: new THREE.Color().setRGB(d.color[0], d.color[1], d.color[2], THREE.LinearSRGBColorSpace),
      metalness: d.metalness, roughness: d.roughness, side: d.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: blend, opacity: blend ? d.color[3] : 1, alphaTest: d.alpha === 'MASK' ? d.alphaCutoff : 0, depthWrite: !blend,
    };
    const mat = (d.clearcoat > 0 || isPaint)
      ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: isPaint ? 1 : d.clearcoat, clearcoatRoughness: isPaint ? 0.06 : d.clearcoatRoughness })
      : new THREE.MeshStandardMaterial(o);
    if (d.map) mat.map = tex(d.map, true);
    if (d.normalMap) { mat.normalMap = tex(d.normalMap); mat.normalScale.set(d.normalScale, -d.normalScale); }
    if (d.mrMap) mat.roughnessMap = mat.metalnessMap = tex(d.mrMap);
    if (d.aoMap) { mat.aoMap = tex(d.aoMap); mat.aoMapIntensity = d.aoStrength; }
    if (d.emissiveMap || d.emissive.some(v => v > 0)) {
      mat.emissive.setRGB(d.emissive[0], d.emissive[1], d.emissive[2], THREE.LinearSRGBColorSpace);
      mat.emissiveIntensity = d.emissiveIntensity;
      if (d.emissiveMap) mat.emissiveMap = tex(d.emissiveMap, true);
    }
    if (isPaint) { mat.color.setHex(color); mat.envMapIntensity = 1.25; }
    else if (mat.map && def.albedo) mat.color.multiplyScalar(def.albedo);
    if (/^Headlight/i.test(name)) { m.head = mat; mat.emissive.setRGB(1, 0.98, 0.92); mat.emissiveIntensity = 0.25; }
    else if (/^Brakelight/i.test(name)) { m.tail = mat; mat.emissive.setRGB(1, 0.05, 0.03); mat.emissiveIntensity = 0.35; }
    else if (!blend) addMud(mat, dirt, /tire|tyre|wheel/i.test(name) ? 1.6 : 1);
    return mat;
  });
  m.paint = paintRe ? mats.find((x, i) => x && J.materials[i] && paintRe.test(J.materials[i].name)) || null : null;
  m.dirtUniform = dirt;

  // Placement: the json is in model space (ground ~ y=0). The body is shifted so the wheel centres sit at the
  // vehicle's static wheel height (def.wy, relative to the centre of mass) and centred left/right on the track.
  const w0 = J.wheels[0];
  const dx = -(J.wheels[0].x + J.wheels[1].x) / 2, dy = def.wy - w0.y;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const groups = J.wheels.map(() => ({ spin: new THREE.Group(), fix: new THREE.Group() }));
  for (const p of J.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.pos, p.count * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, p.nor, p.count * 3), 3));
    if (p.uv != null) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, p.uv, p.count * 2), 2));
    if (p.uv1 != null) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(buf, p.uv1, p.count * 2), 2));
    g.setIndex(new THREE.BufferAttribute(p.i32 ? new Uint32Array(buf, p.idx, p.icount) : new Uint16Array(buf, p.idx, p.icount), 1));
    const mat = mats[p.mat] || m.head;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = !mat.transparent; mesh.receiveShadow = true;
    if (p.part === 'body') { g.translate(dx, dy, 0); body.add(mesh); }
    else { const k = +p.part[5]; (p.part.endsWith('f') ? groups[k].fix : groups[k].spin).add(mesh); }
  }
  // the four physics wheels: steerG (position/steer) > spinG (rolls). cal = non-spinning parts (calipers).
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const jw = J.wheels[i];
    const steerG = new THREE.Group(); steerG.position.set(jw.x + dx, def.wy, jw.z); root.add(steerG);
    steerG.add(groups[i].spin, groups[i].fix);
    wheels.push({ steerG, spinG: groups[i].spin, cal: groups[i].fix, x: jw.x + dx, z: jw.z, base: 1 });
  }
  // extra visual wheels (6-wheelers): ride between the same-side front and rear wheels and copy their spin
  const extra = [];
  for (let i = 4; i < J.wheels.length; i++) {
    const jw = J.wheels[i], g = new THREE.Group();
    g.position.set(jw.x + dx, def.wy + (jw.y - w0.y), jw.z); root.add(g);
    g.add(groups[i].spin, groups[i].fix);
    const f = jw.x < 0 ? 0 : 1, r = jw.x < 0 ? 2 : 3;
    extra.push({ g, spinG: groups[i].spin, fix: groups[i].fix, f, r, t: (jw.z - J.wheels[r].z) / (J.wheels[f].z - J.wheels[r].z), dy: jw.y - w0.y, sx: Math.sign(jw.x), x0: Math.abs(jw.x + dx) });
  }
  const headPos = (def.heads || []).map(h => new THREE.Vector3(...h));
  root.userData = { body, wheels, extra, axles: [], springs: [], spare: null, mats: m, headPos, paint: m.paint, dirt, isModel: true, def };
  return root;
}

// Garage setup on a model: tyre size scales the wheel groups, width moves wheels out and stretches the body a little.
export function applyModelSetup(model, s) {
  const ud = model.userData, def = ud.def;
  const ts = s.R / def.R, tw = 1 + (ts - 1) * 0.6;
  ud.body.scale.x = s.bodyScaleX;
  for (const w of [...ud.wheels, ...ud.extra]) {
    (w.spinG).scale.set(tw, ts, ts);
    (w.cal || w.fix).scale.set(1, ts, ts);
  }
  for (const e of ud.extra) e.g.position.x = e.sx * e.x0 * (s.half / def.half);
}

// free GPU memory of a vehicle that has been swapped out (geometry, materials and their textures)
export function disposeVehicle(model) {
  const mats = new Set();
  model.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(x => mats.add(x)); });
  for (const mat of mats) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (mat[k] && mat[k].dispose) mat[k].dispose();
    mat.dispose();
  }
}

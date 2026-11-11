// Detailed procedural off-road vehicle (original design).
// Local frame: +z forward, +x = vehicle LEFT side, +y up. Origin = centre of mass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const WHEELS = [[-0.98, 1.45], [0.98, 1.45], [-0.98, -1.42], [0.98, -1.42]];
const WR = 0.5;           // tyre radius
const AXLE_Y = -0.42;     // static wheel centre height (rel. CoM)
const SILL = -0.33;       // body bottom
const BELT = 0.46;        // beltline
const ROOF = 1.04;
const HALF_W = 0.9;       // half body width (without flares)

// ---------- materials
function makeMaterials(color, env) {
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 });
  const m = {
    paint,
    black: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.62, metalness: 0.15 }),         // textured plastic / bumpers
    satin: new THREE.MeshStandardMaterial({ color: 0x232528, roughness: 0.42, metalness: 0.65 }),          // powder-coated steel
    chassis: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.75, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.12, metalness: 1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.85 }),
    rimLip: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1c1c1d, roughness: 0.93, metalness: 0 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc4161c, roughness: 0.38, metalness: 0.3 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x77736e, roughness: 0.45, metalness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.78, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.02 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.35, envMapIntensity: 2 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.8 }),
    drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 2.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x6d0a0a, emissive: 0xff1a0a, emissiveIntensity: 0.35, roughness: 0.25 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.25 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xb35a00, emissive: 0xff8a00, emissiveIntensity: 0.3, roughness: 0.3 }),
    ledbar: new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.2 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.85 }),
    liner: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.95, side: THREE.DoubleSide }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.9 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.55 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4e5a2c, roughness: 0.6, metalness: 0.2 }),
    plate: null,
    spring: new THREE.MeshStandardMaterial({ color: 0xd3401c, roughness: 0.45, metalness: 0.4 }),
    shock: new THREE.MeshStandardMaterial({ color: 0xc8a23a, roughness: 0.3, metalness: 0.85 }),
  };
  // licence plate
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#1a1a1a'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RR·4X4', 128, 34);
  const pt = new THREE.CanvasTexture(cv); pt.colorSpace = THREE.SRGBColorSpace;
  m.plate = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.4, metalness: 0.2 });
  // mud splatter on paint + plastics (driven by uniform uDirt)
  const dirt = { value: 0 };
  for (const k of ['paint', 'black', 'satin', 'tyre', 'rim', 'chassis']) addMud(m[k], dirt, k === 'tyre' ? 1.6 : 1);
  m.dirtUniform = dirt;
  return m;
}

export function addMud(mat, dirt, boost) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = dirt;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMudPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMudPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uDirt; varying vec3 vMudPos;
      float mh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float mn(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float mudN = mn(vMudPos * 9.0) * 0.55 + mn(vMudPos * 31.0) * 0.45;
      float mudH = smoothstep(0.55, -0.45, vMudPos.y);
      float mudAmt = clamp(uDirt * ${boost.toFixed(2)} * (mudH * 1.25 + 0.15) - (1.0 - mudN) * 0.55, 0.0, 1.0);
      mudAmt = smoothstep(0.05, 0.35, mudAmt);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.15, 0.09) * (0.75 + mudN * 0.5), mudAmt);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.95, mudAmt);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, mudAmt);');
  };
  mat.customProgramCacheKey = () => 'mud' + boost;
}

// ---------- geometry helpers
// Extrude a side-profile shape (u = z forward, v = y) across the vehicle width (x).
function sideExtrude(shape, width, bevel = 0.05, segs = 4) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 28 });
  g.rotateY(-Math.PI / 2); // (u,v,w) -> (-w, v, u)
  g.translate(width / 2, 0, 0);
  return g;
}
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
const rbox = (w, h, d, r = 0.03, s = 2) => new RoundedBoxGeometry(w, h, d, s, r);
const cyl = (r1, r2, h, s = 16) => new THREE.CylinderGeometry(r1, r2, h, s);
const tube = (pts, r, seg = 24, rs = 8) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, rs, false);

class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo) { if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(geo.index ? geo.toNonIndexed() : geo); return this; }
  build(group) {
    for (const [mat, geos] of this.map) {
      geos.forEach(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); });
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// ---------- body
function buildBody(m) {
  const P = new Parts();
  const zR = -1.42, zF = 1.45, ar = 0.66, acy = AXLE_Y;
  const a = Math.asin((SILL - acy) / ar);
  // lower tub with wheel arches
  const s = new THREE.Shape();
  s.moveTo(-2.18, SILL + 0.06);
  s.quadraticCurveTo(-2.18, SILL, -2.1, SILL);
  s.lineTo(zR - ar * Math.cos(a), SILL);
  s.absarc(zR, acy, ar, Math.PI - a, a, true);
  s.lineTo(zF - ar * Math.cos(a), SILL);
  s.absarc(zF, acy, ar, Math.PI - a, a, true);
  s.lineTo(2.12, SILL);
  s.quadraticCurveTo(2.24, SILL, 2.24, SILL + 0.1);
  s.lineTo(2.25, 0.36);
  s.quadraticCurveTo(2.24, 0.44, 2.14, 0.45);   // nose top
  s.lineTo(0.62, BELT + 0.03);                  // hood line
  s.lineTo(-2.12, BELT);
  s.quadraticCurveTo(-2.2, BELT - 0.02, -2.2, BELT - 0.1);
  s.lineTo(-2.18, SILL + 0.06);
  P.add(m.paint, sideExtrude(s, HALF_W * 2 - 0.12, 0.06, 5));
  // hood with subtle power bulge
  P.add(m.paint, place(rbox(1.62, 0.07, 1.5, 0.03), 0, BELT + 0.04, 1.38, -0.02));
  P.add(m.paint, place(rbox(0.78, 0.05, 1.2, 0.025), 0, BELT + 0.085, 1.32, -0.02));
  // hood vents
  for (const x of [-0.55, 0.55]) for (let i = 0; i < 4; i++) P.add(m.black, place(new THREE.BoxGeometry(0.22, 0.012, 0.025), x, BELT + 0.078, 1.05 + i * 0.05, -0.02));
  // cabin / greenhouse: pillars + roof (painted) — glass is added on top of it
  const c = new THREE.Shape();
  c.moveTo(0.6, BELT); c.lineTo(0.22, ROOF - 0.03); c.quadraticCurveTo(0.17, ROOF, 0.08, ROOF);
  c.lineTo(-2.0, ROOF); c.quadraticCurveTo(-2.1, ROOF, -2.11, ROOF - 0.06); c.lineTo(-2.14, BELT); c.lineTo(0.6, BELT);
  P.add(m.paint, sideExtrude(c, 1.62, 0.05, 4));
  // black hardtop roof skin
  P.add(m.black, place(rbox(1.66, 0.05, 2.14, 0.02), 0, ROOF + 0.045, -0.97));
  // glass: windscreen, side windows, rear
  const wsLen = Math.hypot(0.6 - 0.22, ROOF - 0.03 - BELT);
  const ws = rbox(1.48, 0.016, wsLen - 0.08, 0.008);
  const wsAng = Math.atan2(ROOF - 0.03 - BELT, 0.6 - 0.22);
  const wn = new THREE.Vector2(0.823, 0.568);
  P.add(m.glass, place(ws, 0, (BELT + ROOF - 0.03) / 2 + wn.y * 0.058, 0.41 + wn.x * 0.058, wsAng, 0, 0));
  for (const sx of [-1, 1]) {
    const x = sx * (0.81 + 0.052);
    const wins = [[0.12, -0.78, true], [-0.88, -1.62, false], [-1.7, -2.02, false]];
    for (const [z0, z1, front] of wins) {
      const sh = new THREE.Shape();
      const yb = BELT + 0.07, yt = ROOF - 0.08;
      sh.moveTo(z1, yb); sh.lineTo(front ? z0 + 0.22 : z0, yb);
      if (front) sh.lineTo(z0 - 0.05, yt); else sh.lineTo(z0, yt);
      sh.lineTo(z1, yt); sh.lineTo(z1, yb);
      const g = sideExtrude(sh, 0.012, 0.004, 1);
      g.translate(x, 0, 0);
      P.add(m.glass, g);
    }
    // door seams + handles + B pillar trim
    for (const z of [0.18, -0.84, -1.66]) P.add(m.black, place(new THREE.BoxGeometry(0.008, BELT - SILL - 0.06, 0.008), sx * (HALF_W + 0.005), (BELT + SILL) / 2, z));
    for (const z of [-0.32, -1.3]) P.add(m.black, place(rbox(0.035, 0.035, 0.16, 0.012), sx * (HALF_W + 0.02), BELT - 0.08, z));
    P.add(m.black, place(new THREE.BoxGeometry(0.03, ROOF - BELT - 0.08, 0.1), sx * (0.81 + 0.06), (BELT + ROOF) / 2, -0.83));
    // mirrors
    P.add(m.black, place(rbox(0.06, 0.06, 0.12, 0.02), sx * 0.92, BELT + 0.12, 0.28));
    P.add(m.black, place(rbox(0.2, 0.17, 0.08, 0.03), sx * 1.06, BELT + 0.17, 0.26, 0, sx * 0.15, 0));
    P.add(m.glass, place(new THREE.BoxGeometry(0.17, 0.14, 0.01), sx * 1.06, BELT + 0.17, 0.215, 0, sx * 0.15, 0));
    // rock sliders + steps
    P.add(m.satin, place(cyl(0.045, 0.045, 1.66, 10), sx * 0.97, SILL - 0.05, -0.03, Math.PI / 2));
    P.add(m.satin, place(rbox(0.16, 0.04, 1.6, 0.015), sx * 0.95, SILL - 0.02, -0.03));
    // fender flares: arc bands around arches
    for (const zc of [zF, zR]) {
      const f = new THREE.Shape();
      const r0 = ar - 0.02, r1 = ar + 0.13;
      const a0 = -0.05, a1 = Math.PI + 0.05;
      f.absarc(0, 0, r1, a0, a1, false);
      f.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
      f.absarc(0, 0, r0, a1, a0, true);
      const g = sideExtrude(f, 0.26, 0.025, 3);
      g.translate(sx * (HALF_W + 0.03), acy, zc);
      P.add(m.black, g);
    }
    // tail light clusters
    P.add(m.black, place(rbox(0.16, 0.36, 0.05, 0.02), sx * 0.8, 0.12, -2.255));
  }
  // inner fender liners so you can't see through the arches
  for (const zc of [zF, zR]) {
    const g = new THREE.CylinderGeometry(ar - 0.005, ar - 0.005, HALF_W * 2 - 0.02, 28, 1, true, 0.08, Math.PI - 0.16);
    g.rotateZ(Math.PI / 2); g.translate(0, acy, zc);
    P.add(m.liner, g);
    // liner side walls (inner)
    const side = new THREE.CircleGeometry(ar - 0.005, 28, 0.08, Math.PI - 0.16);
  }
  // interior: dash, seats, steering wheel
  P.add(m.interior, place(rbox(1.56, 0.18, 0.4, 0.04), 0, BELT + 0.08, 0.32));
  for (const sx of [-0.4, 0.4]) {
    P.add(m.seat, place(rbox(0.46, 0.14, 0.5, 0.05), sx, BELT - 0.02, -0.45));
    P.add(m.seat, place(rbox(0.46, 0.62, 0.14, 0.05), sx, BELT + 0.28, -0.72, -0.15));
  }
  P.add(m.seat, place(rbox(1.3, 0.55, 0.14, 0.05), 0, BELT + 0.2, -1.55, -0.12));
  P.add(m.interior, place(new THREE.TorusGeometry(0.17, 0.022, 8, 24), 0.4, BELT + 0.24, 0.12, -0.5));
  // front end: grille panel, headlights, bumper, winch
  const gp = rbox(1.6, 0.42, 0.06, 0.03);
  P.add(m.black, place(gp, 0, 0.18, 2.32));
  for (let i = 0; i < 6; i++) P.add(m.satin, place(rbox(0.86, 0.025, 0.04, 0.008), 0, 0.04 + i * 0.055, 2.355));
  P.add(m.paint, place(rbox(1.72, 0.07, 0.09, 0.025), 0, 0.43, 2.31));
  const headGroupPos = [];
  for (const sx of [-1, 1]) {
    const x = sx * 0.6;
    P.add(m.black, place(cyl(0.19, 0.19, 0.08, 28), x, 0.2, 2.335, Math.PI / 2));
    P.add(m.chrome, place(new THREE.TorusGeometry(0.17, 0.014, 8, 32), x, 0.2, 2.378));
    P.add(m.head, place(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), x, 0.2, 2.3, Math.PI / 2));
    P.add(m.drl, place(new THREE.TorusGeometry(0.125, 0.012, 6, 32), x, 0.2, 2.382));
    P.add(m.lens, place(new THREE.SphereGeometry(0.165, 24, 8, 0, Math.PI * 2, 0, 0.5), x, 0.2, 2.29, Math.PI / 2));
    headGroupPos.push(new THREE.Vector3(x, 0.2, 2.42));
    P.add(m.amber, place(rbox(0.12, 0.05, 0.03, 0.01), sx * 0.86, 0.03, 2.35));
  }
  // steel winch bumper
  P.add(m.satin, place(rbox(2.02, 0.26, 0.28, 0.04), 0, -0.2, 2.42));
  P.add(m.satin, place(rbox(0.9, 0.06, 0.3, 0.02), 0, -0.04, 2.44));
  P.add(m.satin, place(rbox(0.12, 0.3, 0.06, 0.02), -0.36, 0.06, 2.5, -0.25));
  P.add(m.satin, place(rbox(0.12, 0.3, 0.06, 0.02), 0.36, 0.06, 2.5, -0.25));
  P.add(m.black, place(cyl(0.08, 0.08, 0.5, 16), 0, -0.2, 2.51, 0, 0, Math.PI / 2));
  P.add(m.chrome, place(rbox(0.26, 0.1, 0.05, 0.02), 0, -0.2, 2.585));
  for (const sx of [-0.7, 0.7]) P.add(m.caliper, place(new THREE.TorusGeometry(0.05, 0.016, 8, 16), sx, -0.2, 2.59, 0, Math.PI / 2, 0));
  // rear: bumper, tail lights, spare carrier, plate
  P.add(m.satin, place(rbox(1.98, 0.22, 0.24, 0.04), 0, -0.22, -2.36));
  P.add(m.plate, place(new THREE.BoxGeometry(0.42, 0.11, 0.01), 0, -0.04, -2.272, 0, Math.PI, 0));
  for (const sx of [-1, 1]) {
    P.add(m.tail, place(rbox(0.12, 0.2, 0.03, 0.01), sx * 0.8, 0.17, -2.285));
    P.add(m.reverse, place(rbox(0.12, 0.07, 0.03, 0.01), sx * 0.8, 0.0, -2.285));
    P.add(m.caliper, place(new THREE.TorusGeometry(0.045, 0.014, 8, 16), sx * 0.7, -0.24, -2.49, 0, Math.PI / 2, 0));
  }
  // third brake light
  P.add(m.tail, place(rbox(0.36, 0.03, 0.03, 0.01), 0, ROOF + 0.02, -2.2));
  // rear glass
  P.add(m.glass, place(rbox(1.3, 0.42, 0.012, 0.01), 0, (BELT + ROOF) / 2 + 0.03, -2.2, 0.05));
  // snorkel (vehicle right side = -x)
  P.add(m.black, tube([[-0.98, 0.0, 1.05], [-1.0, 0.3, 0.95], [-1.0, BELT + 0.1, 0.72], [-0.92, 0.78, 0.48], [-0.86, ROOF + 0.02, 0.28]], 0.055, 32, 10));
  P.add(m.black, place(rbox(0.16, 0.13, 0.22, 0.04), -0.86, ROOF + 0.06, 0.3));
  // roof rack + light bar + recovery boards + jerrycans
  for (const sx of [-1, 1]) P.add(m.satin, place(rbox(0.05, 0.05, 2.1, 0.015), sx * 0.76, ROOF + 0.14, -0.98));
  for (let i = 0; i < 5; i++) P.add(m.satin, place(rbox(1.56, 0.04, 0.05, 0.015), 0, ROOF + 0.15, -1.95 + i * 0.48));
  for (const sx of [-1, 1]) for (const z of [-1.9, -0.05]) P.add(m.satin, place(new THREE.BoxGeometry(0.04, 0.12, 0.04), sx * 0.76, ROOF + 0.08, z));
  P.add(m.black, place(rbox(1.3, 0.1, 0.1, 0.03), 0, ROOF + 0.17, 0.05));
  const ledbar = place(new THREE.BoxGeometry(1.2, 0.06, 0.01), 0, ROOF + 0.17, 0.105);
  P.add(m.ledbar, ledbar);
  for (const x of [-0.3, 0.12]) {
    P.add(m.orange, place(rbox(0.32, 0.035, 1.15, 0.012), x, ROOF + 0.19, -1.25));
    for (let i = 0; i < 10; i++) P.add(m.orange, place(new THREE.BoxGeometry(0.06, 0.02, 0.05), x + ((i % 2) - 0.5) * 0.12, ROOF + 0.215, -1.75 + i * 0.11));
  }
  for (const z of [-0.55, -0.95]) {
    P.add(m.olive, place(rbox(0.16, 0.32, 0.34, 0.03), 0.6, ROOF + 0.33, z, Math.PI / 2, 0, 0));
    P.add(m.olive, place(cyl(0.025, 0.025, 0.07, 8), 0.6, ROOF + 0.33, z + 0.2, Math.PI / 2));
  }
  P.add(m.black, place(cyl(0.006, 0.004, 0.9, 6), 0.84, ROOF + 0.25, 0.4, -0.25));
  // mud flaps
  for (const sx of [-1, 1]) P.add(m.black, place(new THREE.BoxGeometry(0.3, 0.3, 0.012), sx * 0.98, SILL - 0.12, -2.04));
  return { P, headPos: headGroupPos };
}

// ---------- underbody (static part)
function buildChassis(m) {
  const P = new Parts();
  for (const sx of [-0.45, 0.45]) P.add(m.chassis, place(new THREE.BoxGeometry(0.1, 0.16, 4.2), sx, SILL - 0.02, 0));
  for (const z of [0.7, -0.6]) P.add(m.chassis, place(new THREE.BoxGeometry(0.9, 0.08, 0.08), 0, SILL - 0.04, z));
  P.add(m.chassis, place(cyl(0.045, 0.045, 1.3, 10), 0.15, AXLE_Y - 0.0, 0.75, Math.PI / 2)); // front driveshaft
  P.add(m.chassis, place(cyl(0.045, 0.045, 1.3, 10), 0.15, AXLE_Y - 0.0, -0.72, Math.PI / 2));
  P.add(m.chassis, place(rbox(0.38, 0.28, 0.6, 0.06), 0, SILL - 0.12, 0.1)); // transfer case
  P.add(m.satin, place(cyl(0.035, 0.035, 2.0, 8), -0.55, SILL - 0.1, -1.2, Math.PI / 2));
  P.add(m.chrome, place(cyl(0.04, 0.045, 0.16, 10), -0.62, SILL - 0.1, -2.28, Math.PI / 2));
  return P;
}

// ---------- wheel (spinning part): tyre + rim + brake disc
function buildWheelGeometry(m) {
  const P = new Parts();
  // tyre carcass via lathe: points (radius, axial)
  const pts = [];
  const prof = [[0.31, -0.165], [0.36, -0.178], [0.42, -0.18], [0.455, -0.172], [0.47, -0.155], [0.474, -0.12], [0.476, 0], [0.474, 0.12], [0.47, 0.155], [0.455, 0.172], [0.42, 0.18], [0.36, 0.178], [0.31, 0.165]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const carcass = new THREE.LatheGeometry(pts, 56);
  carcass.rotateZ(Math.PI / 2);
  P.add(m.tyre, carcass);
  // mud-terrain tread blocks (two staggered rows + shoulder lugs)
  const N = 22;
  const blk = new THREE.BoxGeometry(0.13, 0.04, 0.115);
  const shoulder = new THREE.BoxGeometry(0.07, 0.035, 0.1);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const off = side === 1 ? 0 : Math.PI / N;
      const aa = a + off;
      const r = 0.476 + 0.018;
      P.add(m.tyre, lugAt(blk, side * 0.075, aa, r, side * 0.18));
      P.add(m.tyre, lugAt(shoulder, side * 0.165, aa + (side === 1 ? 0.06 : -0.06), 0.462, 0, side * 0.5));
    }
  }
  // beadlock rim
  const rimFace = new THREE.CylinderGeometry(0.315, 0.315, 0.03, 40); rimFace.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    P.add(m.rimLip, place(new THREE.TorusGeometry(0.3, 0.022, 8, 40), sx * 0.15, 0, 0, 0, Math.PI / 2, 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      P.add(m.chrome, place(cyl(0.011, 0.011, 0.03, 5), sx * 0.168, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, 0, Math.PI / 2));
    }
  }
  const barrel = new THREE.CylinderGeometry(0.29, 0.29, 0.3, 40, 1, true); barrel.rotateZ(Math.PI / 2);
  P.add(m.rim, barrel);
  for (const sx of [-1, 1]) {
    const dish = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 20); dish.rotateZ(Math.PI / 2); dish.translate(sx * 0.11, 0, 0);
    P.add(m.rim, dish);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = rbox(0.045, 0.2, 0.085, 0.015, 1);
      sp.translate(0, 0.2, 0);
      sp.rotateX(a);
      sp.translate(sx * 0.12, 0, 0);
      P.add(m.rim, sp);
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6 + 1 / 12) * Math.PI * 2; P.add(m.chrome, place(cyl(0.014, 0.014, 0.03, 6), sx * 0.14, Math.cos(a) * 0.065, Math.sin(a) * 0.065, 0, 0, Math.PI / 2)); }
    P.add(m.chrome, place(cyl(0.04, 0.045, 0.04, 16), sx * 0.15, 0, 0, 0, 0, Math.PI / 2));
  }
  // brake disc (spins)
  P.add(m.disc, place(cyl(0.2, 0.2, 0.025, 28), 0, 0, 0, 0, 0, Math.PI / 2));
  return P;
}
function lugAt(geo, x, a, r, tilt = 0, sideTilt = 0) {
  const g = geo.clone();
  if (tilt) g.rotateY(tilt);
  if (sideTilt) g.rotateZ(sideTilt);
  g.translate(x, r, 0);
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(-a));
  return g;
}

// ---------- assemble
export function buildRealTruck(color = 0x2f4fb8) {
  const m = makeMaterials(color);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const { P, headPos } = buildBody(m);
  P.build(body);
  buildChassis(m).build(body);
  // wheels
  const wheelP = buildWheelGeometry(m);
  const wheelProto = new THREE.Group(); wheelP.build(wheelProto);
  const wheels = [];
  for (const [x, z] of WHEELS) {
    const steerG = new THREE.Group(); steerG.position.set(x, AXLE_Y, z); root.add(steerG);
    const spinG = wheelProto.clone(); spinG.scale.x = x > 0 ? 1 : -1; // mirror so face points outward
    steerG.add(spinG);
    // caliper (does not spin)
    const cal = new THREE.Mesh(rbox(0.07, 0.12, 0.18, 0.02), m.caliper);
    cal.position.set(-Math.sign(x) * 0.0 + Math.sign(x) * 0.02, 0.12, 0.1); cal.castShadow = true; steerG.add(cal);
    wheels.push({ steerG, spinG, cal, x, z });
  }
  // solid axles + springs + shocks (animated)
  const axleGeo = cyl(0.055, 0.055, 1, 12); axleGeo.rotateZ(Math.PI / 2);
  const diffGeo = new THREE.SphereGeometry(0.17, 20, 14);
  const axles = [];
  for (const pair of [[0, 1], [2, 3]]) {
    const ax = new THREE.Group(); root.add(ax);
    const tubeM = new THREE.Mesh(axleGeo, m.chassis); tubeM.castShadow = true; ax.add(tubeM);
    const diff = new THREE.Mesh(diffGeo, m.chassis); diff.scale.set(1, 0.95, 1.1); diff.position.x = 0.15; diff.castShadow = true; ax.add(diff);
    const cover = new THREE.Mesh(cyl(0.13, 0.13, 0.03, 20), m.satin); cover.rotation.x = Math.PI / 2; cover.position.set(0.15, 0, pair[0] === 0 ? 0.17 : -0.17); ax.add(cover);
    axles.push({ g: ax, tube: tubeM, pair });
  }
  // spare wheel on the tailgate
  const spare = wheelProto.clone(); spare.rotation.y = Math.PI / 2; spare.position.set(0, 0.28, -2.48); body.add(spare);
  const springs = [];
  root.userData = { body, wheels, axles, springs, spare, mats: m, headPos, paint: m.paint, dirt: m.dirtUniform };
  return root;
}

// Apply a garage setup to the model: tyre size/width, body width. Cheap; safe to call every slider tick.
export function applyTruckSetup(model, s) {
  const ud = model.userData;
  const ts = s.R / WR, tw = 1 + (ts - 1) * 0.6, sx = s.bodyScaleX;   // tyres grow a bit less in width than in radius
  ud.body.scale.x = sx;
  for (const vw of ud.wheels) {
    vw.spinG.scale.set((vw.x > 0 ? 1 : -1) * tw, ts, ts);
    vw.cal.scale.set(1, ts, ts);
  }
  // spare wheel sits in the (x-stretched) body: its radial z axis points along body x, so undo that stretch
  ud.spare.scale.set(tw, ts, ts / sx);
  ud.spare.position.y = 0.28 + (ts - 1) * 0.5;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function syncRealTruck(model, ph) {
  model.position.copy(ph.pos);
  model.quaternion.copy(ph.quat);
  const ud = model.userData;
  const centres = [];
  for (let i = 0; i < 4; i++) {
    const w = ph.wheels[i], vw = ud.wheels[i];
    const y = ph.mountY - w.susLen;
    vw.steerG.position.y += (y - vw.steerG.position.y) * 0.7;
    vw.steerG.position.x = w.x;
    vw.steerG.rotation.y = w.front ? ph.steer : 0;
    vw.spinG.rotation.x = w.spin;
    centres.push(vw.steerG.position);
  }
  for (const ax of ud.axles) {
    const a = centres[ax.pair[0]], b = centres[ax.pair[1]];
    ax.g.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    ax.g.rotation.set(0, 0, Math.atan2(b.y - a.y, b.x - a.x));
    ax.tube.scale.x = Math.hypot(b.x - a.x, b.y - a.y) - 0.3;
  }
  // realistic 6-wheelers: middle wheels ride between the same-side front/rear wheels (see modelVehicle.js)
  if (ud.extra) for (const e of ud.extra) {
    const a = ud.wheels[e.f].steerG.position, b = ud.wheels[e.r].steerG.position;
    e.g.position.y = b.y + (a.y - b.y) * e.t + e.dy;
    e.spinG.rotation.x = ud.wheels[e.r].spinG.rotation.x;
  }
}

export const TRUCK_DIMS = { WR, AXLE_Y, SILL, BELT, ROOF };

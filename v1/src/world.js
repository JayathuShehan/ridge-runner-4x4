// World rendering: terrain chunks, water, sky, trees, rocks, gates
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, N, RES, WATER, COURSE, CP_LABELS } from './terrain.js';
import { makeRng, clamp, lerp, smoothstep } from './noise.js';

const C = (hex) => new THREE.Color(hex);

export function buildTerrainMeshes(T, scene) {
  const CH = 80; // chunk size (m)
  const nC = (HALF * 2) / CH;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const cols = {
    grassA: C(0x4f7d32), grassB: C(0x7fa648), grassC: C(0x8c9a45), rock: C(0x8a7f72), rockD: C(0x5f5850),
    sand: C(0xcdb98a), wetSand: C(0x8f7d5c), dirt: C(0xb48c5c), rut: C(0x7e5f3d), mud: C(0x3e2c1b), mudWet: C(0x2b1e12),
    snow: C(0xf2f5f7), bed: C(0x6e6450),
  };
  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const n = new THREE.Vector3();
  const noise = T.noise;
  // global normal + color grids
  const NOR = new Float32Array(N * N * 3), COL = new Float32Array(N * N * 3);
  for (let gj = 0; gj < N; gj++) for (let gi = 0; gi < N; gi++) {
    const id = gj * N + gi, v = id * 3;
    const x = -HALF + gi * RES, z = -HALF + gj * RES, h = T.h[id];
    const hl = T.h[gj * N + Math.max(0, gi - 1)], hr = T.h[gj * N + Math.min(N - 1, gi + 1)];
    const hd = T.h[Math.max(0, gj - 1) * N + gi], hu = T.h[Math.min(N - 1, gj + 1) * N + gi];
    n.set(hl - hr, 2 * RES, hd - hu).normalize();
    NOR[v] = n.x; NOR[v + 1] = n.y; NOR[v + 2] = n.z;
    const nz = noise.n2(x * 0.05, z * 0.05), nz2 = noise.n2(x * 0.31 + 7, z * 0.31);
    tmp.copy(cols.grassA).lerp(cols.grassB, clamp(0.5 + nz * 0.6, 0, 1));
    tmp.lerp(cols.grassC, clamp(noise.n2(x * 0.011, z * 0.011) * 0.8, 0, 0.6));
    tmp.multiplyScalar(0.92 + nz2 * 0.08);
    const slope = 1 - n.y;
    tmp.lerp(tmp2.copy(cols.rock).lerp(cols.rockD, clamp(0.5 + nz2, 0, 1)), smoothstep(0.16, 0.32, slope));
    if (h > 46) tmp.lerp(cols.snow, smoothstep(46, 54, h + nz * 3) * (1 - smoothstep(0.35, 0.55, slope)));
    tmp.lerp(cols.sand, 1 - smoothstep(0.6, 2.2, h + nz * 0.5));
    if (h < 0) tmp.lerp(cols.bed, smoothstep(0, -1.5, h));
    const tr = T.trail[id];
    if (tr > 0) {
      const d = T.trailD[id];
      const rut = Math.exp(-((d - 1.0) ** 2) / 0.12) * 0.7;
      tmp2.copy(cols.dirt).lerp(cols.rut, rut).multiplyScalar(0.93 + nz2 * 0.07);
      if (h < 0.3) tmp2.lerp(cols.wetSand, 0.6);
      tmp.lerp(tmp2, tr);
    }
    const md = T.mud[id];
    if (md > 0) tmp.lerp(tmp2.copy(cols.mud).lerp(cols.mudWet, clamp(nz2 + 0.5, 0, 1)), smoothstep(0, 0.6, md));
    COL[v] = tmp.r; COL[v + 1] = tmp.g; COL[v + 2] = tmp.b;
  }
  T.colorGrid = COL;

  function chunkGeo(ci, cj, step, skirt) {
    const cells = CH / RES / step, vPer = cells + 1;
    const extra = skirt ? cells * 4 : 0;
    const count = vPer * vPer + extra;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const put = (k, gi, gj, dy) => {
      const id = gj * N + gi, o = k * 3, s3 = id * 3;
      pos[o] = -HALF + gi * RES; pos[o + 1] = T.h[id] + dy; pos[o + 2] = -HALF + gj * RES;
      nor[o] = NOR[s3]; nor[o + 1] = NOR[s3 + 1]; nor[o + 2] = NOR[s3 + 2];
      col[o] = COL[s3]; col[o + 1] = COL[s3 + 1]; col[o + 2] = COL[s3 + 2];
    };
    const gi0 = ci * (CH / RES), gj0 = cj * (CH / RES);
    for (let j = 0; j < vPer; j++) for (let i = 0; i < vPer; i++) put(j * vPer + i, gi0 + i * step, gj0 + j * step, 0);
    const idx = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const a = j * vPer + i, b = a + 1, c = a + vPer, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    if (skirt) {
      // border loop, each border vertex duplicated 3 m lower
      const loop = [];
      for (let i = 0; i < cells; i++) loop.push([i, 0]);
      for (let j = 0; j < cells; j++) loop.push([cells, j]);
      for (let i = cells; i > 0; i--) loop.push([i, cells]);
      for (let j = cells; j > 0; j--) loop.push([0, j]);
      const base = vPer * vPer;
      loop.forEach(([i, j], k) => put(base + k, gi0 + i * step, gj0 + j * step, -3));
      for (let k = 0; k < loop.length; k++) {
        const k2 = (k + 1) % loop.length;
        const t0 = loop[k][1] * vPer + loop[k][0], t1 = loop[k2][1] * vPer + loop[k2][0];
        const b0 = base + k, b1 = base + k2;
        idx.push(t0, b0, t1, t1, b0, b1, t0, t1, b0, t1, b1, b0); // double-sided
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  const chunks = [];
  for (let cj = 0; cj < nC; cj++) for (let ci = 0; ci < nC; ci++) {
    const fine = new THREE.Mesh(chunkGeo(ci, cj, 1, false), mat);
    const coarse = new THREE.Mesh(chunkGeo(ci, cj, 4, true), mat);
    fine.receiveShadow = coarse.receiveShadow = true;
    coarse.visible = false;
    scene.add(fine, coarse);
    chunks.push({ fine, coarse, cx: -HALF + (ci + 0.5) * CH, cz: -HALF + (cj + 0.5) * CH });
  }
  return {
    chunks,
    update(cam, far) {
      for (const c of chunks) {
        const d = Math.max(0, Math.hypot(c.cx - cam.x, c.cz - cam.z) - CH * 0.7);
        const vis = d < far;
        c.fine.visible = vis && d < 110;
        c.coarse.visible = vis && d >= 110;
      }
    },
  };
}

function makeWaterNormals(rng) {
  const S = 128, data = new Uint8Array(S * S * 4);
  const hgt = new Float32Array(S * S);
  const waves = Array.from({ length: 10 }, () => ({ kx: Math.round((rng() - 0.5) * 12), kz: Math.round((rng() - 0.5) * 12), p: rng() * 6.28, a: 0.3 + rng() }));
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let h = 0;
    for (const w of waves) h += w.a * Math.sin((w.kx * i + w.kz * j) / S * Math.PI * 2 + w.p);
    hgt[j * S + i] = h;
  }
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = hgt[j * S + ((i + 1) % S)] - hgt[j * S + ((i - 1 + S) % S)];
    const dz = hgt[((j + 1) % S) * S + i] - hgt[((j - 1 + S) % S) * S + i];
    const v = new THREE.Vector3(-dx * 0.25, -dz * 0.25, 1).normalize();
    const o = (j * S + i) * 4;
    data[o] = (v.x * 0.5 + 0.5) * 255; data[o + 1] = (v.y * 0.5 + 0.5) * 255; data[o + 2] = (v.z * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildWater(scene, rng) {
  const nm = makeWaterNormals(rng);
  nm.repeat.set(70, 70);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f7f96, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.8, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35) });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.2, HALF * 2.2).rotateX(-Math.PI / 2), mat);
  m.position.y = WATER;
  m.receiveShadow = true;
  scene.add(m);
  return { mesh: m, update(t) { nm.offset.set(t * 0.012, t * 0.007); } };
}

export function buildSky(scene) {
  const uniforms = {
    top: { value: C(0x3d7fd1) }, horizon: { value: C(0xcfe3f0) }, ground: { value: C(0x9fb3a8) },
    sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() }, sunColor: { value: C(0xfff1d0) }, sunSize: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top, horizon, ground, sunColor, sunDir; uniform float sunSize; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float y = d.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-y*4.0,0.0,1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 900.0/sunSize) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  // stylized clouds
  const clouds = new THREE.Group();
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
  const rng = makeRng(99);
  for (let i = 0; i < 22; i++) {
    const g = new THREE.Group();
    const puffs = 3 + Math.floor(rng() * 4);
    for (let p = 0; p < puffs; p++) {
      const s = 8 + rng() * 10;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), cm);
      m.position.set((p - puffs / 2) * s * 0.9, rng() * 4, (rng() - 0.5) * 10);
      m.scale.y = 0.55;
      g.add(m);
    }
    const a = rng() * Math.PI * 2, r = 250 + rng() * 450;
    g.position.set(Math.cos(a) * r, 110 + rng() * 70, Math.sin(a) * r);
    g.rotation.y = rng() * 6;
    clouds.add(g);
  }
  scene.add(clouds);
  return { sky, uniforms, clouds, cloudMat: cm };
}

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = C(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// Split instances into spatial clusters so frustum/shadow culling can skip far-away ones
function clustered(scene, geo, mat, items, place, size = 160) {
  const groups = new Map();
  items.forEach(it => {
    const key = Math.floor((it.x + HALF) / size) * 100 + Math.floor((it.z + HALF) / size);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });
  const meshes = [];
  for (const list of groups.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => place(im, it, i));
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im); meshes.push(im);
  }
  return meshes;
}

export function buildTrees(T, scene) {
  const pineGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), 0x5b3d24),
    colored(new THREE.ConeGeometry(2.0, 3.6, 7).translate(0, 3.4, 0), 0x2f6b34),
    colored(new THREE.ConeGeometry(1.6, 3.0, 7).translate(0, 5.0, 0), 0x357a3a),
    colored(new THREE.ConeGeometry(1.1, 2.4, 7).translate(0, 6.5, 0), 0x3d8a42),
  ]);
  const roundGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.2, 0.3, 2.6, 6).translate(0, 1.3, 0), 0x6a4a2c),
    colored(new THREE.IcosahedronGeometry(2.1, 0).translate(0, 4.0, 0), 0x5e9a3c),
    colored(new THREE.IcosahedronGeometry(1.5, 0).translate(0.9, 5.0, 0.4), 0x6aa843),
    colored(new THREE.IcosahedronGeometry(1.3, 0).translate(-0.8, 4.8, -0.5), 0x558f36),
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const pines = T.trees.filter(t => t.pine), rounds = T.trees.filter(t => !t.pine);
  const rng = makeRng(5);
  const out = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
  for (const [list, geo] of [[pines, pineGeo], [rounds, roundGeo]]) {
    out.push(...clustered(scene, geo, mat, list, (im, t, i) => {
      p.set(t.x, t.y - 0.2, t.z);
      q.setFromAxisAngle(Y, t.rot);
      sc.set(t.s, t.s * (0.9 + rng() * 0.35), t.s);
      im.setMatrixAt(i, m4.compose(p, q, sc));
      col.setHSL(0.25 + (rng() - 0.5) * 0.08, 0.5 + rng() * 0.3, 0.85 + rng() * 0.3);
      im.setColorAt(i, col);
    }));
  }
  // bushes (decor only)
  const bushGeo = colored(new THREE.IcosahedronGeometry(0.8, 0), 0x4c8a34);
  const bushes = [];
  for (let i = 0; i < 6000 && bushes.length < 1400; i++) {
    const x = (rng() - 0.5) * 560, z = (rng() - 0.5) * 560, h = T.heightAt(x, z);
    if (h < 1 || h > 44 || T.trailAt(x, z) > 0.01 || T.mudAt(x, z) > 0.01) continue;
    if (T.sampleArr(T.trailD, x, z) < 6.5) continue;
    bushes.push({ x, y: h, z, s: 0.5 + rng() * 0.9 });
  }
  const sv = new THREE.Vector3();
  out.push(...clustered(scene, bushGeo, mat, bushes, (im, b, i) => {
    m4.makeRotationY(rng() * 6).scale(sv.set(b.s, b.s * 0.7, b.s)).setPosition(b.x, b.y + 0.1, b.z);
    im.setMatrixAt(i, m4);
    col.setHSL(0.22 + rng() * 0.08, 0.55, 0.75 + rng() * 0.4); im.setColorAt(i, col);
  }));
  return out;
}

export function buildRocks(T, scene) {
  const rng = makeRng(17);
  const base = new THREE.IcosahedronGeometry(1, 1);
  const pa = base.attributes.position;
  // deterministic lumpy rock (shared vertices displaced consistently)
  const seen = new Map();
  for (let i = 0; i < pa.count; i++) {
    const key = `${pa.getX(i).toFixed(3)},${pa.getY(i).toFixed(3)},${pa.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.86 + rng() * 0.2);
    const f = seen.get(key);
    pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f * 0.85, pa.getZ(i) * f);
  }
  base.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return clustered(scene, base, mat, T.rocks, (im, r, i) => {
    q.setFromEuler(e.set(rng() * 0.4, rng() * 6.28, rng() * 0.4));
    im.setMatrixAt(i, m4.compose(p.set(r.x, r.y, r.z), q, sc.setScalar(r.r * 1.05)));
    const g = 0.42 + rng() * 0.2;
    col.setRGB(g * 1.05, g, g * 0.93); im.setColorAt(i, col);
  });
}

function bannerTexture(text, sub, finish) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128;
  const g = cv.getContext('2d');
  if (finish) {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 32, j * 32, 32, 32); }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(250, 14, 524, 100);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ff8a1f'); gr.addColorStop(1, '#e2541b');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 1024; i += 64) g.fillRect(i, 0, 32, 10), g.fillRect(i + 32, 118, 32, 10);
  }
  g.fillStyle = '#fff'; g.font = 'bold 72px system-ui, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 60);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildGates(T, scene) {
  const gates = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffc533, roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < COURSE.length; i++) {
    const cp = T.checkpoint(i);
    const g = new THREE.Group();
    g.position.set(cp.x, 0, cp.z);
    g.rotation.y = Math.atan2(cp.tx, cp.tz);
    const W = 6.5;
    const ys = [];
    for (const sx of [-W, W]) {
      // local +x in group == world direction rotated; find ground height at the post
      const wx = cp.x + Math.cos(g.rotation.y) * sx, wz = cp.z - Math.sin(g.rotation.y) * sx;
      const gy = T.heightAt(wx, wz);
      ys.push(gy);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.5, 8), postMat);
      post.position.set(sx, gy + 2.75 - 0.3, 0); post.castShadow = true; g.add(post);
      for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.45, 8), stripe); st.position.set(sx, gy + 0.6 + k * 1.5, 0); g.add(st); }
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), flagMat);
      flag.position.set(sx + Math.sign(sx) * 0.48, gy + 5.0, 0); g.add(flag);
    }
    const top = Math.max(...ys) + 5.2;
    const label = i === 0 ? 'FINISH' : `${i} · ${CP_LABELS[i].toUpperCase()}`;
    const tex = bannerTexture(label, '', i === 0);
    const bm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.6, 1.5, 0.12), [postMat, postMat, postMat, postMat, bm, bm]);
    banner.position.set(0, top, 0); banner.castShadow = true; g.add(banner);
    // flip the back face texture so it reads correctly from behind
    scene.add(g);
    gates.push({ group: g, cp, banner, bannerMat: bm });
  }
  // beacon beam + ground ring for next checkpoint
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 120, 24, 1, true), beamMat);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.18, 8, 48).rotateX(Math.PI / 2), ringMat);
  scene.add(beam, ring);
  return { gates, beam, ring, beamMat, ringMat };
}

// arrow above the truck pointing at the next checkpoint
export function buildArrow(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa500, emissiveIntensity: 0.6, roughness: 0.4 });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.9), mat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 1.0).translate(0, 0, 0), mat);
  head.scale.y = 0.4;
  g.add(head, tail);
  scene.add(g);
  return g;
}

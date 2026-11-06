// Trees (ez-tree generated, instanced near / billboard impostors far), bushes
import * as THREE from 'three';
import { Tree } from '../node_modules/@dgreenheck/ez-tree/src/lib/tree.js';
import { loadPreset } from '../node_modules/@dgreenheck/ez-tree/src/lib/presets/index.js';

const VARIANTS = [
  { preset: 'Pine Medium', seed: 11, height: 19, bark: 'pine', leaf: 'pine', tint: 0xb9c79a },
  { preset: 'Pine Large', seed: 23, height: 24, bark: 'pine', leaf: 'pine', tint: 0xa9bb8c },
  { preset: 'Oak Medium', seed: 7, height: 13, bark: 'oak', leaf: 'oak', tint: 0xb5c48a },
  { preset: 'Ash Medium', seed: 5, height: 15, bark: 'oak', leaf: 'ash', tint: 0xbccf8f },
];
const BUSHES = [
  { preset: 'Bush 1', seed: 3, height: 1.6, bark: 'oak', leaf: 'ash', tint: 0xa8bd80 },
  { preset: 'Bush 2', seed: 9, height: 1.3, bark: 'oak', leaf: 'aspen', tint: 0xa9c07c },
];

function generate(v, detail) {
  const tree = new Tree();
  tree.options.copy(loadPreset(v.preset));
  const o = tree.options;
  o.seed = v.seed;
  // keep silhouettes, drop invisible detail: trunk keeps some roundness, twigs are cheap
  for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = k === '0' ? Math.min(o.branch.sections[k], 9) : Math.min(o.branch.sections[k], detail >= 0.8 ? 4 : 3);
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = k === '0' ? Math.min(o.branch.segments[k], detail >= 0.8 ? 7 : 5) : 3;
  o.leaves.billboard = 'single';
  o.leaves.count = Math.max(4, Math.round(o.leaves.count * (detail >= 0.8 ? 0.85 : 0.7)));
  o.leaves.size *= detail >= 0.8 ? 1.12 : 1.2;
  tree.generate();
  const bg = tree.branchesMesh.geometry, lg = tree.leavesMesh.geometry;
  bg.computeBoundingBox();
  const lb = new THREE.Box3().setFromBufferAttribute(lg.attributes.position);
  const top = Math.max(bg.boundingBox.max.y, lb.max.y);
  const s = v.height / top;
  bg.scale(s, s, s); lg.scale(s, s, s);
  for (const g of [bg, lg]) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); g.computeBoundingSphere(); }
  if (!bg.attributes.normal) bg.computeVertexNormals();
  return { bg, lg, tris: (bg.index.count + lg.index.count) / 3 };
}

function windify(mat, uniforms, strength) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
        vec3 ip = vec3(0.0);
        #endif
        float hf = max(0.0, transformed.y) * ${strength.toFixed(3)};
        float ph = dot(ip.xz, vec2(0.13, 0.17));
        transformed.x += (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 3.1 + ph * 2.0 + transformed.y) * 0.25) * hf;
        transformed.z += (cos(uTime * 1.1 + ph) * 0.45) * hf;`);
  };
  mat.customProgramCacheKey = () => 'wind' + strength;
}

export function buildVegetation(T, scene, renderer, tex, quality) {
  const detail = quality === 'low' ? 0.5 : quality === 'medium' ? 0.65 : 0.8;
  const uniforms = { uTime: { value: 0 } };
  const barkMat = {}, leafMat = {};
  for (const b of ['pine', 'oak']) {
    barkMat[b] = new THREE.MeshStandardMaterial({ map: tex[`${b}_bark`], normalMap: tex[`${b}_bark_n`], roughness: 0.95, color: 0xd8d0c4 });
  }
  const makeLeaf = (leaf, tint) => {
    const m = new THREE.MeshStandardMaterial({ map: tex[`${leaf}_leaf`], alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: tint, emissive: 0x0d1405, emissiveIntensity: 1 });
    windify(m, uniforms, 0.012);
    return m;
  };
  // ----- generate variants
  const vars = VARIANTS.map(v => ({ ...v, ...generate(v, detail) }));
  const bush = BUSHES.map(v => ({ ...v, ...generate(v, detail) }));
  const all = [...vars, ...bush];
  for (const v of all) { v.bmat = barkMat[v.bark]; v.lmat = makeLeaf(v.leaf, v.tint); }

  // ----- impostor atlas (render each tree variant from the side)
  const AW = 256, AH = 512, NV = vars.length;
  const rt = new THREE.WebGLRenderTarget(AW * NV, AH, { samples: 4 });
  {
    const sc = new THREE.Scene();
    sc.environment = scene.environment;
    sc.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a30, 1.6));
    const dl = new THREE.DirectionalLight(0xfff2dd, 2.6); dl.position.set(0.4, 1, 0.8); sc.add(dl);
    const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    vars.forEach((v, i) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(v.bg, v.bmat), new THREE.Mesh(v.lg, v.lmat));
      sc.add(g);
      const hh = v.height, ww = hh * 0.5;
      const cam = new THREE.OrthographicCamera(-ww / 2 * 1.0, ww / 2 * 1.0, hh, 0, -100, 100);
      cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
      renderer.setViewport(i * AW, 0, AW, AH); renderer.setScissor(i * AW, 0, AW, AH); renderer.setScissorTest(true);
      renderer.render(sc, cam);
      sc.remove(g);
      v.impW = ww;
    });
    renderer.setScissorTest(false); renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevA);
  }
  const impMat = new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.45, side: THREE.DoubleSide });
  impMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar; attribute vec2 aSize;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = vec2((aVar + uv.x) / ${NV.toFixed(1)}, uv.y);`)
      .replace('#include <project_vertex>', `
        vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sc = length(instanceMatrix[0].xyz);
        vec3 camR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 wp = base + camR * position.x * aSize.x * sc + vec3(0.0, position.y * aSize.y * sc, 0.0);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.9;');
  };
  impMat.customProgramCacheKey = () => 'impostor';
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const maxImp = T.trees.length;
  const impGeo = quad.clone();
  const aVar = new THREE.InstancedBufferAttribute(new Float32Array(maxImp), 1);
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(maxImp * 2), 2);
  impGeo.setAttribute('aVar', aVar); impGeo.setAttribute('aSize', aSize);
  const impMesh = new THREE.InstancedMesh(impGeo, impMat, maxImp);
  impMesh.frustumCulled = false; impMesh.count = 0;
  scene.add(impMesh);

  // ----- near instanced meshes
  const near = vars.map(v => {
    const b = new THREE.InstancedMesh(v.bg, v.bmat, 1200), l = new THREE.InstancedMesh(v.lg, v.lmat, 1200);
    for (const m of [b, l]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; scene.add(m); }
    return { b, l };
  });
  // bushes: scatter along trail edges + in forest
  const bushes = [];
  const rng = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 30000 && bushes.length < 3500; i++) {
    const x = (rng() - 0.5) * 560, z = (rng() - 0.5) * 560;
    const td = T.sampleArr(T.trailD, x, z);
    if (td < 5.2 || T.mudAt(x, z) > 0.02) continue;
    const h = T.heightAt(x, z); if (h < 0.8) continue;
    const p = td < 14 ? 0.7 : T.forestAt(x, z) * 0.35;
    if (rng() > p) continue;
    bushes.push({ x, y: h, z, s: 0.7 + rng() * 0.8, kind: rng() < 0.5 ? 0 : 1, rot: rng() * 6.28 });
  }
  const nearBush = bush.map(v => {
    const b = new THREE.InstancedMesh(v.bg, v.bmat, 1500), l = new THREE.InstancedMesh(v.lg, v.lmat, 1500);
    for (const m of [b, l]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; scene.add(m); }
    return { b, l };
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const last = new THREE.Vector3(1e9, 0, 0);
  let nearR = quality === 'low' ? 55 : quality === 'medium' ? 75 : 95;
  const bushR = quality === 'low' ? 30 : 50;
  function refresh(cam, force) {
    if (!force && last.distanceToSquared(cam) < 16) return;
    last.copy(cam);
    const counts = vars.map(() => 0), bc = bush.map(() => 0);
    let ic = 0;
    const r2 = nearR * nearR;
    for (const t of T.trees) {
      const dx = t.x - cam.x, dz = t.z - cam.z, d2 = dx * dx + dz * dz;
      const v = vars[t.kind];
      q.setFromAxisAngle(Y, t.rot);
      if (d2 < r2) {
        const k = counts[t.kind]++;
        if (k >= 1200) continue;
        m4.compose(pv.set(t.x, t.y - 0.15, t.z), q, sv.setScalar(t.s));
        near[t.kind].b.setMatrixAt(k, m4); near[t.kind].l.setMatrixAt(k, m4);
      } else if (d2 < 900 * 900) {
        m4.compose(pv.set(t.x, t.y - 0.2, t.z), q, sv.setScalar(t.s));
        impMesh.setMatrixAt(ic, m4);
        aVar.array[ic] = t.kind; aSize.array[ic * 2] = v.impW; aSize.array[ic * 2 + 1] = v.height;
        ic++;
      }
    }
    near.forEach((n, i) => { n.b.count = n.l.count = Math.min(1200, counts[i]); n.b.instanceMatrix.needsUpdate = n.l.instanceMatrix.needsUpdate = true; });
    impMesh.count = ic; impMesh.instanceMatrix.needsUpdate = true; aVar.needsUpdate = true; aSize.needsUpdate = true;
    const b2 = bushR * bushR;
    for (const b of bushes) {
      const dx = b.x - cam.x, dz = b.z - cam.z;
      if (dx * dx + dz * dz > b2) continue;
      const k = bc[b.kind]++; if (k >= 1500) continue;
      q.setFromAxisAngle(Y, b.rot);
      m4.compose(pv.set(b.x, b.y - 0.1, b.z), q, sv.setScalar(b.s));
      nearBush[b.kind].b.setMatrixAt(k, m4); nearBush[b.kind].l.setMatrixAt(k, m4);
    }
    nearBush.forEach((n, i) => { n.b.count = n.l.count = Math.min(1500, bc[i]); n.b.instanceMatrix.needsUpdate = n.l.instanceMatrix.needsUpdate = true; });
  }
  return {
    uniforms, refresh, impMesh,
    tris: vars.map(v => Math.round(v.tris)), bushTris: bush.map(b => Math.round(b.tris)),
    setNearRadius(r) { nearR = r; last.set(1e9, 0, 0); },
    leafMats: all.map(v => v.lmat),
    atlas: rt.texture,
  };
}

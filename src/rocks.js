// Realistic rocks: displaced boulders with triplanar photo texture + moss, and trail stones.
import * as THREE from 'three';
import { HALF } from './terrain.js';
import { makeNoise, makeRng } from './noise.js';

function boulderGeometry(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const nz = makeNoise(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sq = 0.7 + (seed % 5) * 0.06;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let d = 1 + nz.fbm(v.x * 1.4 + seed, v.y * 1.4 + v.z * 0.7, 4) * 0.32 + nz.n2(v.x * 5 + v.z * 3, v.y * 5) * 0.05;
    // flattish facets
    d = Math.min(d, 1.08 + nz.n2(v.y * 2, v.z * 2) * 0.05);
    v.multiplyScalar(d);
    v.y *= sq;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function rockMaterial(tex, mossy) {
  const m = new THREE.MeshStandardMaterial({ map: tex.boulder_col, normalMap: tex.boulder_nor, roughness: 0.88, color: 0xc9c2b8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tRockN = { value: tex.boulder_nor };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 rw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        rw = instanceMatrix * rw;
        #endif
        vRP = (modelMatrix * rw).xyz;
        vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vRP; varying vec3 vRN;
        float rh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vRN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 tc = texture2D(map, vRP.zy * 0.35).rgb * bw.x + texture2D(map, vRP.xz * 0.35).rgb * bw.y + texture2D(map, vRP.xy * 0.35).rgb * bw.z;
        diffuseColor.rgb *= tc;
        float moss = smoothstep(0.45, 0.85, normalize(vRN).y) * ${mossy ? '0.85' : '0.0'};
        moss *= smoothstep(0.3, 0.6, texture2D(map, vRP.xz * 0.11).g + 0.15);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.07), moss);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 tnx = texture2D(normalMap, vRP.xz * 0.35).xyz * 2.0 - 1.0;
        normal = normalize(normal + (viewMatrix * vec4(tnx.x, 0.0, tnx.y, 0.0)).xyz * 0.55);`);
  };
  m.customProgramCacheKey = () => 'rock' + mossy;
  return m;
}

export function buildRocks(T, scene, tex) {
  const rng = makeRng(77);
  const shapes = [0, 1, 2, 3].map(i => boulderGeometry(13 + i * 7, 3));
  const small = [0, 1].map(i => boulderGeometry(91 + i * 5, 1));
  const mossMat = rockMaterial(tex, true), dryMat = rockMaterial(tex, false);
  const out = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // physics rocks (boulders): split by shape and spatial cluster
  const groups = new Map();
  T.rocks.forEach(r => {
    const key = (Math.floor((r.x + HALF) / 160) * 10 + Math.floor((r.z + HALF) / 160)) * 10 + Math.floor(rng() * 4);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  for (const [key, list] of groups) {
    const im = new THREE.InstancedMesh(shapes[key % 4], list[0].garden ? dryMat : mossMat, list.length);
    list.forEach((r, i) => {
      q.setFromEuler(e.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4));
      im.setMatrixAt(i, m4.compose(p.set(r.x, r.y, r.z), q, s.set(r.r * 1.05, r.r * 1.05, r.r * 1.05)));
    });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    scene.add(im); out.push(im);
  }
  // decorative trail stones (no physics): embedded gravel & cobbles across the trail
  const stones = [];
  const pts = T.trailPts;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const lat = (rng() - 0.5) * 8.5;
      const x = a[0] + tx * rng() - (tz / l) * lat, z = a[1] + tz * rng() + (tx / l) * lat;
      if (T.mudAt(x, z) > 0.3) continue;
      const r = 0.06 + Math.pow(rng(), 2.2) * 0.32;
      stones.push({ x, z, y: T.heightAt(x, z) - r * 0.45, r });
    }
  }
  const sg = new Map();
  stones.forEach(st => { const key = (Math.floor((st.x + HALF) / 120) * 10 + Math.floor((st.z + HALF) / 120)) * 2 + (st.r > 0.18 ? 1 : 0); if (!sg.has(key)) sg.set(key, []); sg.get(key).push(st); });
  for (const [key, list] of sg) {
    const im = new THREE.InstancedMesh(small[key % 2], dryMat, list.length);
    list.forEach((st, i) => {
      q.setFromEuler(e.set(rng() * 6, rng() * 6, rng() * 6));
      im.setMatrixAt(i, m4.compose(p.set(st.x, st.y, st.z), q, s.set(st.r * (0.8 + rng() * 0.5), st.r * 0.7, st.r)));
    });
    im.castShadow = key % 2 === 1; im.receiveShadow = true; im.computeBoundingSphere();
    scene.add(im); out.push(im);
  }
  return { meshes: out, stoneCount: stones.length };
}

export function buildWater(scene, tex) {
  const nm = tex.waternormals;
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
  nm.repeat.set(90, 90);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x1f3326, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: nm, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.3, clearcoat: 0.6, clearcoatRoughness: 0.08 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.2, HALF * 2.2).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.0;
  m.receiveShadow = true;
  scene.add(m);
  return { mesh: m, update(t) { nm.offset.set(t * 0.008, t * 0.005); } };
}

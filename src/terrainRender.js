// Photo-textured PBR terrain: splat-blended layers, anti-tiling, triplanar cliffs, canopy shading
import * as THREE from 'three';
import { HALF, N, RES } from './terrain.js';
import { clamp, smoothstep } from './noise.js';

export function buildTerrain(T, scene, tex) {
  const CH = 80, nC = (HALF * 2) / CH;
  // ----- per-vertex splat weights (global grid)
  const SA = new Uint8Array(N * N * 4), SB = new Uint8Array(N * N * 4);
  const NOR = new Float32Array(N * N * 3);
  // canopy density grid (stamp trees)
  const shade = new Float32Array(N * N);
  for (const t of T.trees) {
    const ci = Math.round((t.x + HALF) / RES), cj = Math.round((t.z + HALF) / RES), R = 6;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d2 = ((i - ci) ** 2 + (j - cj) ** 2) * RES * RES;
      shade[j * N + i] += Math.exp(-d2 / 14) * 0.55;
    }
  }
  const nz = T.noise;
  for (let gj = 0; gj < N; gj++) for (let gi = 0; gi < N; gi++) {
    const id = gj * N + gi;
    const x = -HALF + gi * RES, z = -HALF + gj * RES, h = T.h[id];
    const hl = T.h[gj * N + Math.max(0, gi - 1)], hr = T.h[gj * N + Math.min(N - 1, gi + 1)];
    const hd = T.h[Math.max(0, gj - 1) * N + gi], hu = T.h[Math.min(N - 1, gj + 1) * N + gi];
    let nx = hl - hr, ny = 2 * RES, nzv = hd - hu; const l = Math.hypot(nx, ny, nzv); nx /= l; ny /= l; nzv /= l;
    NOR[id * 3] = nx; NOR[id * 3 + 1] = ny; NOR[id * 3 + 2] = nzv;
    const slope = 1 - ny;
    let forest = clamp(T.forestAt(x, z) * 0.9 + Math.min(1, shade[id]) * 0.6, 0, 1);
    let grass = 1 - forest;
    let rock = smoothstep(0.17, 0.32, slope + nz.n2(x * 0.05, z * 0.05) * 0.06);
    if (h > 34) rock = Math.max(rock, smoothstep(34, 48, h + nz.n2(x * 0.03, z * 0.03) * 6) * 0.85);
    grass *= 1 - rock; forest *= 1 - rock;
    const tr = T.trail[id];
    grass *= 1 - tr; forest *= 1 - tr; rock *= 1 - tr;
    const mud = smoothstep(0.0, 0.55, T.mud[id]);
    const keep = 1 - mud;
    const wet = 1 - smoothstep(0.2, 1.6, h);
    SA[id * 4] = grass * keep * 255; SA[id * 4 + 1] = forest * keep * 255; SA[id * 4 + 2] = rock * keep * 255; SA[id * 4 + 3] = tr * keep * 255;
    SB[id * 4] = mud * 255; SB[id * 4 + 1] = wet * 255; SB[id * 4 + 2] = clamp(1 - Math.min(1, shade[id]) * 0.45, 0, 1) * 255; SB[id * 4 + 3] = 255;
  }
  T.splatA = SA; T.splatB = SB; T.shade = shade;

  // ----- material
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const U = {
    tGrass: { value: tex.grass_col }, nGrass: { value: tex.grass_nor },
    tForest: { value: tex.forest_col }, nForest: { value: tex.forest_nor },
    tRock: { value: tex.rock_col }, nRock: { value: tex.rock_nor },
    tTrail: { value: tex.trail_col }, nTrail: { value: tex.trail_nor },
    tMud: { value: tex.mud_col }, nMud: { value: tex.mud_nor },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splatA; attribute vec4 splatB;
        varying vec4 vSA; varying vec4 vSB; varying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSA = splatA; vSB = splatB; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, nGrass, tForest, nForest, tRock, nRock, tTrail, nTrail, tMud, nMud;
        varying vec4 vSA; varying vec4 vSB; varying vec3 vWPos; varying vec3 vWNorm;
        float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }
        vec3 colAT(sampler2D t, vec2 uv, float m){ vec3 a = texture2D(t, uv).rgb; vec3 b = texture2D(t, uv*0.37 + vec2(0.31,0.73)).rgb; return mix(a, b, m); }
        vec3 norT(sampler2D t, vec2 uv){ return texture2D(t, uv).xyz * 2.0 - 1.0; }
      `)
      .replace('#include <map_fragment>', `
        vec3 Nw = normalize(vWNorm);
        vec2 P = vWPos.xz;
        float macro = smoothstep(0.25, 0.75, vn(P * 0.045) * 0.65 + vn(P * 0.19) * 0.35);
        float macro2 = vn(P * 0.013);
        vec4 sa = vSA; vec2 sb = vSB.xy;
        float wsum = sa.x + sa.y + sa.z + sa.w + sb.x + 1e-4;
        sa /= wsum; float wm = sb.x / wsum;
        // sharpen blends with texture-ish noise for natural edges
        vec3 alb = vec3(0.0); vec3 tn = vec3(0.0); float rough = 0.0;
        vec2 uvF = vec2(P.x, -P.y);
        if (sa.x > 0.01) { vec2 uv = uvF * 0.34; vec3 c = colAT(tGrass, uv, macro) * vec3(0.78, 0.98, 0.62) * mix(0.82, 1.12, macro2);
          alb += c * sa.x; tn += norT(nGrass, uv) * sa.x; rough += 0.93 * sa.x; }
        if (sa.y > 0.01) { vec2 uv = uvF * 0.3; alb += colAT(tForest, uv, macro) * vec3(0.92, 0.9, 0.82) * sa.y; tn += norT(nForest, uv) * sa.y; rough += 0.9 * sa.y; }
        if (sa.w > 0.01) { vec2 uv = uvF * 0.32; alb += colAT(tTrail, uv, macro) * vec3(0.95, 0.92, 0.88) * sa.w; tn += norT(nTrail, uv) * sa.w; rough += 0.86 * sa.w; }
        if (wm > 0.01) { vec2 uv = uvF * 0.3; alb += colAT(tMud, uv, macro) * vec3(0.85, 0.82, 0.8) * wm; tn += norT(nMud, uv) * 0.6 * wm; rough += 0.42 * wm; }
        if (sa.z > 0.01) {
          vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 c = texture2D(tRock, vWPos.zy * 0.11).rgb * bw.x + texture2D(tRock, vWPos.xz * 0.11).rgb * bw.y + texture2D(tRock, vWPos.xy * 0.11).rgb * bw.z;
          vec3 n = norT(nRock, vWPos.xz * 0.11);
          alb += c * sa.z; tn += n * sa.z; rough += 0.8 * sa.z;
        }
        // wet edge near water
        alb *= mix(1.0, 0.55, sb.y); rough = mix(rough, 0.25, sb.y * 0.8);
        // canopy shade (fake AO under trees)
        alb *= vSB.z;
        diffuseColor.rgb = alb;
        // perturb world normal (tangent = +x, bitangent = -z)
        vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
        vec3 Bg = normalize(cross(Tg, Nw));
        vec3 pn = normalize(Tg * tn.x * 1.1 + Bg * tn.y * 1.1 + Nw * max(tn.z, 0.2));
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(rough, 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'terrainPBR';

  function chunkGeo(ci, cj, step, skirt) {
    const cells = CH / RES / step, vPer = cells + 1;
    const extra = skirt ? cells * 4 : 0, count = vPer * vPer + extra;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), a = new Uint8Array(count * 4), b = new Uint8Array(count * 4);
    const put = (k, gi, gj, dy) => {
      const id = gj * N + gi;
      pos[k * 3] = -HALF + gi * RES; pos[k * 3 + 1] = T.h[id] + dy; pos[k * 3 + 2] = -HALF + gj * RES;
      nor[k * 3] = NOR[id * 3]; nor[k * 3 + 1] = NOR[id * 3 + 1]; nor[k * 3 + 2] = NOR[id * 3 + 2];
      for (let c = 0; c < 4; c++) { a[k * 4 + c] = SA[id * 4 + c]; b[k * 4 + c] = SB[id * 4 + c]; }
    };
    const gi0 = ci * (CH / RES), gj0 = cj * (CH / RES);
    for (let j = 0; j < vPer; j++) for (let i = 0; i < vPer; i++) put(j * vPer + i, gi0 + i * step, gj0 + j * step, 0);
    const idx = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { const p = j * vPer + i; idx.push(p, p + vPer, p + 1, p + 1, p + vPer, p + vPer + 1); }
    if (skirt) {
      const loop = [];
      for (let i = 0; i < cells; i++) loop.push([i, 0]);
      for (let j = 0; j < cells; j++) loop.push([cells, j]);
      for (let i = cells; i > 0; i--) loop.push([i, cells]);
      for (let j = cells; j > 0; j--) loop.push([0, j]);
      const base = vPer * vPer;
      loop.forEach(([i, j], k) => put(base + k, gi0 + i * step, gj0 + j * step, -3));
      for (let k = 0; k < loop.length; k++) {
        const k2 = (k + 1) % loop.length, t0 = loop[k][1] * vPer + loop[k][0], t1 = loop[k2][1] * vPer + loop[k2][0];
        idx.push(t0, base + k, t1, t1, base + k, base + k2, t0, t1, base + k, t1, base + k2, base + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('splatA', new THREE.BufferAttribute(a, 4, true));
    g.setAttribute('splatB', new THREE.BufferAttribute(b, 4, true));
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
    mat,
    update(cam, far, fineDist = 115) {
      for (const c of chunks) {
        const d = Math.max(0, Math.hypot(c.cx - cam.x, c.cz - cam.z) - CH * 0.7);
        const vis = d < far;
        c.fine.visible = vis && d < fineDist;
        c.coarse.visible = vis && d >= fineDist;
      }
    },
  };
}

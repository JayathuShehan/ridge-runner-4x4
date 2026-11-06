// GPU grass field: instanced crossed-card clumps placed in the vertex shader around the camera.
import * as THREE from 'three';
import { HALF, N, RES } from './terrain.js';

function grassTexture() {
  const W = 256, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 120; i++) {
    const x0 = 8 + r() * (W - 16), h = H * (0.45 + r() * 0.55), lean = (r() - 0.5) * 70, w = 2 + r() * 4;
    const grd = g.createLinearGradient(0, H, 0, H - h);
    const hue = 70 + r() * 30, light = 22 + r() * 18;
    grd.addColorStop(0, `hsl(${hue - 10}, 45%, ${light * 0.55}%)`);
    grd.addColorStop(0.6, `hsl(${hue}, 50%, ${light}%)`);
    grd.addColorStop(1, `hsl(${hue + 5}, 45%, ${light + 14}%)`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x0 - w, H);
    g.quadraticCurveTo(x0 - w * 0.6 + lean * 0.3, H - h * 0.5, x0 + lean, H - h);
    g.quadraticCurveTo(x0 + w * 0.6 + lean * 0.3, H - h * 0.5, x0 + w, H);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildGrass(T, scene, quality) {
  const spacing = quality === 'high' ? 0.3 : quality === 'medium' ? 0.4 : 0.55;
  const extent = quality === 'high' ? 58 : quality === 'medium' ? 44 : 30;
  const grid = Math.round(extent / spacing);
  // height texture (float, nearest; bilinear done in shader)
  const hTex = new THREE.DataTexture(T.h, N, N, THREE.RedFormat, THREE.FloatType);
  hTex.magFilter = hTex.minFilter = THREE.NearestFilter; hTex.needsUpdate = true;
  // density texture
  const dens = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const g = T.splatA[i * 4] / 255, f = T.splatA[i * 4 + 1] / 255, wet = T.splatB[i * 4 + 1] / 255;
    dens[i] = Math.max(0, Math.min(1, (g * 1.0 + f * 0.35) * (1 - wet))) * 255;
  }
  const dTex = new THREE.DataTexture(dens, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  dTex.magFilter = dTex.minFilter = THREE.LinearFilter; dTex.needsUpdate = true;

  // clump of curved, tapered blades (real geometry, 5 tris each)
  const base = new THREE.BufferGeometry();
  {
    const pos = [], uv = [], nrm = [], idx = [];
    let sd = 3; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const BL = quality === 'high' ? 7 : quality === 'medium' ? 6 : 5;
    for (let k = 0; k < BL; k++) {
      const a = r() * Math.PI * 2, ox = (r() - 0.5) * 0.32, oz = (r() - 0.5) * 0.32;
      const h = 0.55 + r() * 0.55, w = 0.028 + r() * 0.022, bend = 0.15 + r() * 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const v0 = pos.length / 3;
      const segs = [0, 0.35, 0.7, 1.0];
      segs.forEach((t, i) => {
        const ww = w * (1 - t * 0.85);
        const fwd = bend * t * t;          // curve outward
        const cx = ox + ca * fwd, cz = oz + sa * fwd, y = h * t * (1 - 0.15 * t);
        if (i < 3) {
          pos.push(cx - sa * ww, y, cz + ca * ww, cx + sa * ww, y, cz - ca * ww);
          uv.push(0, t, 1, t);
          nrm.push(ca * 0.5, 0.85, sa * 0.5, ca * 0.5, 0.85, sa * 0.5);
        } else { pos.push(cx, y, cz); uv.push(0.5, 1); nrm.push(ca * 0.4, 0.9, sa * 0.4); }
      });
      idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4, v0 + 3, v0 + 5, v0 + 4, v0 + 4, v0 + 5, v0 + 6);
    }
    base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    base.setAttribute('aBlade', new THREE.Float32BufferAttribute(uv, 2));
    base.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    base.setIndex(idx);
  }
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = grid * grid;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSpacing: { value: spacing }, uGrid: { value: grid },
    uH: { value: hTex }, uD: { value: dTex }, uHalf: { value: HALF }, uN: { value: N }, uRes: { value: RES },
    uPush: { value: new THREE.Vector4(0, 0, 0, 0) }, uPush2: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      uniform vec3 uCam; uniform float uTime, uSpacing, uGrid, uHalf, uN, uRes; uniform sampler2D uH, uD; uniform vec4 uPush, uPush2;
      varying float vTint; varying float vH; attribute vec2 aBlade;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hAt(vec2 w){ vec2 g = clamp((w + uHalf) / uRes, vec2(0.0), vec2(uN - 1.001)); vec2 i = floor(g), f = g - i;
        float a = texture(uH, (i + 0.5) / uN).r, b = texture(uH, (i + vec2(1.5, 0.5)) / uN).r, c = texture(uH, (i + vec2(0.5, 1.5)) / uN).r, d = texture(uH, (i + 1.5) / uN).r;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`)
      .replace('#include <beginnormal_vertex>', `
        float id = float(gl_InstanceID);
        vec2 cellI = vec2(mod(id, uGrid), floor(id / uGrid));
        vec2 cell = floor(uCam.xz / uSpacing) + cellI - floor(uGrid * 0.5);
        float r1 = gh(cell), r2 = gh(cell + 17.3), r3 = gh(cell + 41.7);
        vec2 wp = (cell + vec2(r1, r2)) * uSpacing;
        float dens = texture(uD, (wp + uHalf) / uRes / uN + 0.5 / uN).r;
        float dist = length(wp - uCam.xz);
        float fade = 1.0 - smoothstep(uGrid * uSpacing * 0.32, uGrid * uSpacing * 0.5, dist);
        float keep = step(r3, dens * 1.15) * fade;
        float sc = (0.45 + r1 * 0.45) * (0.55 + dens * 0.6) * keep;
        float ang = r2 * 6.2831;
        float cs = cos(ang), sn = sin(ang);
        vec3 objectNormal = normalize(mix(normal, vec3(0.0,1.0,0.0), 0.35));
        objectNormal.xz = mat2(cs, -sn, sn, cs) * objectNormal.xz;
      `).replace('#include <begin_vertex>', `
        vec3 transformed = position;
        
        transformed *= sc;
        transformed.xz = mat2(cs, -sn, sn, cs) * transformed.xz;
        // wind
        float w = aBlade.y * aBlade.y;
        transformed.x += (sin(uTime * 1.8 + wp.x * 0.35 + wp.y * 0.2) * 0.12 + sin(uTime * 4.3 + wp.x * 1.3) * 0.04) * w * sc;
        transformed.z += cos(uTime * 1.5 + wp.y * 0.3) * 0.08 * w * sc;
        // flatten where the truck drives over (two push points)
        for (int k = 0; k < 2; k++) {
          vec4 pp = k == 0 ? uPush : uPush2;
          vec2 dv = wp - pp.xy; float dd = length(dv);
          float pf = (1.0 - smoothstep(0.0, pp.z, dd)) * pp.w;
          transformed.y *= 1.0 - pf * 0.75;
          transformed.xz += normalize(dv + 1e-4) * pf * 0.25 * aBlade.y;
        }
        transformed.xz += wp;
        transformed.y += hAt(wp) - 0.03;
        vTint = 0.8 + r3 * 0.35; vH = aBlade.y;
      `);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTint; varying float vH;')
      .replace('#include <map_fragment>', `
        vec3 gBase = vec3(0.03, 0.06, 0.012), gMid = vec3(0.11, 0.2, 0.035), gTip = vec3(0.3, 0.4, 0.1);
        vec3 gc = vH < 0.55 ? mix(gBase, gMid, vH / 0.55) : mix(gMid, gTip, (vH - 0.55) / 0.45);
        diffuseColor.rgb = gc * vTint;`);
  };
  mat.customProgramCacheKey = () => 'grassfield';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return {
    mesh, uniforms,
    update(cam, t, truck) {
      uniforms.uCam.value.copy(cam); uniforms.uTime.value = t;
      if (truck) {
        uniforms.uPush.value.set(truck.x, truck.z, 2.2, truck.w);
      }
    },
  };
}

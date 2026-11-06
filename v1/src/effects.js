// Particles (mud, dust, water spray, exhaust) and tire tracks
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 2500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 100 }, fogFar: { value: 500 }, light: { value: 1 } },
      transparent: true, depthWrite: false,
      vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC; varying float vD; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC; varying float vD; uniform vec3 fogColor; uniform float fogNear, fogFar, light;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          float a = vA * exp(-r * 14.0) * (1.0 - smoothstep(0.2, 0.25, r));
          vec3 c = mix(vC * light, fogColor, smoothstep(fogNear, fogFar, vD));
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, color, size, life, grav = 1, grow = 0, alpha = 1) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.col[o] = color.r; this.col[o + 1] = color.g; this.col[o + 2] = color.b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow; this.a0[i] = alpha;
    this.alpha[i] = alpha;
  }
  update(dt, terrain) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.81 * this.grav[i] * dt;
      const drag = 1 - (this.grav[i] < 0.3 ? 1.5 : 0.4) * dt;
      this.vel[o] *= drag; this.vel[o + 1] *= drag; this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.grav[i] > 0.5) {
        const gh = terrain.heightAt(this.pos[o], this.pos[o + 2]);
        if (this.pos[o + 1] < gh) { this.pos[o + 1] = gh; this.vel[o] *= 0.3; this.vel[o + 1] = 0; this.vel[o + 2] *= 0.3; }
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = true;
  }
}

export class Tracks {
  constructor(scene, max = 5000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.cursor = 0;
    this.last = [null, null, null, null];
    this.fadeT = 0;
    this.dirty = false;
  }
  clear() { this.last = [null, null, null, null]; }
  add(wi, p, side, n, strength, mud) {
    const half = 0.2;
    const L = [p.x + side.x * half + n.x * 0.04, p.y + side.y * half + n.y * 0.04, p.z + side.z * half + n.z * 0.04];
    const R = [p.x - side.x * half + n.x * 0.04, p.y - side.y * half + n.y * 0.04, p.z - side.z * half + n.z * 0.04];
    const last = this.last[wi];
    if (!last) { this.last[wi] = { L, R, x: p.x, z: p.z }; return; }
    const d2 = (p.x - last.x) ** 2 + (p.z - last.z) ** 2;
    if (d2 < 0.16) return;
    if (d2 > 4) { this.last[wi] = { L, R, x: p.x, z: p.z }; return; }
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([...last.L, ...last.R, ...L, ...R], i * 12);
    const c = mud ? [0.12, 0.08, 0.05] : [0.22, 0.17, 0.11];
    const a = Math.min(0.75, 0.25 + strength * 0.5);
    for (let k = 0; k < 4; k++) this.col.set([c[0], c[1], c[2], a], i * 16 + k * 4);
    this.last[wi] = { L, R, x: p.x, z: p.z };
    this.dirty = true;
  }
  update(dt) {
    this.fadeT += dt;
    if (this.fadeT > 0.5) {
      this.fadeT = 0;
      for (let i = 3; i < this.col.length; i += 4) if (this.col[i] > 0) this.col[i] = Math.max(0, this.col[i] - 0.004);
      this.dirty = true;
    }
    if (this.dirty) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.dirty = false; }
  }
}

// Terrain data: heightfield, trail, surfaces, rocks, trees. No rendering here.
import * as THREE from 'three';
import { makeNoise, makeRng, clamp, lerp, smoothstep } from './noise.js';

export const HALF = 320;          // world spans [-HALF, HALF]
export const RES = 1;             // grid spacing (m)
export const N = (HALF * 2) / RES + 1;
export const WATER = 0;

// Trail control points (x, z). Index 0 = start / finish.
export const COURSE = [
  [0, 0], [0, 70], [40, 150], [120, 185], [200, 115], [190, -40],
  [150, -155], [40, -200], [-100, -200], [-190, -110], [-195, 30], [-125, 145], [-55, 130], [-55, 45],
];
// Which control points are checkpoints, with a short label
export const CP_LABELS = [
  'Finish', 'Warm-up', 'Whoops', 'Mud Pit', 'Ridge', 'Summit', 'Descent',
  'River Ford', 'Rock Garden', 'Canyon', 'Forest Run', 'Jumps', 'The Bog', 'Home Stretch',
];

const RIVER = [[95, -320], [75, -240], [62, -175], [40, -130], [5, -108], [-35, -100]];
const LAKE = { x: -60, z: -95, r: 42 };
const MOUNTAINS = [
  { x: 190, z: -40, a: 44, s: 62 },
  { x: -230, z: 200, a: 75, s: 70 },
  { x: 250, z: 240, a: 60, s: 60 },
  { x: -250, z: -260, a: 55, s: 55 },
];

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
function distToPoly(px, pz, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, distToSeg(px, pz, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]));
  return d;
}

export class Terrain {
  constructor(seed = 11) {
    this.noise = makeNoise(seed);
    this.rng = makeRng(seed * 7 + 3);
    const NN = N * N;
    this.h = new Float32Array(NN);
    this.mud = new Float32Array(NN);
    this.trail = new Float32Array(NN);     // 0..1 dirt-road mask
    this.trailS = new Float32Array(NN);    // distance along trail of nearest sample
    this.trailD = new Float32Array(NN).fill(1e9);
    this.river = new Float32Array(NN);
    this.generate();
  }

  idx(i, j) { return j * N + i; }

  baseHeight(x, z) {
    const nz = this.noise;
    let h = 4 + (nz.fbm(x * 0.0032 + 13.1, z * 0.0032 - 7.7, 4) + 0.7) * 17;
    h += nz.fbm(x * 0.018 + 50, z * 0.018 + 20, 3) * 2.2;
    h += nz.n2(x * 0.08, z * 0.08) * 0.25;
    for (const m of MOUNTAINS) {
      const dx = x - m.x, dz = z - m.z;
      const g = Math.exp(-(dx * dx + dz * dz) / (2 * m.s * m.s));
      h += m.a * g + g * nz.ridged(x * 0.012, z * 0.012, 4) * 14;
    }
    // edge walls keep the player in
    const d = Math.max(Math.abs(x), Math.abs(z));
    if (d > 245) h += Math.pow((d - 245) / 75, 2) * 80;
    // flat start area
    const ds = Math.hypot(x, z);
    h = lerp(5, h, smoothstep(22, 60, ds));
    // lake
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + nz.n2(x * 0.03, z * 0.03) * 8;
    const lk = 1 - smoothstep(LAKE.r * 0.45, LAKE.r * 1.25, dl);
    h = lerp(h, -4.5, lk);
    return h;
  }

  generate() {
    const { h } = this;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * RES;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * RES;
        let v = this.baseHeight(x, z);
        // river carve (before trail so the trail smoothing sees banks)
        const dr = distToPoly(x, z, RIVER) + this.noise.n2(x * 0.05, z * 0.05) * 2.5;
        const rm = 1 - smoothstep(4, 22, dr);
        this.river[this.idx(i, j)] = 1 - smoothstep(3, 9, dr);
        v = lerp(v, Math.min(v, -1.8), rm * rm * (3 - 2 * rm));
        h[this.idx(i, j)] = v;
      }
    }
    this.buildTrail();
    this.features();
  }

  // raw grid sample (bilinear) on an arbitrary array
  sampleArr(arr, x, z) {
    let gx = (x + HALF) / RES, gz = (z + HALF) / RES;
    gx = clamp(gx, 0, N - 1.001); gz = clamp(gz, 0, N - 1.001);
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const a = j * N + i;
    const h00 = arr[a], h10 = arr[a + 1], h01 = arr[a + N], h11 = arr[a + N + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }
  heightAt(x, z) { return this.sampleArr(this.h, x, z); }
  mudAt(x, z) { return this.sampleArr(this.mud, x, z); }
  trailAt(x, z) { return this.sampleArr(this.trail, x, z); }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e));
    return out.normalize();
  }

  buildTrail() {
    const pts = COURSE.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const len = curve.getLength();
    const n = Math.ceil(len / 1.0);
    const samples = curve.getSpacedPoints(n); // n+1 points, last == first
    samples.pop();
    const ds = len / n;
    this.trailLen = len;
    this.trailPts = samples.map(p => [p.x, p.z]);
    // raw heights then smooth along trail
    let raw = samples.map(p => this.heightAt(p.x, p.z));
    const smooth = (arr, r) => {
      const out = new Array(arr.length);
      for (let k = 0; k < arr.length; k++) {
        let s = 0;
        for (let o = -r; o <= r; o++) s += arr[(k + o + arr.length) % arr.length];
        out[k] = s / (2 * r + 1);
      }
      return out;
    };
    for (let p = 0; p < 3; p++) raw = smooth(raw, 14);
    // gentle ramps down into the river ford
    raw = raw.map((hh, k) => {
      const dr = distToPoly(samples[k].x, samples[k].z, RIVER);
      return lerp(hh, Math.min(hh, -0.45), 1 - smoothstep(5, 60, dr));
    });
    this.trailH = raw;
    // control point arc positions
    this.cpS = COURSE.map(([x, z]) => {
      let best = 0, bd = Infinity;
      samples.forEach((p, k) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = k; } });
      return best * ds;
    });
    this.ds = ds;
    // stamp
    const R = 10;
    samples.forEach((p, k) => {
      const ci = Math.round((p.x + HALF) / RES), cj = Math.round((p.z + HALF) / RES);
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const x = -HALF + i * RES, z = -HALF + j * RES;
        const d = Math.hypot(x - p.x, z - p.z);
        const id = this.idx(i, j);
        if (d < this.trailD[id]) { this.trailD[id] = d; this.trailS[id] = k * ds; }
      }
    });
    for (let id = 0; id < N * N; id++) {
      const d = this.trailD[id];
      if (d > 50) continue;
      const k = Math.round(this.trailS[id] / ds) % samples.length;
      const hb = 1 - smoothstep(3.5, 9.5, d);
      this.h[id] = lerp(this.h[id], this.trailH[k], hb);
      this.trail[id] = 1 - smoothstep(2.6, 5.2, d + this.noise.n2(id * 0.37, 1) * 0.4);
    }
  }

  // trail-relative features: whoops, jumps, mud pits, ford
  features() {
    const S = this.cpS, L = this.trailLen;
    this.whoops = [S[1] + 22, S[2] - 18];
    this.jumps = [S[10] + 45, S[10] + 100];
    const mudPits = [
      { s: (S[2] + S[3]) / 2 + 5, r: 15 },
      { s: S[6] + 30, r: 10 },
      { s: (S[11] + S[12]) / 2, r: 21 },
    ];
    this.mudPitPos = mudPits.map(m => { const k = Math.round(m.s / this.ds) % this.trailPts.length; return { x: this.trailPts[k][0], z: this.trailPts[k][1], r: m.r }; });
    // a few off-trail mud puddles
    for (let t = 0; t < 14; t++) {
      const x = (this.rng() - 0.5) * 420, z = (this.rng() - 0.5) * 420;
      const hh = this.heightAt(x, z);
      if (hh > 2 && hh < 30 && this.trailAt(x, z) < 0.01 && Math.hypot(x, z) > 50) this.mudPitPos.push({ x, z, r: 6 + this.rng() * 8 });
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const id = this.idx(i, j);
      const x = -HALF + i * RES, z = -HALF + j * RES;
      const d = this.trailD[id], s = this.trailS[id];
      const hb = d < 50 ? 1 - smoothstep(3.0, 8.0, d) : 0;
      if (hb > 0) {
        // whoops (rhythm bumps)
        if (s > this.whoops[0] && s < this.whoops[1]) {
          const u = s - this.whoops[0], env = smoothstep(0, 8, u) * smoothstep(0, 8, this.whoops[1] - s);
          this.h[id] += 0.75 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2 / 9)) * env * hb;
        }
        // kicker jumps
        for (const sj of this.jumps) {
          const u = s - sj;
          let k = 0;
          if (u > -11 && u <= 0) k = Math.pow((u + 11) / 11, 1.6) * 2.1;
          else if (u > 0 && u < 2.2) k = 2.1 * (1 - smoothstep(0, 2.2, u));
          this.h[id] += k * hb;
        }
      }
      // mud
      let m = 0;
      for (const p of this.mudPitPos) {
        const dd = Math.hypot(x - p.x, z - p.z) + this.noise.n2(x * 0.09, z * 0.09) * p.r * 0.25;
        m = Math.max(m, 1 - smoothstep(p.r * 0.55, p.r, dd));
      }
      if (m > 0) {
        this.mud[id] = m;
        this.h[id] -= m * 0.55 - this.noise.n2(x * 0.4, z * 0.4) * 0.09 * m;
      }
      // shallow ford where trail crosses the river
      const rv = this.river[id];
      if (rv > 0 && d < 12) {
        const tm = 1 - smoothstep(4, 11, d);
        this.h[id] = lerp(this.h[id], Math.min(this.h[id], -0.45), rv * tm);
      }
    }
    this.placeRocks();
    this.placeTrees();
  }

  placeRocks() {
    const rocks = [];
    const S = this.cpS;
    const garden = [S[7] + 45, S[8] - 15];
    this.garden = garden;
    const rng = this.rng;
    const trailAtS = (s) => {
      const k = Math.round(s / this.ds) % this.trailPts.length;
      const k2 = (k + 2) % this.trailPts.length;
      const [x, z] = this.trailPts[k], [x2, z2] = this.trailPts[k2];
      const tx = x2 - x, tz = z2 - z, l = Math.hypot(tx, tz) || 1;
      return { x, z, tx: tx / l, tz: tz / l };
    };
    // rock garden on the trail: crawl-able
    for (let t = 0; t < 90; t++) {
      const s = lerp(garden[0], garden[1], rng());
      const p = trailAtS(s);
      const lat = (rng() - 0.5) * 9;
      const x = p.x - p.tz * lat, z = p.z + p.tx * lat;
      const r = 0.45 + rng() * 0.55;
      rocks.push({ x, z, y: this.heightAt(x, z) - r * 0.45, r, garden: true });
    }
    // boulders lining the garden
    for (let t = 0; t < 40; t++) {
      const s = lerp(garden[0] - 10, garden[1] + 10, rng());
      const p = trailAtS(s);
      const lat = (rng() < 0.5 ? -1 : 1) * (7 + rng() * 6);
      const x = p.x - p.tz * lat, z = p.z + p.tx * lat;
      const r = 1.2 + rng() * 1.8;
      rocks.push({ x, z, y: this.heightAt(x, z) - r * 0.35, r });
    }
    // scattered boulders
    for (let t = 0; t < 420; t++) {
      const x = (rng() - 0.5) * 560, z = (rng() - 0.5) * 560;
      if (this.trailAt(x, z) > 0.001 || this.sampleArr(this.trailD, x, z) < 9) continue;
      if (Math.hypot(x, z) < 40) continue;
      const r = 0.6 + Math.pow(rng(), 2) * 3.2;
      rocks.push({ x, z, y: this.heightAt(x, z) - r * 0.4, r });
    }
    this.rocks = rocks;
    // spatial hash
    this.rockGrid = new Map();
    const C = 8;
    rocks.forEach((r, i) => {
      const x0 = Math.floor((r.x - r.r) / C), x1 = Math.floor((r.x + r.r) / C);
      const z0 = Math.floor((r.z - r.r) / C), z1 = Math.floor((r.z + r.r) / C);
      for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) {
        const key = a * 100000 + b;
        if (!this.rockGrid.has(key)) this.rockGrid.set(key, []);
        this.rockGrid.get(key).push(i);
      }
    });
  }
  rocksNear(x, z) {
    const key = Math.floor(x / 8) * 100000 + Math.floor(z / 8);
    return this.rockGrid.get(key);
  }

  placeTrees() {
    // Dense forest corridors along the trail, open meadows elsewhere, conifers higher up.
    const trees = [], rng = this.rng, n = new THREE.Vector3();
    for (let t = 0; t < 60000 && trees.length < 7000; t++) {
      const x = (rng() - 0.5) * 600, z = (rng() - 0.5) * 600;
      const hh = this.heightAt(x, z);
      if (hh < 1.0 || hh > 70) continue;
      const td = this.sampleArr(this.trailD, x, z);
      if (td < 6.2) continue;
      if (this.mudAt(x, z) > 0.01) continue;
      if (Math.hypot(x, z) < 26) continue;
      this.normalAt(x, z, n);
      if (n.y < 0.78) continue;
      const forest = this.forestAt(x, z);
      const corridor = td < 40 ? 1 - td / 55 : 0;
      const p = Math.max(forest, corridor * 0.85);
      if (rng() > p * p) continue;
      const conifer = hh > 22 || this.noise.n2(x * 0.008 + 50, z * 0.008) > 0.05;
      const kind = conifer ? (rng() < 0.55 ? 0 : 1) : (rng() < 0.5 ? 2 : 3); // 0,1 pines  2 oak  3 ash
      trees.push({ x, z, y: hh, s: 0.75 + rng() * 0.5, kind, rot: rng() * Math.PI * 2, pine: conifer });
    }
    this.trees = trees;
    this.treeGrid = new Map();
    trees.forEach((tr, i) => {
      const key = Math.floor(tr.x / 8) * 100000 + Math.floor(tr.z / 8);
      if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
      this.treeGrid.get(key).push(i);
    });
  }
  forestAt(x, z) {
    const f = this.noise.fbm(x * 0.009 + 300, z * 0.009 - 40, 3);
    return smoothstep(-0.15, 0.25, f);
  }
  treesNear(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) {
      const l = this.treeGrid.get(a * 100000 + b);
      if (l) for (const i of l) out.push(this.trees[i]);
    }
    return out;
  }

  // checkpoint info: position + tangent
  checkpoint(i) {
    const s = this.cpS[i];
    const k = Math.round(s / this.ds) % this.trailPts.length;
    const k2 = (k + 3) % this.trailPts.length, k0 = (k - 3 + this.trailPts.length) % this.trailPts.length;
    const [x, z] = this.trailPts[k];
    const tx = this.trailPts[k2][0] - this.trailPts[k0][0], tz = this.trailPts[k2][1] - this.trailPts[k0][1];
    const l = Math.hypot(tx, tz);
    return { x, z, y: this.heightAt(x, z), tx: tx / l, tz: tz / l, s };
  }
}

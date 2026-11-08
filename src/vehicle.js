// Raycast-suspension 4x4 physics (custom rigid body) + low-poly truck model
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './noise.js';
import { WATER, HALF } from './terrain.js';
import { resolveSetup } from './garage.js';

const G = 9.81;
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _r = V(), _vp = V(), _f = V(), _s = V(), _n = V(), _o = V();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _treeList = [];

export class TruckPhysics {
  constructor(terrain) {
    this.t = terrain;
    this.mass = 1650;
    this.Ib = new THREE.Vector3(3500, 3900, 1450); // body-frame inertia (pitch, yaw, roll)
    this.pos = V(); this.vel = V(); this.angVel = V();
    this.quat = new THREE.Quaternion();
    this.right = V(); this.up = V(); this.fwd = V();
    this.R = 0.5;            // wheel radius
    this.restLen = 0.58;     // suspension travel
    this.mountY = -0.1;
    this.k = 15500; this.c = 1550; this.kAR = 7000;
    this.steer = 0;
    this.fourWD = true; this.lowRange = false;
    this.wheels = [
      { x: -0.98, z: 1.45, front: true }, { x: 0.98, z: 1.45, front: true },
      { x: -0.98, z: -1.42, front: false }, { x: 0.98, z: -1.42, front: false },
    ].map(w => Object.assign(w, {
      comp: 0, prevComp: 0, contact: false, susLen: this.restLen, normal: V().set(0, 1, 0), point: V(),
      spin: 0, spinVel: 0, slip: 0, mud: 0, water: 0, rock: false, load: 0, vf: 0, vs: 0,
    }));
    // chassis contact points (body local)
    this.hull = [
      [-0.95, -0.38, 2.1], [0.95, -0.38, 2.1], [-0.95, -0.38, -2.1], [0.95, -0.38, -2.1], [0, -0.42, 0], [0, -0.42, 1.2], [0, -0.42, -1.2],
      [-1.0, -0.2, 2.55], [1.0, -0.2, 2.55], [0, -0.3, 2.58], [-0.98, -0.25, -2.45], [0.98, -0.25, -2.45], [0, 0.3, -2.75],
      [-0.95, 0.5, 2.3], [0.95, 0.5, 2.3], [-0.95, 0.5, -2.25], [0.95, 0.5, -2.25],
      [-0.85, 1.25, 0.2], [0.85, 1.25, 0.2], [-0.85, 1.25, -2.0], [0.85, 1.25, -2.0], [0, 1.3, -0.9],
      [-1.05, 0.2, 0], [1.05, 0.2, 0], [-1.0, 0.2, 1.45], [1.0, 0.2, 1.45], [-1.0, 0.2, -1.42], [1.0, 0.2, -1.42],
    ].map(p => new THREE.Vector3(...p));
    this.impacts = 0; this.landing = 0; this.treeHit = 0;
    this.inWater = 0; this.airTime = 0; this.contacts = 0;
    this.engineLoad = 0;
    this.hullBase = this.hull.map(p => p.clone());
    // previous-step state for render interpolation, plus scratch for push/popInterp
    this.prevPos = V(); this.prevQuat = new THREE.Quaternion(); this._sp = V(); this._sq = new THREE.Quaternion();
    this._ar = [0, 0, 0, 0]; this._offs = [0, 0, 0];
    this.applySetup(resolveSetup('runner'));
  }

  // Apply a vehicle + tuning setup (see garage.js). Safe to call at any time, even mid-simulation.
  applySetup(s) {
    this.setup = s;
    const ms = s.mass / 1650;
    this.mass = s.mass;
    this.Ib.set(3500 * ms, 3900 * ms, 1450 * ms);
    // springs scale with mass so every vehicle sags by the same amount; travel/tyres then set the ride height
    this.k = 15500 * ms; this.c = 1550 * ms; this.kAR = 7000 * ms;
    this.R = s.R; this.restLen = s.restLen;
    this.power = s.power; this.gripMul = s.grip;
    this.rayOff = 0.6 * s.R;                                   // shape-cast spread follows the tyre radius
    this._offs[0] = -this.rayOff; this._offs[1] = 0; this._offs[2] = this.rayOff;
    this.mudFloor = 0.3 * (1 + (s.R / 0.5 - 1) * 0.9);         // tall tyres float better in mud
    this.rollRes = 40 * (0.75 + 0.25 * s.grip * s.grip);                       // sticky rubber rolls harder
    for (const w of this.wheels) { w.x = Math.sign(w.x) * s.half; if (!w.contact) w.susLen = this.restLen; }
    for (let i = 0; i < this.hull.length; i++) this.hull[i].x = this.hullBase[i].x * s.bodyScaleX;
  }

  reset(x, z, heading) {
    const y = this.t.heightAt(x, z) + 1.4;
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.steer = 0;
    for (const w of this.wheels) { w.comp = w.prevComp = 0; w.spinVel = 0; }
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);   // teleport: nothing to interpolate from
  }

  // Render interpolation: the sim runs at a fixed 120 Hz, the display doesn't. Between two steps the visible
  // state is blended by alpha (= leftover time / step). push swaps the blend in, pop restores the real state.
  pushInterp(alpha) {
    this._sp.copy(this.pos); this._sq.copy(this.quat);
    this.pos.lerpVectors(this.prevPos, this._sp, alpha);
    this.quat.slerpQuaternions(this.prevQuat, this._sq, alpha);
    this.updateAxes();
  }
  popInterp() { this.pos.copy(this._sp); this.quat.copy(this._sq); this.updateAxes(); }

  get speed() { return this.vel.dot(this.fwd); }

  updateAxes() {
    _m.makeRotationFromQuaternion(this.quat);
    _m.extractBasis(this.right, this.up, this.fwd);
  }

  // distance along ray (o + d t) to the heightfield; Infinity if none within maxT
  rayGround(o, d, maxT) {
    const t = this.t;
    const f = (s) => o.y + d.y * s - t.heightAt(o.x + d.x * s, o.z + d.z * s);
    let prev = f(0);
    if (prev <= 0) return 0;
    let s0 = 0;
    const step = 0.18;
    for (let s = step; s <= maxT + step; s += step) {
      const v = f(s);
      if (v <= 0) {
        let a = s0, b = s;
        for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
        return (a + b) / 2;
      }
      s0 = s;
    }
    return Infinity;
  }
  rayRocks(o, d, maxT, outN) {
    const list = this.t.rocksNear(o.x, o.z);
    if (!list) return Infinity;
    let best = Infinity;
    for (const i of list) {
      const r = this.t.rocks[i];
      const ox = o.x - r.x, oy = o.y - r.y, oz = o.z - r.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - r.r * r.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      let tt = -b - Math.sqrt(disc);
      if (tt < 0) { if (cc < 0) tt = 0; else continue; }
      if (tt < best && tt <= maxT) {
        best = tt;
        outN.set(o.x + d.x * tt - r.x, o.y + d.y * tt - r.y, o.z + d.z * tt - r.z).normalize();
      }
    }
    return best;
  }

  step(dt, inp) {
    const t = this.t, m = this.mass;
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.updateAxes();
    const { right, up, fwd } = this;
    const F = _a.set(0, -G * m, 0);
    const T = _b.set(0, 0, 0);
    const speed = this.vel.dot(fwd);
    const absV = Math.abs(speed);

    // steering (speed sensitive)
    const maxSteer = 0.62 / (1 + absV * 0.045);
    // local +x is the truck's left side, so a right turn (+steer input) is a negative yaw
    const target = -clamp(inp.steer, -1, 1) * maxSteer;
    const rate = 3.2 * dt;
    this.steer += clamp(target - this.steer, -rate, rate);

    // engine / brake decisions
    // taller tyres = taller gearing: more top speed, less pulling force at the wheels
    const rs = 0.5 / this.R;
    const top = (this.lowRange ? 13 : 36) / rs;
    const Fmax = (this.lowRange ? 25000 : 11500) * this.power * rs;
    let engine = 0, braking = 0;
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (thr > 0) {
      if (speed < -0.8) braking = thr; else engine = thr * Fmax * Math.max(0, 1 - Math.pow(Math.max(speed, 0) / top, 2));
    }
    if (brk > 0) {
      if (speed > 0.8) braking = Math.max(braking, brk);
      else engine += -brk * Fmax * 0.65 * Math.max(0, 1 - Math.pow(Math.max(-speed, 0) / (this.lowRange ? 7 : 11), 2));
    }
    const hold = thr === 0 && brk === 0 && absV < 1.2; // auto hill-hold
    this.engineLoad = lerp(this.engineLoad, Math.abs(engine) / Fmax, 0.1);
    const driven = this.fourWD ? 4 : 2;

    let contacts = 0;
    const down = _c.copy(up).negate();
    const maxT = this.restLen + this.R + 0.05;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      // mount point world
      const mount = _o.copy(right).multiplyScalar(w.x).addScaledVector(up, this.mountY).addScaledVector(fwd, w.z).add(this.pos);
      // wheel heading
      let wf = _f.copy(fwd);
      if (w.front) wf.applyAxisAngle(up, this.steer);
      // shape-cast: 3 rays along the wheel circle
      let bestLen = Infinity; const bn = _n;
      let rockHit = false;
      for (const off of this._offs) {
        const ox = mount.x + wf.x * off, oy = mount.y + wf.y * off, oz = mount.z + wf.z * off;
        _d.set(ox, oy, oz);
        const tg = this.rayGround(_d, down, maxT);
        const tr = this.rayRocks(_d, down, maxT, _s);
        const hdrop = Math.sqrt(this.R * this.R - off * off);
        const lg = tg - hdrop, lr = tr - hdrop;
        if (lg < bestLen) { bestLen = lg; t.normalAt(ox + down.x * tg, oz + down.z * tg, bn); rockHit = false; }
        if (lr < bestLen) { bestLen = lr; bn.copy(_s); rockHit = true; }
      }
      w.prevComp = w.comp;
      if (bestLen < this.restLen) {
        w.contact = true; contacts++;
        w.susLen = Math.max(bestLen, -0.25);
        w.comp = this.restLen - w.susLen;
        w.normal.copy(bn); w.rock = rockHit;
      } else {
        w.contact = false; w.susLen = this.restLen; w.comp = 0;
      }
      w._mount = w._mount || V(); w._mount.copy(mount);
    }

    // springs + anti-roll
    const ar = this._ar; ar[0] = ar[1] = ar[2] = ar[3] = 0;
    for (let p = 0; p < 4; p += 2) {
      const d = this.wheels[p].comp - this.wheels[p + 1].comp;
      ar[p] = d * this.kAR; ar[p + 1] = -d * this.kAR;
    }
    let mudSum = 0, waterSum = 0, slipSum = 0;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (!w.contact) {
        w.load = 0; w.slip = 0; w.mud = 0; w.water = 0;
        const spinTarget = (w.front && !this.fourWD) ? w.spinVel * 0.98 : (engine / Fmax) * 40;
        w.spinVel = lerp(w.spinVel, spinTarget, 0.02);
        continue;
      }
      const compVel = (w.comp - w.prevComp) / dt;
      let Fs = this.k * w.comp + this.c * compVel + ar[wi];
      if (w.comp > this.restLen * 0.85) Fs += 150000 * (w.comp - this.restLen * 0.85) + 2500 * Math.max(0, compVel);
      Fs = Math.max(0, Fs);
      w.load = Fs;
      // spring force at wheel center
      const wc = _d.copy(w._mount).addScaledVector(up, -w.susLen);
      _r.subVectors(wc, this.pos);
      _s.copy(up).multiplyScalar(Fs);
      F.add(_s); T.add(_r.cross(_s));

      // contact patch
      const cp = w.point.copy(wc).addScaledVector(up, -this.R);
      const n = w.normal;
      // surface
      const mud = w.rock ? 0 : t.mudAt(cp.x, cp.z);
      const depth = WATER - cp.y;
      const water = clamp(depth / 0.8, 0, 1);
      w.mud = mud; w.water = water;
      mudSum += mud; waterSum += water;
      const trail = t.trailAt(cp.x, cp.z);
      let grip = w.rock ? 1.2 : lerp(1.0, 1.08, trail);
      if (cp.y > 50) grip *= 0.75; // snow
      grip = lerp(grip, this.mudFloor, mud);
      grip = lerp(grip, 0.72, water);
      // tire frame
      let wf = _f.copy(fwd); if (w.front) wf.applyAxisAngle(up, this.steer);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const side = _s.crossVectors(n, wf).normalize();
      const fpt = _o.copy(wc).addScaledVector(up, -this.R * 0.35);
      _r.subVectors(fpt, this.pos);
      _vp.crossVectors(this.angVel, _r).add(this.vel);
      const vf = _vp.dot(wf), vs = _vp.dot(side);
      w.vf = vf; w.vs = vs;
      const quarter = m / 4;
      const latK = Math.min(11000, quarter / dt * 0.85);
      let Fl = -vs * latK;
      let Fx = 0;
      const isDriven = this.fourWD || !w.front;
      if (isDriven) Fx += engine / driven;
      if (braking > 0) Fx += -clamp(vf * 20000, -4600 * braking, 4600 * braking);
      if (hold) Fx += -clamp(vf * 25000, -5000, 5000);
      if (inp.handbrake && !w.front) { Fx += -clamp(vf * 20000, -5200, 5200); Fl *= 0.35; }
      // rolling resistance + mud/water drag: resistive, NOT limited by tire grip
      const Fdrag = -vf * (this.rollRes + mud * 380 + water * 220);
      if (thr === 0 && brk === 0 && !hold) Fx += -vf * 90; // engine braking
      const mu = 1.12 * grip * this.gripMul;
      const maxF = mu * Fs;
      const mag = Math.hypot(Fx, Fl);
      w.slip = 0;
      if (mag > maxF && mag > 1) {
        w.slip = Math.min(3, mag / maxF - 1);
        const sc = maxF / mag; Fx *= sc; Fl *= sc;
      }
      slipSum += w.slip;
      const tf = _f.copy(wf).multiplyScalar(Fx + Fdrag).addScaledVector(side, Fl);
      F.add(tf); T.add(_r.cross(tf));
      // wheel spin visual
      let target = vf / this.R;
      if (isDriven && w.slip > 0.05 && Math.abs(engine) > 100) target += Math.sign(engine) * Math.min(1, w.slip) * 28;
      if (inp.handbrake && !w.front) target = 0;
      w.spinVel = lerp(w.spinVel, target, 0.35);
    }
    this.contacts = contacts;
    this.mudAmt = mudSum / 4; this.waterAmt = waterSum / 4; this.slipAmt = slipSum / 4;

    // air control + air time
    if (contacts === 0) {
      this.airTime += dt;
      T.addScaledVector(right, (thr - brk) * 2600);
      T.addScaledVector(up, clamp(inp.steer, -1, 1) * -1300);
    } else {
      if (this.airTime > 0.45) this.landing = Math.max(this.landing, Math.min(1, this.airTime / 1.5));
      this.airTime = 0;
    }

    // aero drag
    const vlen = this.vel.length();
    F.addScaledVector(this.vel, -0.42 * vlen);

    // water: buoyancy + drag
    const sub = clamp((WATER - (this.pos.y - 0.6)) / 1.4, 0, 1);
    this.inWater = sub;
    if (sub > 0) {
      F.y += m * G * 0.55 * sub;
      F.addScaledVector(this.vel, -1400 * sub);
      this.angVel.multiplyScalar(1 - 1.5 * sub * dt);
    }

    // hull contacts with ground, rocks, trees
    this.hullContacts(F, T, dt);

    // soft world bounds
    const lim = HALF - 8;
    for (const ax of ['x', 'z']) {
      const p = this.pos[ax];
      if (Math.abs(p) > lim) { F[ax] -= Math.sign(p) * (Math.abs(p) - lim) * 20000; F[ax] -= this.vel[ax] * 3000; }
    }

    // integrate
    this.vel.addScaledVector(F, dt / m);
    _qi.copy(this.quat).invert();
    const tb = _d.copy(T).applyQuaternion(_qi);
    tb.set(tb.x / this.Ib.x, tb.y / this.Ib.y, tb.z / this.Ib.z).applyQuaternion(this.quat);
    this.angVel.addScaledVector(tb, dt);
    this.angVel.multiplyScalar(1 - (contacts ? 0.5 : 0.15) * dt);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += _q.x; this.quat.y += _q.y; this.quat.z += _q.z; this.quat.w += _q.w;
    this.quat.normalize();

    for (const wh of this.wheels) wh.spin += wh.spinVel * dt;

    // safety: NaN guard
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z + this.vel.x + this.angVel.x)) {
      this.reset(0, 0, 0); this.nanReset = (this.nanReset || 0) + 1;
    }
  }

  hullContacts(F, T, dt) {
    const t = this.t;
    const kc = 140000, cc = 9000, muC = 0.55;
    t.treesNear(this.pos.x, this.pos.z, _treeList);
    for (const lp of this.hull) {
      const p = _o.copy(lp).applyQuaternion(this.quat).add(this.pos);
      _r.subVectors(p, this.pos);
      // ground
      const gh = t.heightAt(p.x, p.z);
      let pen = gh - p.y;
      if (pen > 0) {
        t.normalAt(p.x, p.z, _n);
        this.applyContact(F, T, _n, pen * _n.y, kc, cc, muC);
      }
      // rocks
      const list = t.rocksNear(p.x, p.z);
      if (list) for (const i of list) {
        const r = t.rocks[i];
        const dx = p.x - r.x, dy = p.y - r.y, dz = p.z - r.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r.r * r.r) {
          const d = Math.sqrt(d2) || 1e-3;
          _n.set(dx / d, dy / d, dz / d);
          this.applyContact(F, T, _n, r.r - d, kc, cc, muC);
        }
      }
      // trees (vertical cylinders)
      for (const tr of _treeList) {
        const rad = 0.45 * tr.s;
        const dx = p.x - tr.x, dz = p.z - tr.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < rad * rad && p.y < tr.y + 9 * tr.s) {
          const d = Math.sqrt(d2) || 1e-3;
          _n.set(dx / d, 0, dz / d);
          const before = this.vel.length();
          this.applyContact(F, T, _n, rad - d, kc * 2.5, cc * 2, 0.3);
          if (before > 4) this.treeHit = Math.max(this.treeHit, Math.min(1, before / 20));
        }
      }
    }
  }
  applyContact(F, T, n, pen, kc, cc, mu) {
    _vp.crossVectors(this.angVel, _r).add(this.vel);
    const vn = _vp.dot(n);
    let Fn = kc * pen - cc * vn;
    if (Fn <= 0) return;
    if (-vn > 3) this.impacts = Math.max(this.impacts, Math.min(1, -vn / 10));
    const f = _f.copy(n).multiplyScalar(Fn);
    const vt = _s.copy(_vp).addScaledVector(n, -vn);
    const vtl = vt.length();
    if (vtl > 1e-4) f.addScaledVector(vt, -Math.min(mu * Fn, vtl * 6000) / vtl);
    F.add(f);
    T.add(_d.copy(_r).cross(f));
  }
}

// ---------------------------------------------------------------- model
function mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, flatShading: true, ...opts }); }

export function buildTruckModel(color = 0xe8572a) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = mat(color, { roughness: 0.42, metalness: 0.12 });
  const black = mat(0x1d1f22, { roughness: 0.8 });
  const dark = mat(0x2c3036, { roughness: 0.5, metalness: 0.4 });
  const chrome = mat(0xc9ced6, { roughness: 0.25, metalness: 0.9 });
  const glass = mat(0x223344, { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.85 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 0.6 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xff2200, emissiveIntensity: 0.5 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xff8800, emissiveIntensity: 0.4 });
  const add = (geo, m, x, y, z, parent = body) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; parent.add(me); return me; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // frame / lower body
  add(box(1.9, 0.5, 4.2), paint, 0, 0.05, 0);
  // hood slant
  const hood = add(box(1.86, 0.18, 1.45), paint, 0, 0.36, 1.35); hood.rotation.x = 0.06;
  // cabin
  add(box(1.84, 0.12, 2.5), paint, 0, 0.36, -0.75);
  const cabin = add(box(1.78, 0.78, 2.4), paint, 0, 0.82, -0.72);
  // windshield
  const ws = add(box(1.6, 0.68, 0.06), glass, 0, 0.84, 0.5); ws.rotation.x = -0.32;
  add(box(0.06, 0.55, 2.0), glass, 0.9, 0.86, -0.75);
  add(box(0.06, 0.55, 2.0), glass, -0.9, 0.86, -0.75);
  add(box(1.5, 0.5, 0.06), glass, 0, 0.88, -1.93);
  // roof rack + light bar
  add(box(1.6, 0.05, 1.9), dark, 0, 1.28, -0.75);
  for (const x of [-0.78, 0.78]) add(box(0.06, 0.12, 1.9), dark, x, 1.34, -0.75);
  add(box(1.4, 0.12, 0.14), dark, 0, 1.38, 0.2);
  const barLights = [];
  for (let i = 0; i < 6; i++) barLights.push(add(box(0.18, 0.08, 0.04), lightMat, -0.55 + i * 0.22, 1.38, 0.28));
  // roof cargo
  add(box(0.7, 0.25, 0.5), mat(0x5a4632), -0.3, 1.45, -1.2);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 8).rotateZ(Math.PI / 2), mat(0x3b5a2d), 0.4, 1.45, -1.3);
  // fender flares
  for (const [x, z] of [[-0.98, 1.45], [0.98, 1.45], [-0.98, -1.42], [0.98, -1.42]]) {
    const f = add(box(0.3, 0.12, 1.25), black, x * 1.03, 0.32, z);
    const f1 = add(box(0.3, 0.12, 0.4), black, x * 1.03, 0.18, z + 0.68); f1.rotation.x = 0.7;
    const f2 = add(box(0.3, 0.12, 0.4), black, x * 1.03, 0.18, z - 0.68); f2.rotation.x = -0.7;
  }
  // front bumper + winch + grille
  add(box(2.1, 0.28, 0.3), black, 0, -0.08, 2.2);
  add(box(0.6, 0.2, 0.22), dark, 0, 0.1, 2.25);
  add(box(1.0, 0.3, 0.05), dark, 0, 0.18, 2.11);
  for (let i = 0; i < 5; i++) add(box(0.05, 0.28, 0.06), chrome, -0.36 + i * 0.18, 0.18, 2.13);
  // headlights
  const heads = [];
  for (const x of [-0.68, 0.68]) {
    const hl = add(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12).rotateX(Math.PI / 2), lightMat, x, 0.2, 2.13);
    heads.push(hl);
    add(box(0.12, 0.07, 0.05), amber, x * 1.25, 0.03, 2.12);
  }
  // rear bumper, tail lights, spare tire
  add(box(2.05, 0.26, 0.26), black, 0, -0.08, -2.18);
  for (const x of [-0.82, 0.82]) add(box(0.18, 0.28, 0.06), tail, x, 0.2, -2.12);
  const spare = new THREE.Group(); spare.position.set(0, 0.55, -2.25); body.add(spare);
  add(new THREE.CylinderGeometry(0.44, 0.44, 0.3, 16).rotateX(Math.PI / 2), black, 0, 0, 0, spare);
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.32, 8).rotateX(Math.PI / 2), chrome, 0, 0, 0, spare);
  // snorkel
  add(box(0.12, 0.9, 0.12), black, 1.0, 0.75, 0.42);
  add(box(0.14, 0.14, 0.26), black, 1.0, 1.22, 0.5);
  // side steps + mirrors
  for (const x of [-1.0, 1.0]) { add(box(0.2, 0.06, 1.9), dark, x, -0.22, -0.1); add(box(0.08, 0.16, 0.2), black, x * 1.0, 0.92, 0.38); }
  // exhaust
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6).rotateX(Math.PI / 2), chrome, -0.6, -0.22, -2.3);
  root.userData.exhaust = new THREE.Vector3(-0.6, -0.22, -2.45);

  // wheels
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 22).rotateZ(Math.PI / 2);
  const tireMat = mat(0x1a1a1a, { roughness: 0.95 });
  const rimMat = mat(0x8a9099, { roughness: 0.3, metalness: 0.8 });
  const lugGeo = box(0.44, 0.08, 0.13);
  const spokeMat = mat(0x5a6068, { metalness: 0.7, roughness: 0.4 });
  for (const [x, z] of [[-0.98, 1.45], [0.98, 1.45], [-0.98, -1.42], [0.98, -1.42]]) {
    const steerG = new THREE.Group(); steerG.position.set(x, 0, z); root.add(steerG);
    const spinG = new THREE.Group(); steerG.add(spinG);
    const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = true; spinG.add(tire);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, tireMat);
      lug.position.set(0, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
      lug.rotation.x = -a + (i % 2 ? 0.25 : -0.25);
      lug.castShadow = true;
      spinG.add(lug);
    }
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.44, 8).rotateZ(Math.PI / 2), rimMat); spinG.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.47, 6).rotateZ(Math.PI / 2), chrome); spinG.add(hub);
    // spokes to make spin visible
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(box(0.46, 0.06, 0.24), spokeMat);
      sp.rotation.x = (i / 5) * Math.PI * 2; spinG.add(sp);
    }
    wheels.push({ steerG, spinG, x, z });
  }
  // merge all parts sharing a material into one mesh => few draw calls
  mergeByMaterial(body);
  for (const w of wheels) mergeByMaterial(w.spinG);
  root.userData = { ...root.userData, body, wheels, paint, lightMat, tail };
  return root;
}

function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const remove = [];
  group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g.index ? g : g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const c of [...group.children]) if (c.isGroup && c.children.length === 0) group.remove(c);
  for (const [m, geos] of byMat) {
    const merged = mergeGeometries(geos.map(g => g.index ? g : g), false);
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export function syncTruckModel(model, ph, alpha = 1) {
  model.position.copy(ph.pos);
  model.quaternion.copy(ph.quat);
  const ud = model.userData;
  // body leans slightly relative to the chassis for extra juice
  for (let i = 0; i < 4; i++) {
    const w = ph.wheels[i], vw = ud.wheels[i];
    const y = ph.mountY - w.susLen;
    vw.steerG.position.y = lerp(vw.steerG.position.y, y, 0.6);
    vw.steerG.rotation.y = w.front ? ph.steer : 0;
    vw.spinG.rotation.x = w.spin;
  }
}

// Physically-informed engine sound synthesis.
// JavaScript port of the generator from "enginesound" by DasEtwas (MIT License, https://github.com/DasEtwas/enginesound),
// which is based on Baldan, Lachambre, Delle Monache, Boussard: "Physically informed car engine sound synthesis
// for virtual and augmented environments" (2015).
// Runs inside an AudioWorklet, a ScriptProcessor fallback, or Node (for offline tests).

const PI2 = Math.PI * 2, PI4 = Math.PI * 4;
const WG_MAX = 20;
const fract = (x) => x - Math.trunc(x);

class LPF {
  constructor(freq, sr) { this.freq = freq; this.set(freq, sr); this.last = 0; }
  set(freq, sr) { const k = PI2 * (1 / sr) * freq; this.alpha = k / (k + 1); this.freq = freq; }
  filter(x) { const r = (x - this.last) * this.alpha + this.last; this.last = r; return r; }
}

class Delay {
  constructor(seconds, sr) { const len = Math.max(1, Math.floor(seconds * sr)); this.data = new Float32Array(len); this.len = len; this.pos = 0; }
  push(v) { this.data[this.pos % this.len] = v; }
  pop() { return this.data[(this.pos + 1) % this.len]; }
  advance() { this.pos++; }
  clear() { this.data.fill(0); }
}

class WaveGuide {
  constructor(cfg, sr) {
    this.c0 = new Delay(cfg.chamber0.samples.delay, sr);
    this.c1 = new Delay(cfg.chamber1.samples.delay, sr);
    this.alpha = cfg.alpha; this.beta = cfg.beta;
    this.c0out = 0; this.c1out = 0; this.damped = false;
  }
  static dampen(s) {
    const a = Math.abs(s);
    if (a > WG_MAX) return Math.sign(s) * (-1 / (a - WG_MAX + 1) + 1 + WG_MAX);
    return s;
  }
  // returns [alpha side out, beta side out] via fields to avoid allocations
  pop() {
    this.c1out = WaveGuide.dampen(this.c1.pop());
    this.c0out = WaveGuide.dampen(this.c0.pop());
    this.outA = this.c1out * (1 - Math.abs(this.alpha));
    this.outB = this.c0out * (1 - Math.abs(this.beta));
  }
  push(x0, x1) {
    this.c0.push(this.c1out * this.alpha + x0);
    this.c1.push(this.c0out * this.beta + x1);
    this.c0.advance(); this.c1.advance();
  }
  clear() { this.c0.clear(); this.c1.clear(); this.c0out = this.c1out = 0; }
}

const exhaustValve = (c) => (c > 0.75 && c < 1.0 ? -Math.sin(c * PI4) : 0);
const intakeValve = (c) => (c > 0.0 && c < 0.25 ? Math.sin(c * PI4) : 0);
const pistonMotion = (c) => Math.cos(c * PI4);
const fuelIgnition = (c, t) => (c > 0.5 && c < t / 2 + 0.5 ? Math.sin(PI2 * ((c - 0.5) / t)) : 0);

class Cylinder {
  constructor(cfg, sr) {
    Object.assign(this, {
      crankOffset: cfg.crank_offset,
      intakeOpen: cfg.intake_open_refl, intakeClosed: cfg.intake_closed_refl,
      exhaustOpen: cfg.exhaust_open_refl, exhaustClosed: cfg.exhaust_closed_refl,
      pistonFactor: cfg.piston_motion_factor, ignitionFactor: cfg.ignition_factor, ignitionTime: cfg.ignition_time,
    });
    this.ex = new WaveGuide(cfg.exhaust_waveguide, sr);
    this.in = new WaveGuide(cfg.intake_waveguide, sr);
    this.extr = new WaveGuide(cfg.extractor_waveguide, sr);
    this.cylSound = 0; this.extractorExhaust = 0;
    this.ignitionScale = 1; // per-cylinder combustion strength (misfire / overrun)
    this.bank = cfg.bank || 0;
    this.prevCrank = 0; this.cycleScale = 1;
  }
  pop(crankPos, exhaustCollector, ivShift, evShift, ignitionGain) {
    const crank = fract(crankPos + this.crankOffset);
    // new combustion event: draw cycle-to-cycle variation (real engines never fire identically)
    if (this.prevCrank < 0.5 && crank >= 0.5 && this.rand) this.cycleScale = 1 + (this.rand() * 2 - 1) * this.cv;
    this.prevCrank = crank;
    this.cylSound = pistonMotion(crank) * this.pistonFactor + fuelIgnition(crank, this.ignitionTime) * this.ignitionFactor * ignitionGain * this.ignitionScale * this.cycleScale;
    const ev = exhaustValve(fract(crank + evShift));
    const iv = intakeValve(fract(crank + ivShift));
    this.ex.alpha = this.exhaustClosed + (this.exhaustOpen - this.exhaustClosed) * ev;
    this.in.alpha = this.intakeClosed + (this.intakeOpen - this.intakeClosed) * iv;
    this.ex.pop(); this.in.pop(); this.extr.pop();
    this.extractorExhaust = this.extr.outA;
    this.extr.push(this.ex.outB, exhaustCollector);
    this.retIntake = this.in.outB;
    this.retExhaust = this.extr.outB;
  }
  push(intake) {
    this.ex.push((1 - Math.abs(this.ex.alpha)) * this.cylSound * 0.5, this.extractorExhaust);
    this.in.push((1 - Math.abs(this.in.alpha)) * this.cylSound * 0.5, intake);
  }
  clear() { this.ex.clear(); this.in.clear(); this.extr.clear(); this.cylSound = 0; this.extractorExhaust = 0; }
}

// xorshift32 noise in [-1, 1)
function makeNoise(seed) { let s = seed >>> 0 || 2463534242; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483647.5 - 1; }; }

export class EngineSynth {
  constructor(cfg, sr, seed = 12345) {
    this.sr = sr;
    this.rpm = cfg.rpm;
    this.intakeVolume = cfg.intake_volume; this.exhaustVolume = cfg.exhaust_volume; this.vibVolume = cfg.engine_vibrations_volume;
    this.cyl = cfg.cylinders.map(c => new Cylinder(c, sr));
    this.intakeNoiseFactor = cfg.intake_noise_factor;
    this.intakeNoiseLP = new LPF(1 / cfg.intake_noise_lp.delay, sr);
    this.vibLP = new LPF(1 / cfg.engine_vibration_filter.delay, sr);
    // one exhaust system per bank (dual exhaust); configs may provide muffler2 for bank 1
    this.nBanks = cfg.muffler2 ? 2 : 1;
    const mk = (mf) => ({ straight: new WaveGuide(mf.straight_pipe, sr), muffler: mf.muffler_elements.map(m => new WaveGuide(m, sr)), coll: 0, out: 0 });
    this.ex = [mk(cfg.muffler)]; if (this.nBanks === 2) this.ex.push(mk(cfg.muffler2));
    this.bankCount = [0, 0]; this.cyl.forEach(c => { if (this.nBanks === 1) c.bank = 0; this.bankCount[c.bank]++; });
    this.cv = cfg.cycle_variation || 0;
    const cvRand = makeNoise(seed * 13 + 5);
    this.cyl.forEach(c => { c.rand = () => (cvRand() + 1) / 2; c.cv = this.cv; });
    this.ivShift = cfg.intake_valve_shift; this.evShift = cfg.exhaust_valve_shift;
    this.crankFluct = cfg.crankshaft_fluctuation;
    this.crankFluctLP = new LPF(1 / cfg.crankshaft_fluctuation_lp.delay, sr);
    this.noiseA = makeNoise(seed); this.noiseB = makeNoise(seed * 7 + 3);
    this.dcLP = new LPF(0.5, sr);
    this.volume = 0.1;
    this.crank = 0; this.exColl = 0; this.inColl = 0;
    this.extraPulse = 0; // injected pressure (backfire pops), added to the collectors
    this.ignitionGain = 1;   // global combustion strength (throttle / load)
    this.intakeGain = 1;     // extra intake roar under load
  }
  // one sample; returns [intake, vibration, exhaust] mix already scaled by volumes
  setCycleVariation(v) { this.cv = v; for (const c of this.cyl) c.cv = v; }
  tick() {
    this.crank = fract(this.crank + this.rpm / (this.sr * 120));
    const iNoise = this.intakeNoiseLP.filter(this.noiseA()) * this.intakeNoiseFactor * this.intakeGain;
    let vib = 0;
    const n = this.cyl.length, E = this.ex, nb = this.nBanks;
    const lastEx0 = E[0].coll / this.bankCount[0], lastEx1 = nb === 2 ? E[1].coll / this.bankCount[1] : 0;
    E[0].coll = 0; if (nb === 2) E[1].coll = 0;
    this.inColl = 0;
    const fl = this.crankFluctLP.filter(this.noiseB());
    const cp = this.crank + this.crankFluct * fl;
    for (let i = 0; i < n; i++) {
      const c = this.cyl[i];
      c.pop(cp, c.bank ? lastEx1 : lastEx0, this.ivShift, this.evShift, this.ignitionGain);
      this.inColl += c.retIntake; E[c.bank].coll += c.retExhaust; vib += c.cylSound;
    }
    E[0].coll += this.extraPulse; if (nb === 2) E[1].coll += this.extraPulse * 0.8;
    this.extraPulse = 0;
    for (let b = 0; b < nb; b++) {
      const e = E[b]; e.straight.pop(); e.mA = 0; e.mB = 0;
      for (const m of e.muffler) { m.pop(); e.mA += m.outA; e.mB += m.outB; }
    }
    for (let i = 0; i < n; i++) {
      const c = this.cyl[i];
      c.push(this.inColl / n + iNoise * intakeValve(fract(this.crank + c.crankOffset)));
    }
    for (let b = 0; b < nb; b++) {
      const e = E[b];
      e.straight.push(e.coll, e.mA);
      e.coll += e.straight.outA;
      const ml = e.muffler.length;
      for (const m of e.muffler) m.push(e.straight.outB / ml, 0);
      e.out = e.mB;
    }
    vib = this.vibLP.filter(vib);
    this.outIntake = this.inColl * this.intakeVolume * this.intakeGain;
    this.outVib = vib * this.vibVolume;
    this.outExhaustA = E[0].out * this.exhaustVolume;
    this.outExhaustB = nb === 2 ? E[1].out * this.exhaustVolume : this.outExhaustA;
    this.outExhaust = nb === 2 ? (this.outExhaustA + this.outExhaustB) * 0.5 : this.outExhaustA;
    const mixed = (this.outIntake + this.outVib + this.outExhaust) * this.volume;
    return mixed - this.dcLP.filter(mixed);
  }
  render(buf) { for (let i = 0; i < buf.length; i++) buf[i] = this.tick(); }
  reset() { this.cyl.forEach(c => c.clear()); for (const e of this.ex) { e.straight.clear(); e.muffler.forEach(m => m.clear()); e.coll = 0; } this.inColl = 0; }
}

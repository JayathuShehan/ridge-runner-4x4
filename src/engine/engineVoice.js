// EngineVoice: the physically-informed engine model plus the behaviours that make it feel alive in a game.
// Output: process(exL, exR, intake, n): exhaust bank A / bank B (+ block vibration, grit, pops) and intake + mechanical.
import { EngineSynth } from './engineSynth.js';

function biquadBP(sr, f, q) { // bandpass (constant 0 dB peak)
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function biquad(sr, type, f, q) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const o = { x1: 0, x2: 0, y1: 0, y2: 0, a1: -2 * c / a0, a2: (1 - al) / a0 };
  if (type === 'lp') { o.b0 = (1 - c) / 2 / a0; o.b1 = (1 - c) / a0; o.b2 = o.b0; }
  else { o.b0 = (1 + c) / 2 / a0; o.b1 = -(1 + c) / a0; o.b2 = o.b0; }
  return o;
}
function retune(o, sr, type, f, q) { const n = biquad(sr, type, f, q); o.b0 = n.b0; o.b1 = n.b1; o.b2 = n.b2; o.a1 = n.a1; o.a2 = n.a2; }
function bq2(f, x) { const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; return y; }
function bq(f, x) { const y = f.b0 * x + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y; return y; }

export class EngineVoice {
  constructor(cfg, sr) {
    this.sr = sr;
    this.synth = new EngineSynth(cfg, sr, 4242);
    this.synth.volume = 0.12;
    this.p = { rpm: 0, throttle: 0, load: 0, whineHz: 0, whineGain: 0, running: false, limiter: 5600 };
    this.rpm = 0; this.throttle = 0;
    this.s = 77;
    this.grit = biquadBP(sr, 650, 0.8);
    this.grit2 = biquadBP(sr, 1500, 0.9);
    // tone stage: pipes + muffler act as low-pass; remove sub-bass
    this.exLP1 = biquad(sr, 'lp', 900, 0.6); this.exLP2 = biquad(sr, 'lp', 1800, 0.5);
    this.inLP = biquad(sr, 'lp', 1400, 0.6);
    this.exLP1b = biquad(sr, 'lp', 900, 0.6); this.exLP2b = biquad(sr, 'lp', 1800, 0.5);
    this.hpL = biquad(sr, 'hp', 32, 0.7); this.hpR = biquad(sr, 'hp', 32, 0.7); this.hpI = biquad(sr, 'hp', 45, 0.7);
    this.gritB = biquadBP(sr, 650, 0.8);
    this.retuneN = 0;
    this.env = 0;
    this.popT = 0; this.popAmp = 0; this.popCool = 0;
    this.lastThrottle = 0; this.overrunT = 0;
    this.whinePh = 0; this.starterPh = 0;
    this.cutT = 0;
    this.state = 'off'; this.startT = 0;
  }
  rand() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  set(params) { Object.assign(this.p, params); }
  start() { this.state = 'cranking'; this.startT = 0; }
  stop() { this.state = 'off'; }
  process(outL, outR, outI, n) {
    const sr = this.sr, syn = this.synth, p = this.p;
    const dt = 1 / sr;
    for (let i = 0; i < n; i++) {
      // ---- engine state machine (starter -> catch -> running)
      let targetRpm = p.rpm, ign = 1, starter = 0;
      if (this.state === 'off') { targetRpm = 0; ign = 0; }
      else if (this.state === 'cranking') {
        this.startT += dt;
        targetRpm = 210 + Math.sin(this.startT * 40) * 25; ign = 0; starter = 1;
        if (this.startT > 0.9) { this.state = 'catching'; this.startT = 0; }
      } else if (this.state === 'catching') {
        this.startT += dt;
        const k = this.startT;
        targetRpm = k < 0.35 ? 300 + k / 0.35 * 1250 : Math.max(p.rpm, 1550 - (k - 0.35) * 700);
        ign = Math.min(1, 0.3 + k * 3) * (this.rand() < 0.03 && k < 0.3 ? 0 : 1); // a couple of misfires as it catches
        starter = Math.max(0, 1 - k * 6);
        if (targetRpm <= p.rpm + 5 && k > 0.6) this.state = 'running';
      }
      // ---- smooth rpm (engine inertia) and throttle
      const rate = targetRpm > this.rpm ? 9000 : 6000; // rpm/s
      this.rpm += Math.max(-rate * dt, Math.min(rate * dt, targetRpm - this.rpm));
      this.throttle += (p.throttle - this.throttle) * 0.0015;
      // ---- rev limiter: cut ignition in short bursts
      if (this.rpm > p.limiter && this.state === 'running') this.cutT = 0.045;
      if (this.cutT > 0) { this.cutT -= dt; ign = 0.08; }
      // ---- load-dependent combustion: closed throttle = weak, lean combustion
      const load = Math.max(0.12, Math.min(1, p.load));
      syn.ignitionGain = ign * (0.32 + 0.68 * load);
      syn.intakeGain = 0.45 + 1.1 * this.throttle;
      if (this.retuneN === 1) syn.setCycleVariation(0.07 + 0.13 * (1 - load) + (this.rpm < 1000 ? 0.05 : 0));
      syn.rpm = Math.max(0, this.rpm);
      // ---- overrun pops/crackles: lift off from high revs
      if (this.state === 'running') {
        if (this.lastThrottle > 0.5 && p.throttle < 0.1 && this.rpm > 2600) this.overrunT = 0.9 + this.rand() * 0.6;
        this.lastThrottle = p.throttle;
        if (this.overrunT > 0) {
          this.overrunT -= dt;
          this.popCool -= dt;
          if (this.popCool <= 0 && this.rand() < 0.0009 * (this.rpm / 3000)) {
            this.popT = 0.012 + this.rand() * 0.02; this.popAmp = 0.5 + this.rand() * 1.1; this.popCool = 0.035;
          }
        }
      }
      let pop = 0;
      if (this.popT > 0) { this.popT -= dt; pop = (this.rand() * 2 - 1) * this.popAmp * Math.min(1, this.popT * 120); syn.extraPulse += pop * 0.6; }
      // ---- synth sample
      syn.tick();
      const exA = syn.outExhaustA * syn.volume, exB = syn.outExhaustB * syn.volume, intake = syn.outIntake * syn.volume, vib = syn.outVib * syn.volume;
      const ex = (exA + exB) * 0.5;
      // ---- exhaust grit: broadband noise modulated by exhaust pressure (real exhausts are noisy, not pure tones)
      this.env += (Math.abs(ex) - this.env) * 0.02;
      const nz = this.rand() * 2 - 1;
      const gk = this.env * (1.0 + 0.9 * this.throttle) * 1.1;
      const grit = (bq(this.grit, nz) * 0.7 + bq(this.grit2, nz) * 0.3) * gk;
      const gritB = bq(this.gritB, this.rand() * 2 - 1) * gk * 0.7;
      // ---- drivetrain whine (transfer case / diff gear mesh)
      this.whinePh += p.whineHz * dt; if (this.whinePh > 1) this.whinePh -= 1;
      const whine = Math.sin(this.whinePh * 6.2832) * p.whineGain * 0.02 + Math.sin(this.whinePh * 12.566) * p.whineGain * 0.006;
      // ---- starter motor (high geared whirr with commutator buzz)
      let st = 0;
      if (starter > 0) { this.starterPh += (this.rpm * 9.5 / 60) * dt; st = (Math.sin(this.starterPh * 6.2832) * 0.6 + ((this.starterPh * 3) % 1 - 0.5) * 0.5) * 0.035 * starter + (this.rand() - 0.5) * 0.01 * starter; }
      // tone: brighter as the throttle opens and revs rise
      if (--this.retuneN <= 0) {
        this.retuneN = 64;
        const fc = 420 + 900 * this.throttle + this.rpm * 0.12;
        retune(this.exLP1, sr, 'lp', fc, 0.6); retune(this.exLP1b, sr, 'lp', fc * 0.95, 0.6);
        retune(this.inLP, sr, 'lp', 500 + 1400 * this.throttle + this.rpm * 0.1, 0.6);
      }
      const tA = bq2(this.exLP2, bq2(this.exLP1, exA + grit + pop * 0.05));
      const tB = bq2(this.exLP2b, bq2(this.exLP1b, exB + gritB + pop * 0.04));
      // the two tailpipes partly blend in the air: avoids a hollow, phasey stereo image
      const a = bq2(this.hpL, tA + vib), b = bq2(this.hpR, tB + vib);
      outL[i] = a * 0.72 + b * 0.38;
      outR[i] = b * 0.72 + a * 0.38;
      outI[i] = bq2(this.hpI, bq2(this.inLP, intake) + whine + st);
    }
  }
}

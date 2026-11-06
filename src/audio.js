// Game audio: physically-modelled V8 (AudioWorklet, with ScriptProcessor fallback), tyres/terrain, wind, effects.
import { EngineVoice } from './engine/engineVoice.js';
import V8 from './engine/v8.json';

// Synthetic outdoor/forest impulse response: ground reflection + sparse early reflections + soft diffuse tail.
function makeIR(ctx, seconds = 1.4) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), ir = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let s = 1234 + ch * 777; const r = () => (s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1;
    d[Math.floor(sr * (0.004 + ch * 0.0007))] = 0.55;           // ground bounce
    for (let k = 0; k < 14; k++) d[Math.floor(sr * (0.02 + Math.abs(r()) * 0.12))] += r() * 0.22; // trees / terrain
    let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; lp += (r() - lp) * 0.18; d[i] += lp * 0.5 * Math.exp(-t * 4.2) * Math.min(1, t * 40); }
  }
  return ir;
}

export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; this.engineReady = false; }
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    let ctx;
    try { ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { return; }
    this.master = ctx.createGain(); this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    // brick-wall-ish safety limiter after the bus compressor
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.master.connect(comp); comp.connect(lim); lim.connect(ctx.destination); this.out = lim;
    // reverb send
    this.verb = ctx.createConvolver(); this.verb.buffer = makeIR(ctx);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.16;
    this.verbIn.connect(this.verb); this.verb.connect(this.master);
    // noise bed (tyres / mud / water / wind)
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.5; }
    const white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb; this.whiteBuf = white;
    const mk = (buf, type, f, q, toVerb = 0) => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.master); if (toVerb) { const v = ctx.createGain(); v.gain.value = toVerb; g.connect(v); v.connect(this.verbIn); } src.start(); return { g, fl }; };
    this.rumble = mk(nb, 'lowpass', 260, 0.7);
    this.gravel = mk(white, 'bandpass', 2600, 0.8, 0.3);
    this.slosh = mk(nb, 'bandpass', 700, 1.2, 0.4);
    this.wind = mk(white, 'highpass', 700, 0.4);
    this.ready = true;
    await this.initEngine();
  }
  async initEngine() {
    const ctx = this.ctx;
    // engine bus: exhaust (stereo, one bank per side) + intake, with camera-dependent tone
    this.exGain = ctx.createGain(); this.inGain = ctx.createGain();
    this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 20000; this.cabin.Q.value = 0.5;
    this.cabinBoom = ctx.createBiquadFilter(); this.cabinBoom.type = 'peaking'; this.cabinBoom.frequency.value = 110; this.cabinBoom.Q.value = 1.2; this.cabinBoom.gain.value = 0;
    this.engineOut = ctx.createGain(); this.engineOut.gain.value = 0;
    this.exGain.connect(this.cabin); this.inGain.connect(this.cabin);
    this.cabin.connect(this.cabinBoom); this.cabinBoom.connect(this.engineOut);
    this.engineOut.connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.7; this.engineOut.connect(send); send.connect(this.verbIn);
    this.inPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    try {
      if (!ctx.audioWorklet) throw new Error('no worklet');
      await ctx.audioWorklet.addModule('engine-worklet.js');
      const node = new AudioWorkletNode(ctx, 'engine-voice', { numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 1], processorOptions: { config: V8 } });
      node.connect(this.exGain, 0);
      if (this.inPan) { node.connect(this.inPan, 1); this.inPan.connect(this.inGain); } else node.connect(this.inGain, 1);
      this.engineNode = node;
      this.post = (m) => node.port.postMessage(m);
      this.engineMode = 'worklet';
    } catch (e) {
      // fallback: run the same voice on the main thread
      const voice = new EngineVoice(V8, ctx.sampleRate);
      const sp = ctx.createScriptProcessor(1024, 0, 3);
      const tmpI = new Float32Array(1024);
      sp.onaudioprocess = (ev) => { const ob = ev.outputBuffer; const L = ob.getChannelData(0), R = ob.getChannelData(1); voice.process(L, R, tmpI, L.length); ob.getChannelData(2).set(tmpI); };
      const split = ctx.createChannelSplitter(3), merge = ctx.createChannelMerger(2);
      sp.connect(split); split.connect(merge, 0, 0); split.connect(merge, 1, 1); merge.connect(this.exGain); split.connect(this.inGain, 2);
      this.engineNode = sp;
      this.post = (m) => { if (m.type === 'set') voice.set(m.p); else if (m.type === 'start') voice.start(); else if (m.type === 'stop') voice.stop(); };
      this.engineMode = 'script';
    }
    this.engineReady = true;
    if (this.pendingStart) { this.pendingStart = false; this.startEngine(); }
  }
  startEngine() {
    if (!this.engineReady) { this.pendingStart = true; return; }
    this.post({ type: 'start' }); this.engineOn = true;
    this.engineOut.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }
  stopEngine() { this.pendingStart = false; if (!this.engineReady) return; this.post({ type: 'stop' }); this.engineOn = false; this.engineOut.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.03); }
  // s: rpm, load, throttle, whineHz, whineGain, speed, mud, spin, water, ground, rough, view ('chase' | 'far' | 'cabin'), on
  update(s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, tc = 0.05;
    if (this.engineReady) {
      this.post({ type: 'set', p: { rpm: s.rpm, throttle: s.throttle, load: s.load, whineHz: s.whineHz, whineGain: s.whineGain } });
      const cab = s.view === 'cabin', far = s.view === 'far';
      // chase cam sits behind the truck: tailpipes loud, intake distant; cabin: muffled with low boom
      this.exGain.gain.setTargetAtTime(cab ? 1.3 : far ? 2.2 : 2.7, t, tc);
      this.inGain.gain.setTargetAtTime(cab ? 4.2 : far ? 1.4 : 1.8, t, tc);
      this.cabin.frequency.setTargetAtTime(cab ? 900 + s.throttle * 500 : far ? 6000 : 16000, t, 0.1);
      this.cabinBoom.gain.setTargetAtTime(cab ? 7 : 0, t, 0.1);
      this.engineOut.gain.setTargetAtTime(s.on && this.engineOn && !this.muted ? (far ? 0.75 : 1) : 0, t, 0.08);
      if (this.inPan) this.inPan.pan.setTargetAtTime(0, t, 0.1);
    }
    const on = s.on ? 1 : 0;
    this.rumble.g.gain.setTargetAtTime(on * Math.min(0.32, s.speed * 0.011 * s.ground) * (1 + s.rough), t, 0.1);
    this.gravel.g.gain.setTargetAtTime(on * Math.min(0.05, s.speed * 0.0022 * s.ground * s.rough * (0.6 + Math.random() * 0.8)), t, 0.03);
    this.gravel.fl.frequency.setTargetAtTime(1800 + Math.random() * 2200, t, 0.02);
    this.slosh.g.gain.setTargetAtTime(on * Math.min(0.45, s.mud * s.spin * 0.1 + s.water * Math.min(1, s.speed * 0.2) * 0.45), t, 0.08);
    this.wind.g.gain.setTargetAtTime(on * Math.min(0.1, s.speed * s.speed * 0.0001), t, 0.2);
  }
  thud(strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 140 + strength * 220;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, 0.25 + strength * 0.8), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(fl); fl.connect(g); g.connect(this.master); g.connect(this.verbIn); src.start(t, Math.random()); src.stop(t + 0.4);
    // suspension clank
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180 + Math.random() * 80;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.05 * strength, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.14);
  }
  chime(final = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    (final ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77]).forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = ctx.createGain(); const st = t + i * 0.09;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.18, st + 0.01); g.gain.exponentialRampToValueAtTime(0.001, st + 0.5);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + 0.55);
    });
  }
  beep(high = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 880 : 440;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  click() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 180;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.08);
  }
}

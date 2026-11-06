// Procedural audio: V8-ish engine, mud/water slosh, impacts, chimes
export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
      // engine: two detuned saws + square sub through a lowpass, with "firing" amplitude modulation
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400; this.engFilter.Q.value = 3;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.5); }
      shaper.curve = curve;
      this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 18;
      this.o3 = ctx.createOscillator(); this.o3.type = 'square';
      const g3 = ctx.createGain(); g3.gain.value = 0.5;
      const am = ctx.createGain(); am.gain.value = 0.6;
      this.lfo = ctx.createOscillator(); this.lfo.type = 'square';
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.35; this.lfo.connect(lfoG); lfoG.connect(am.gain);
      this.o1.connect(am); this.o2.connect(am); this.o3.connect(g3); g3.connect(am);
      am.connect(shaper); shaper.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      [this.o1, this.o2, this.o3, this.lfo].forEach(o => o.start());
      // noise bed for terrain / mud / water / wind
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = nb.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.5; }
      this.noiseBuf = nb;
      const mk = (type, f, q) => { const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; src.connect(fl); fl.connect(g); g.connect(this.master); src.start(); return { g, fl }; };
      this.rumble = mk('lowpass', 300, 0.7);
      this.slosh = mk('bandpass', 700, 1.2);
      this.wind = mk('highpass', 900, 0.5);
      this.ready = true;
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }
  update(s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, tc = 0.06;
    const rpm = s.rpm; // 800..6000
    const f = rpm / 60 * 0.5 * 4; // 8 cylinders, 4 stroke => rpm/60*4 firings; scaled down
    this.o1.frequency.setTargetAtTime(f * 0.5, t, tc);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, tc);
    this.o3.frequency.setTargetAtTime(f * 0.25, t, tc);
    this.lfo.frequency.setTargetAtTime(f * 0.125, t, tc);
    this.engFilter.frequency.setTargetAtTime(250 + s.load * 1400 + rpm * 0.12, t, tc);
    this.engGain.gain.setTargetAtTime(s.on ? 0.1 + s.load * 0.12 : 0, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(s.on ? Math.min(0.35, s.speed * 0.012 * s.ground) : 0, t, 0.1);
    this.slosh.g.gain.setTargetAtTime(s.on ? Math.min(0.5, s.mud * s.spin * 0.12 + s.water * Math.min(1, s.speed * 0.2) * 0.5) : 0, t, 0.08);
    this.wind.g.gain.setTargetAtTime(s.on ? Math.min(0.12, s.speed * s.speed * 0.00012) : 0, t, 0.2);
  }
  thud(strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 160 + strength * 200;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, 0.25 + strength * 0.8), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(fl); fl.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
  }
  chime(final = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const notes = final ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
    notes.forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = ctx.createGain(); const st = t + i * 0.09;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.25, st + 0.01); g.gain.exponentialRampToValueAtTime(0.001, st + 0.5);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + 0.55);
    });
  }
  beep(high = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 880 : 440;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  click() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 180;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.08);
  }
}

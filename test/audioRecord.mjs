import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto('http://localhost:8766/index.html?q=low&manual=1&post=0', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__game, null, { timeout: 240000 });
const result = await p.evaluate(async () => {
  const g = window.__game, A = g.audio;
  g.start('trail');                       // creates AudioContext + starts engine (starter during countdown)
  await new Promise(r => { const c = () => (A.engineReady ? r() : setTimeout(c, 50)); c(); });
  const dest = A.ctx.createMediaStreamDestination(); A.out.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data); rec.start(250);
  // scripted drive, real time, physics stepped without rendering
  const plan = [[3.4, null], [2.0, {}], [6.5, { throttle: 1 }], [2.2, {}], [1.5, { brake: 1 }], [0.6, { brake: 1 }], [3.0, { throttle: 0.7, low: 1 }], [1.2, {}], [2.5, { brake: 1 }], [1.5, {}]];
  const log = [];
  const t0 = performance.now(); let last = t0, seg = 0, segStart = t0;
  await new Promise(done => {
    const iv = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (now - segStart > plan[seg][0] * 1000) { seg++; segStart = now; if (seg >= plan.length) { clearInterval(iv); done(); return; } }
      const step = plan[seg][1];
      if (step) { if (g.S.mode === 'countdown') { g.S.countdown = 0; } g.phys.lowRange = !!step.low; g.setInput({ throttle: step.throttle || 0, brake: step.brake || 0 }); }
      g.tick(dt, 1, false);
      if (log.length === 0 || now - log[log.length - 1].t > 250) log.push({ t: now, rpm: Math.round(g.drive.rpm), gear: g.drive.label, kmh: Math.round(g.phys.speed * 3.6), load: +g.drive.load.toFixed(2) });
    }, 16);
  });
  rec.stop(); await new Promise(r => setTimeout(r, 400));
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
  return { mode: A.engineMode, b64: btoa(bin), log: log.map(l => ({ ...l, t: +((l.t - t0) / 1000).toFixed(2) })) };
});
fs.writeFileSync('/tmp/engine_run.webm', Buffer.from(result.b64, 'base64'));
console.log('engine mode:', result.mode, '| recorded bytes', Buffer.from(result.b64, 'base64').length);
for (const l of result.log.filter((_, i) => i % 4 === 0)) console.log(`t=${l.t}s rpm ${l.rpm} ${l.gear} ${l.kmh} km/h load ${l.load}`);
console.log(errs.join('\n') || 'no errors');
await b.close();

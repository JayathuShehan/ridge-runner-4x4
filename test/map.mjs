import { Terrain, N, HALF, COURSE } from '../src/terrain.js';
import fs from 'fs';
const T = new Terrain();
const W = N; const buf = Buffer.alloc(W * W * 3);
for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
  const id = j * N + i, h = T.h[id];
  let r, g, b;
  if (h < 0) { r = 40; g = 90; b = 160; }
  else { const v = Math.min(255, 60 + h * 3); r = v * 0.6; g = v; b = v * 0.5; }
  if (T.trail[id] > 0.5) { r = 200; g = 160; b = 100; }
  if (T.mud[id] > 0.3) { r = 90; g = 60; b = 30; }
  const o = ((W - 1 - j) * W + i) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
}
for (const rk of T.rocks) { const i = Math.round(rk.x + HALF), j = Math.round(rk.z + HALF); const o = ((W - 1 - j) * W + i) * 3; if (o > 0 && o < buf.length) { buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; } }
COURSE.forEach(([x, z], k) => { for (let a = -3; a <= 3; a++) for (let b2 = -3; b2 <= 3; b2++) { const o = ((W - 1 - Math.round(z + HALF + b2)) * W + Math.round(x + HALF + a)) * 3; buf[o] = 255; buf[o + 1] = 0; buf[o + 2] = 0; } });
fs.writeFileSync('/tmp/map.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), buf]));
// trail grade profile
let maxG = 0, at = 0;
for (let k = 0; k < T.trailPts.length; k++) {
  const a = T.trailPts[k], b = T.trailPts[(k + 3) % T.trailPts.length];
  const g = (T.heightAt(b[0], b[1]) - T.heightAt(a[0], a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (Math.abs(g) > maxG) { maxG = Math.abs(g); at = k; }
}
console.log('max grade', maxG.toFixed(2), 'at', T.trailPts[at].map(v => v.toFixed(0)));
console.log('cp heights', COURSE.map((c, i) => T.checkpoint(i).y.toFixed(1)).join(' '));

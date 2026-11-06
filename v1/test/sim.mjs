// Headless physics tests (node)
import { Terrain, COURSE } from '../src/terrain.js';
import { TruckPhysics } from '../src/vehicle.js';
import { makeBot } from '../src/bot.js';

const t0 = Date.now();
const T = new Terrain();
console.log('terrain gen ms', Date.now() - t0, 'trail len', T.trailLen.toFixed(0), 'rocks', T.rocks.length, 'trees', T.trees.length);
const dt = 1 / 120;
const inp = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...o });
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name, info); if (!ok) fails++; };

// 1. settle
const P = new TruckPhysics(T);
const cp0 = T.checkpoint(0);
P.reset(cp0.x, cp0.z, Math.atan2(cp0.tx, cp0.tz));
let maxV = 0;
for (let i = 0; i < 600; i++) { P.step(dt, inp()); if (i > 360) maxV = Math.max(maxV, P.vel.length()); }
const clearance = P.pos.y - T.heightAt(P.pos.x, P.pos.z);
check('settles at rest', maxV < 0.05, `maxV=${maxV.toFixed(4)} height=${clearance.toFixed(2)} comp=${P.wheels.map(w => w.comp.toFixed(2))}`);
check('ride height sane', clearance > 0.7 && clearance < 1.2, clearance.toFixed(2));

// 2. accelerate straight
let sx = P.pos.clone();
for (let i = 0; i < 120 * 4; i++) P.step(dt, inp({ throttle: 1 }));
check('accelerates', P.speed > 12, `speed after 4s=${(P.speed * 3.6).toFixed(1)} km/h`);
// 3. brake
for (let i = 0; i < 120 * 3; i++) P.step(dt, inp({ brake: 1 }));
check('brakes/reverses', P.speed < 1, `speed=${P.speed.toFixed(2)}`);
// 4. steering right turns right (clockwise seen from above => heading decreases toward -x when facing +z)
P.reset(cp0.x, cp0.z, 0);
for (let i = 0; i < 240; i++) P.step(dt, inp());
for (let i = 0; i < 120 * 2; i++) P.step(dt, inp({ throttle: 0.7, steer: 1 }));
P.updateAxes();
// screen-right of a camera looking +z is -x
check('steer right goes screen-right', P.pos.x < cp0.x - 1, `dx=${(P.pos.x - cp0.x).toFixed(2)}`);

// 5. bot full course, 4WD
function runBot(fourWD, maxTime = 600, verbose = false) {
  const p = new TruckPhysics(T);
  p.fourWD = fourWD;
  const c = T.checkpoint(0);
  p.reset(c.x, c.z, Math.atan2(c.tx, c.tz));
  const bot = makeBot(T, p);
  let next = 1, time = 0, flips = 0, resets = 0, stuckT = 0, lastCp = 0;
  const cps = COURSE.length;
  const splits = [];
  let upsideT = 0;
  while (time < maxTime) {
    const i = bot.drive(dt);
    p.step(dt, i);
    time += dt;
    const target = T.checkpoint(next % cps);
    if (Math.hypot(p.pos.x - target.x, p.pos.z - target.z) < 9) {
      splits.push(time.toFixed(1));
      if (next === cps) return { done: true, time, splits, flips, resets };
      lastCp = next; next++;
    }
    p.updateAxes();
    if (p.up.y < 0.3) { upsideT += dt; } else upsideT = 0;
    if (upsideT > 2) { console.log('  flip at', p.pos.toArray().map(v=>v.toFixed(0)).join(','), 'next cp', next); flips++; upsideT = 0; const l = T.checkpoint(lastCp); p.reset(l.x, l.z, Math.atan2(l.tx, l.tz)); bot.resetTo(lastCp); }
    if (Math.abs(p.speed) < 0.5) stuckT += dt; else stuckT = 0;
    if (stuckT > 8) { console.log('  stuck at', p.pos.toArray().map(v=>v.toFixed(0)).join(','), 'next cp', next); resets++; stuckT = 0; const l = T.checkpoint(lastCp); p.reset(l.x, l.z, Math.atan2(l.tx, l.tz)); bot.resetTo(lastCp); }
  }
  return { done: false, time, splits, next, flips, resets, pos: p.pos.toArray().map(v => v.toFixed(0)) };
}
let ts = Date.now();
const r4 = runBot(true);
console.log('4WD bot', JSON.stringify(r4), 'wall ms', Date.now() - ts);
check('4WD bot completes course', r4.done && r4.resets <= 1 && r4.flips === 0);
const r2 = runBot(false);
console.log('2WD bot', JSON.stringify(r2));
check('NaN guard never triggered', !P.nanReset);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

// Headless physics tests (node)
import { Terrain, COURSE } from '../src/terrain.js';
import { TruckPhysics } from '../src/vehicle.js';
import { makeBot } from '../src/bot.js';
import { VEHICLES, MODS, resolveSetup, modRange } from '../src/garage.js';

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
function runBot(fourWD, maxTime = 600, verbose = false, setup = null) {
  const p = new TruckPhysics(T);
  if (setup) p.applySetup(setup);
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

// 6. garage: every vehicle at stock, and each mod at its extremes, must settle / drive / stay finite
const lo = (v) => Object.fromEntries(MODS.map(m => [m.key, m.min])), hi = () => Object.fromEntries(MODS.map(m => [m.key, m.max]));
const trials = [];
for (const v of VEHICLES) trials.push([v.id + ' stock', resolveSetup(v.id)]);
trials.push(['all min', resolveSetup('runner', lo())], ['all max', resolveSetup('runner', hi())]);
for (const m of MODS) for (const [tag, val] of [['min', m.min], ['max', m.max]]) trials.push([`runner ${m.key} ${tag}`, resolveSetup('runner', { [m.key]: val })]);
// realistic models: every mod at both ends of that model's own range
for (const v of VEHICLES.filter(v => v.isModel)) {
  const ends = (k) => Object.fromEntries(MODS.map(m => [m.key, modRange(v.id, m)[k]]));
  trials.push([`${v.id} all min`, resolveSetup(v.id, ends('min'))], [`${v.id} all max`, resolveSetup(v.id, ends('max'))]);
}
for (const [name, setup] of trials) {
  const Q = new TruckPhysics(T); Q.applySetup(setup);
  Q.reset(cp0.x, cp0.z, Math.atan2(cp0.tx, cp0.tz));
  let mv = 0;
  for (let i = 0; i < 720; i++) { Q.step(dt, inp()); if (i > 480) mv = Math.max(mv, Q.vel.length()); }
  const h = Q.pos.y - T.heightAt(Q.pos.x, Q.pos.z);
  const expect = setup.stats.clearance / 100 + setup.belly;      // garage readout vs simulated ride height
  for (let i = 0; i < 480; i++) Q.step(dt, inp({ throttle: 1 }));
  const sp = Q.speed * 3.6;
  check(`garage ${name}`, mv < 0.06 && Math.abs(h - expect) < 0.08 && sp > 10 && !Q.nanReset && Q.up.y > 0.7,
    `up=${Q.up.y.toFixed(2)} rest=${mv.toFixed(3)} h=${h.toFixed(2)} (readout ${expect.toFixed(2)}) 4s=${sp.toFixed(0)}km/h clr=${setup.stats.clearance}cm crawl=${setup.stats.crawl}% stab=${setup.stats.stability}%`);
}
for (const id of ['scout', 'titan', ...VEHICLES.filter(v => v.isModel).map(v => v.id)]) {
  const r = runBot(true, 600, false, resolveSetup(id));
  console.log(id + ' bot', JSON.stringify({ done: r.done, time: +r.time.toFixed(1), flips: r.flips, resets: r.resets }));
  if (VEHICLES.find(v => v.id === id).hard) check(id + ' bot (hard mode) stays upright and gets going', r.flips === 0 && (r.done || r.next >= 2));
  else check(id + ' bot completes course', r.done && r.flips === 0 && r.resets <= 2);
}
// 7. render interpolation: blend is between prev and current step, and pop restores the exact real state
{
  const Q = new TruckPhysics(T); Q.reset(cp0.x, cp0.z, Math.atan2(cp0.tx, cp0.tz));
  for (let i = 0; i < 300; i++) Q.step(dt, inp({ throttle: 1 }));
  const before = Q.pos.clone(), bq = Q.quat.clone(), prev = Q.prevPos.clone();
  Q.pushInterp(0.5);
  const mid = Q.pos.clone();
  const okMid = mid.distanceTo(before.clone().add(prev).multiplyScalar(0.5)) < 1e-9 && Q.prevPos.distanceTo(prev) < 1e-12;
  Q.popInterp();
  check('interpolation blends prev/current', okMid && prev.distanceTo(before) > 1e-4, `step=${(prev.distanceTo(before) * 1000).toFixed(1)}mm`);
  check('interpolation restores real state', Q.pos.equals(before) && Q.quat.equals(bq));
  Q.reset(cp0.x + 5, cp0.z, 0); Q.pushInterp(0.3);
  check('no blending across a reset', Q.pos.distanceTo(Q._sp) < 1e-12); Q.popInterp();
}
check('NaN guard never triggered', !P.nanReset);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

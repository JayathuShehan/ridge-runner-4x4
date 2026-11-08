// Vehicle roster + tuning. Pure data/maths (no three.js) so the physics tests can use it too.
// A "setup" = chosen vehicle + its four modifications, resolved into the numbers the physics and model consume.

import { MODEL_VEHICLES } from './vehicles3d.js';

// Reference values of the stock Ridge Runner (what the physics was originally tuned around)
export const BASE = { mass: 1650, R: 0.5, restLen: 0.58, half: 0.98, sag: 0.261, belly: 0.42, mountY: 0.1 };

// The four modifications. Values are stored in the unit shown (cm / %). These ranges apply to the procedural
// trail rigs; the realistic models get a window around their own stock values (see fromModel).
export const MODS = [
  { key: 'travel', label: 'Suspension travel', unit: 'cm', min: 40, max: 85, step: 1, hint: 'Longer travel lifts the body and soaks up whoops, but raises the centre of gravity.' },
  { key: 'tyre', label: 'Tyre size', unit: 'cm', min: 85, max: 118, step: 1, hint: 'Taller tyres add clearance, float over mud and rocks, but lower the gearing (less pulling force).' },
  { key: 'grip', label: 'Tyre grip', unit: '%', min: 70, max: 140, step: 5, hint: 'Stickier rubber for more traction, with a little extra rolling drag.' },
  { key: 'track', label: 'Width', unit: 'cm', min: 176, max: 232, step: 2, hint: 'A wider track resists rolling over; the body is widened to match.' },
];

const PROCEDURAL = [
  { id: 'runner', name: 'Ridge Runner', blurb: 'Balanced all-rounder', mass: 1650, power: 1.0, stock: { travel: 58, tyre: 100, grip: 100, track: 196 } },
  { id: 'scout', name: 'Scout', blurb: 'Light and nimble, modest power', mass: 1350, power: 0.82, stock: { travel: 64, tyre: 92, grip: 100, track: 186 } },
  { id: 'titan', name: 'Titan', blurb: 'Heavy and powerful, big boots', mass: 2000, power: 1.32, stock: { travel: 54, tyre: 108, grip: 100, track: 208 } },
].map(v => ({ ...v, cat: 'Trail rigs' }));

const snap = (v, m) => Math.round(v / m.step) * m.step;
// A realistic glTF vehicle as a garage vehicle: stock mods come from the model's real tyre/travel/track,
// and each mod's range is a window around that stock value (a 52 cm rover tyre can't use the 85-118 cm truck range).
function fromModel(d) {
  const stock = { travel: Math.round(d.restLen * 100), tyre: Math.round(d.R * 200), grip: d.grip, track: Math.round(d.half * 200 / 2) * 2 };
  const span = { travel: [0.75, 1.4], tyre: [0.88, 1.15], track: [0.94, 1.12] };
  const ranges = {};
  for (const m of MODS) {
    if (!span[m.key]) continue;
    const [a, b] = span[m.key];
    ranges[m.key] = [Math.min(stock[m.key], snap(stock[m.key] * a, m)), Math.max(stock[m.key], snap(stock[m.key] * b, m))];
  }
  // keep at least ~6 cm of belly clearance with every mod at its minimum (low cars would otherwise sit on their floor)
  const mountY = d.wy + d.restLen - d.sag, rMin = ranges.tyre[0] / 200;
  const tMin = Math.ceil((0.06 + -d.hull.yBot + mountY + d.sag - rMin) * 100);
  ranges.travel[0] = Math.min(stock.travel, Math.max(ranges.travel[0], tMin));
  // power is expressed against the stock truck's 11.5 kN at a 0.5 m tyre (the physics scales force by 0.5 / R)
  const power = d.fHi * d.R / (11500 * 0.5);
  return { ...d, power, stock, ranges, isModel: true };
}

export const VEHICLES = [...PROCEDURAL, ...MODEL_VEHICLES.map(fromModel)];
export const CATEGORIES = ['Trail rigs', 'Off-road', 'Trucks', 'Road & race', 'Specials'].filter(c => VEHICLES.some(v => v.cat === c));

export const vehicleById = (id) => VEHICLES.find(v => v.id === id) || VEHICLES[0];
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// slider range of a modification for a vehicle
export function modRange(vehId, m) {
  const v = vehicleById(vehId), r = v.ranges && v.ranges[m.key];
  return r ? { min: r[0], max: r[1] } : { min: m.min, max: m.max };
}
// complete, clamped mods for a vehicle (missing keys fall back to that vehicle's stock value)
export function modsFor(vehId, saved) {
  const v = vehicleById(vehId), out = {};
  for (const m of MODS) {
    const raw = saved && Number.isFinite(saved[m.key]) ? saved[m.key] : v.stock[m.key];
    const { min, max } = modRange(v.id, m);
    out[m.key] = clampTo(Math.round(raw / m.step) * m.step, min, max);
  }
  return out;
}
export const isStock = (vehId, mods) => MODS.every(m => modsFor(vehId, mods)[m.key] === vehicleById(vehId).stock[m.key]);

export function resolveSetup(vehId, saved) {
  const v = vehicleById(vehId), mods = modsFor(v.id, saved);
  const R = mods.tyre / 200, restLen = mods.travel / 100, half = mods.track / 200;
  const wf = half / BASE.half;
  const s = {
    id: v.id, name: v.name, mods, mass: v.mass, power: v.power,
    R, restLen, half, grip: mods.grip / 100,
    bodyScaleX: 1 + (wf - 1) * 0.8,           // body widens at 80% of the track change; flares/tyres fill the rest
    sag: BASE.sag, mountY: -BASE.mountY, belly: BASE.belly,
  };
  if (v.isModel) {
    // realistic model: its own wheelbase, body box, springs, gearing and camera; mods move away from its stock
    const wfm = half / v.half;
    Object.assign(s, {
      model: v.model, modelDef: v, sag: v.sag, belly: -v.hull.yBot,
      mountY: v.wy + v.restLen - v.sag,                   // fixed mount; more travel / bigger tyres lift the body
      bodyScaleX: 1 + (wfm - 1) * 0.6,
      wheelZ: v.z, steer: v.steer, assist: v.assist, kMul: BASE.sag / v.sag,
      topMul: v.vHi / (36 * v.R / 0.5), cam: v.cam, cab: v.cab,
      Ib: inertia(v.mass, v.dims), hull: hullPoints(v.hull, v.half, v.z),
    });
  }
  s.stats = vehicleStats(s);
  return s;
}

// body-frame inertia (pitch, yaw, roll) of a box-ish vehicle, matched to the stock truck's hand-tuned values
function inertia(m, { L, W, H }) {
  return [m * (H * H + L * L) / 12 * 1.07, m * (W * W + L * L) / 12 * 1.15, m * (W * W + H * H) / 12 * 1.7];
}
// chassis contact points for a body described as a box with a cabin on top (body-local, origin = centre of mass)
export function hullPoints({ w, yBot, yMid, yTop, zF, zR, rf, rr, rw, extraZ = [] }, half, z) {
  const u = [], d = w / 2;
  for (const p of [-1, 1]) {
    u.push([p * d * 0.95, yBot, zF * 0.86], [p * d * 0.95, yBot, zR * 0.86]);
    u.push([p * d, yBot + 0.12, zF], [p * d, yBot + 0.15, zR]);
    u.push([p * d * 0.95, yMid, zF - 0.2], [p * d * 0.95, yMid, zR + 0.2]);
    u.push([p * rw / 2, yTop, rf], [p * rw / 2, yTop, rr]);
    u.push([p * (d + 0.05), (yBot + yMid) / 2, 0]);
    for (const wz of [...z, ...extraZ]) u.push([p * Math.max(d, half) + p * 0.02, yMid * 0.4 + yBot * 0.6, wz]);
  }
  u.push([0, yBot - 0.04, 0], [0, yBot - 0.04, zF * 0.55], [0, yBot - 0.04, zR * 0.55], [0, yBot + 0.05, zF + 0.03], [0, yBot + 0.1, zR - 0.03], [0, yTop + 0.05, (rf + rr) / 2]);
  return u;
}

// Readouts for the garage (approximate; clearance = belly height at rest)
export function vehicleStats(s) {
  const comH = -s.mountY + s.restLen - s.sag + s.R;                     // centre-of-mass height above ground at rest
  const ref = BASE.mountY + BASE.restLen - BASE.sag + BASE.R;
  return {
    clearance: Math.round((comH - s.belly) * 100),                       // cm
    crawl: Math.round(s.power * (BASE.R / s.R) * 100),                   // wheel force vs stock Ridge Runner
    stability: Math.round((s.half / comH) / (BASE.half / ref) * 100),    // track / CoM height vs stock Ridge Runner
    weight: s.mass,
  };
}

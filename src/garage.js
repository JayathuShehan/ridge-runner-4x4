// Vehicle roster + tuning. Pure data/maths (no three.js) so the physics tests can use it too.
// A "setup" = chosen vehicle + its four modifications, resolved into the numbers the physics and model consume.

// Reference values of the stock Ridge Runner (what the physics was originally tuned around)
export const BASE = { mass: 1650, R: 0.5, restLen: 0.58, half: 0.98, sag: 0.261, belly: 0.42, mountY: 0.1 };

// The four modifications. Values are stored in the unit shown (cm / %), ranges are the same for every vehicle.
export const MODS = [
  { key: 'travel', label: 'Suspension travel', unit: 'cm', min: 40, max: 85, step: 1, hint: 'Longer travel lifts the body and soaks up whoops, but raises the centre of gravity.' },
  { key: 'tyre', label: 'Tyre size', unit: 'cm', min: 85, max: 118, step: 1, hint: 'Taller tyres add clearance, float over mud and rocks, but lower the gearing (less pulling force).' },
  { key: 'grip', label: 'Tyre grip', unit: '%', min: 70, max: 140, step: 5, hint: 'Stickier rubber for more traction, with a little extra rolling drag.' },
  { key: 'track', label: 'Width', unit: 'cm', min: 176, max: 232, step: 2, hint: 'A wider track resists rolling over; the body is widened to match.' },
];

export const VEHICLES = [
  { id: 'runner', name: 'Ridge Runner', blurb: 'Balanced all-rounder', mass: 1650, power: 1.0, stock: { travel: 58, tyre: 100, grip: 100, track: 196 } },
  { id: 'scout', name: 'Scout', blurb: 'Light and nimble, modest power', mass: 1350, power: 0.82, stock: { travel: 64, tyre: 92, grip: 100, track: 186 } },
  { id: 'titan', name: 'Titan', blurb: 'Heavy and powerful, big boots', mass: 2000, power: 1.32, stock: { travel: 54, tyre: 108, grip: 100, track: 208 } },
];

export const vehicleById = (id) => VEHICLES.find(v => v.id === id) || VEHICLES[0];
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// complete, clamped mods for a vehicle (missing keys fall back to that vehicle's stock value)
export function modsFor(vehId, saved) {
  const v = vehicleById(vehId), out = {};
  for (const m of MODS) {
    const raw = saved && Number.isFinite(saved[m.key]) ? saved[m.key] : v.stock[m.key];
    out[m.key] = clampTo(Math.round(raw / m.step) * m.step, m.min, m.max);
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
  };
  s.stats = vehicleStats(s);
  return s;
}

// Readouts for the garage (approximate; clearance = belly height at rest)
export function vehicleStats(s) {
  const comH = BASE.mountY + s.restLen - BASE.sag + s.R;                 // centre-of-mass height above ground at rest
  const ref = BASE.mountY + BASE.restLen - BASE.sag + BASE.R;
  return {
    clearance: Math.round((comH - BASE.belly) * 100),                    // cm
    crawl: Math.round(s.power * (BASE.R / s.R) * 100),                   // wheel force vs stock Ridge Runner
    stability: Math.round((s.half / comH) / (BASE.half / ref) * 100),    // track / CoM height vs stock Ridge Runner
    weight: s.mass,
  };
}

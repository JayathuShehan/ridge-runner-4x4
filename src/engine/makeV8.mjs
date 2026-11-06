// Builds a cross-plane V8 configuration for the physically informed engine model, using real-world-ish dimensions.
import fs from 'fs';
const base = JSON.parse(fs.readFileSync(new URL('./example4.json', import.meta.url), 'utf8'));
const C = 343; // speed of sound m/s
const wg = (m, alpha, beta) => ({ chamber0: { samples: { delay: m / C } }, chamber1: { samples: { delay: m / C } }, alpha, beta });
let s = 9; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
// firing order 1-8-4-3-6-5-7-2; bank A = odd cylinders, bank B = even (left/right bank)
const order = [1, 8, 4, 3, 6, 5, 7, 2];
const proto = base.cylinders[0];
const cylinders = order.map((cyl, slot) => {
  const bankA = cyl % 2 === 1;
  const extractor = bankA ? 0.55 + rnd() * 0.12 : 0.86 + rnd() * 0.12;   // header primary lengths differ per bank
  const exhaustPort = 0.06 + rnd() * 0.04;
  const intakeRunner = 0.16 + rnd() * 0.08;
  return {
    crank_offset: slot / 8 + (rnd() - 0.5) * 0.006,
    bank: bankA ? 0 : 1,
    exhaust_waveguide: wg(exhaustPort, proto.exhaust_waveguide.alpha, proto.exhaust_waveguide.beta),
    intake_waveguide: wg(intakeRunner, proto.intake_waveguide.alpha, 0.02),
    extractor_waveguide: wg(extractor, 0, 0.012),
    intake_open_refl: proto.intake_open_refl, intake_closed_refl: proto.intake_closed_refl,
    exhaust_open_refl: proto.exhaust_open_refl, exhaust_closed_refl: proto.exhaust_closed_refl,
    piston_motion_factor: 1.25 + rnd() * 0.2,
    ignition_factor: 5 * (0.93 + rnd() * 0.14),
    ignition_time: 0.15 + rnd() * 0.03,
  };
});
const v8 = {
  ...base,
  rpm: 750,
  intake_volume: 0.26,
  exhaust_volume: 0.74,
  engine_vibrations_volume: 0.06,
  intake_noise_factor: 0.09,
  crankshaft_fluctuation: 0.12,
  cylinders,
  cycle_variation: 0.12,
  muffler: {
    straight_pipe: wg(2.2, 0.06, -0.02),
    muffler_elements: [0.13, 0.16, 0.19, 0.23].map(m => wg(m, 0, -0.06)),
  },
  muffler2: {
    straight_pipe: wg(2.45, 0.06, -0.02),
    muffler_elements: [0.12, 0.155, 0.2, 0.24].map(m => wg(m, 0, -0.06)),
  },
};
fs.writeFileSync(new URL('./v8.json', import.meta.url), JSON.stringify(v8));
console.log('V8 written:', cylinders.map(c => c.crank_offset.toFixed(3)).join(' '));

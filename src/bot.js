// Simple autopilot that follows the trail. Used for automated testing and the menu attract mode.
import { clamp } from './noise.js';

export function makeBot(terrain, ph) {
  const pts = terrain.trailPts, n = pts.length;
  let k = 0; // trail index we are near
  const nearest = () => {
    let best = k, bd = Infinity;
    for (let o = -20; o <= 60; o++) {
      const i = (k + o + n) % n;
      const d = (pts[i][0] - ph.pos.x) ** 2 + (pts[i][1] - ph.pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    k = best;
    return Math.sqrt(bd);
  };
  let reverseT = 0, stuckT = 0;
  return {
    resetTo(cpIndex) { k = Math.round(terrain.cpS[cpIndex] / terrain.ds) % n; reverseT = 0; stuckT = 0; },
    drive(dt) {
      ph.updateAxes();
      nearest();
      const speed = ph.speed;
      const look = clamp(8 + Math.abs(speed) * 0.9, 8, 30);
      const tgt = pts[(k + Math.round(look / terrain.ds)) % n];
      const far = pts[(k + Math.round((look + 25) / terrain.ds)) % n];
      const dx = tgt[0] - ph.pos.x, dz = tgt[1] - ph.pos.z;
      // signed angle between forward and target (positive => target to the left (+x side))
      const f = ph.fwd, l = ph.right;
      const ang = Math.atan2(dx * l.x + dz * l.z, dx * f.x + dz * f.z);
      // curvature ahead -> slow down
      const ax = far[0] - tgt[0], az = far[1] - tgt[1];
      const turn = Math.abs(Math.atan2(ax * l.x + az * l.z, ax * f.x + az * f.z));
      let vT = clamp(24 - turn * 22 - Math.abs(ang) * 10, 7, 24);
      if (ph.mudAmt > 0.2) vT = Math.min(vT, 9);
      if (ph.waterAmt > 0.1) vT = Math.min(vT, 6);
      const s = k * terrain.ds;
      if (s > terrain.garden[0] - 15 && s < terrain.garden[1] + 5) vT = Math.min(vT, 5);
      const steer = clamp(-ang * 2.2, -1, 1);
      let throttle = speed < vT ? clamp((vT - speed) * 0.4, 0.3, 1) : 0;
      let brake = speed > vT + 3 ? clamp((speed - vT) * 0.15, 0, 1) : 0;
      // low range on steep slopes / when slow
      ph.lowRange = ph.fwd.y > 0.3 || (speed < 3 && ph.fwd.y > 0.15);
      // stuck handling: back up briefly
      if (throttle > 0 && Math.abs(speed) < 0.6) stuckT += dt; else stuckT = 0;
      if (stuckT > 2.5) { reverseT = 1.5; stuckT = 0; }
      if (reverseT > 0) { reverseT -= dt; return { throttle: 0, brake: 1, steer: -steer, handbrake: false }; }
      return { throttle, brake, steer, handbrake: false };
    },
  };
}

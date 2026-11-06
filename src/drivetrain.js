// Automatic gearbox + torque converter model that turns vehicle state into engine RPM, load and gear.
const TAU = Math.PI * 2;
export class Drivetrain {
  constructor() {
    this.idle = 720; this.limiter = 5600; this.stall = 2300;
    this.ratios = [3.54, 2.14, 1.42, 1.0, 0.78]; this.final = 4.1; this.lowRatio = 2.72; this.revRatio = 3.3;
    this.gear = 1; this.rpm = this.idle; this.shiftT = 0; this.shiftDur = 0; this.cooldown = 0; this.t = 0;
    this.reverse = false; this.load = 0.2; this.label = 'N';
  }
  update(dt, s) {
    // s: speed (m/s along truck), wheelSurf (max |driven wheel surface speed| m/s), throttle, brake, low, R, running
    this.t += dt;
    const low = s.low;
    // reverse when the driver is pressing "brake" while (almost) stopped or already rolling backwards
    if (s.speed < -0.4 || (s.brake > 0 && s.speed < 0.8 && s.throttle === 0)) this.reverse = s.brake > 0 || s.speed < -0.4;
    else if (s.throttle > 0 && s.speed > -0.2) this.reverse = false;
    // in reverse the driver's "brake" pedal is the accelerator
    const thr = this.reverse ? Math.max(s.throttle, s.brake) : s.throttle;
    const wheelRpm = (s.wheelSurf / (TAU * s.R)) * 60;
    const range = low ? this.lowRatio : 1;
    const ratioOf = (g) => (this.reverse ? this.revRatio : this.ratios[g - 1]) * this.final * range;
    let coupled = wheelRpm * ratioOf(this.gear);
    // automatic shifting (not in reverse)
    this.cooldown -= dt;
    if (!this.reverse && this.shiftT <= 0 && this.cooldown <= 0) {
      const up = 1750 + thr * 2900, down = 1050 + thr * 1150;
      if (coupled > up && this.gear < 5) this.shift(+1, 0.32);
      else if (this.gear > 1 && (coupled < down || (thr > 0.92 && coupled < 2300 && wheelRpm * ratioOf(this.gear - 1) < 4600))) this.shift(-1, 0.26);
    }
    if (this.reverse) this.gear = 1;
    coupled = wheelRpm * ratioOf(this.gear);
    // torque converter: engine can run above the coupled speed up to stall rpm when loaded at low speed
    const tc = this.idle + thr * (this.stall - this.idle);
    const slip = Math.max(0, Math.min(1, 1 - coupled / (this.stall * 1.1)));
    let target = thr > 0 ? Math.max(coupled * 1.04, coupled + (tc - coupled) * slip) : Math.max(this.idle, coupled);
    target = Math.max(this.idle + Math.sin(this.t * 1.9) * 10 + Math.sin(this.t * 5.3) * 6, target);
    target = Math.min(target, this.limiter + 150);
    if (!s.running) target = 0;
    // shift: revs fall towards the new gear while power is briefly cut
    let cut = 1;
    if (this.shiftT > 0) { this.shiftT -= dt; const k = 1 - this.shiftT / this.shiftDur; cut = k < 0.45 ? 0.35 : 1; }
    this.rpm += (target - this.rpm) * Math.min(1, dt * (this.shiftT > 0 ? 7 : 11));
    // engine load: throttle demand, minus shift cut; closed throttle = overrun
    this.load = thr > 0 ? (0.3 + 0.7 * thr) * cut : 0.12;
    this.label = this.reverse ? 'R' : (Math.abs(s.speed) < 0.3 && thr === 0 ? 'N' : (low ? 'L' : 'D') + this.gear);
    // drivetrain whine pitch: propshaft speed x gear mesh teeth
    const prop = wheelRpm * this.final * range;
    this.whineHz = (prop / 60) * 29;
    this.whineGain = Math.min(1, s.wheelSurf / (low ? 6 : 25)) * (low ? 0.9 : 0.25);
    return this;
  }
  shift(dir, dur) { this.gear += dir; this.shiftT = this.shiftDur = dur; this.cooldown = dur + 0.6; }
  reset() { this.gear = 1; this.rpm = this.idle; this.shiftT = 0; this.reverse = false; }
}

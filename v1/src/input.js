// Keyboard + touch + gamepad input
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.steerSmooth = 0;
    this.pressed = new Set(); // one-shot actions
    this.override = null;     // used by tests / attract mode
    const map = { KeyF: 'fourwd', KeyL: 'low', KeyR: 'reset', KeyC: 'camera', KeyN: 'night', KeyM: 'mute', Escape: 'pause', KeyP: 'pause', KeyH: 'help' };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      if (map[e.code]) this.pressed.add(map[e.code]);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    this.padPrev = {};
  }
  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach(el => {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[k] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    root.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pressed.add(el.dataset.action); });
    });
  }
  take(action) { if (this.pressed.has(action)) { this.pressed.delete(action); return true; } return false; }
  clearActions() { this.pressed.clear(); }
  read(dt) {
    if (this.override) return this.override;
    const k = this.keys;
    let thr = (k.has('KeyW') || k.has('ArrowUp') || this.touch.gas) ? 1 : 0;
    let brk = (k.has('KeyS') || k.has('ArrowDown') || this.touch.brake) ? 1 : 0;
    let st = ((k.has('KeyD') || k.has('ArrowRight') || this.touch.right) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft') || this.touch.left) ? 1 : 0);
    let hb = k.has('Space');
    // smooth digital steering
    const rate = st === 0 ? 6 : 4.5;
    this.steerSmooth += Math.max(-rate * dt, Math.min(rate * dt, st - this.steerSmooth));
    st = this.steerSmooth;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) st = ax;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (rt > 0.05) thr = rt; if (lt > 0.05) brk = lt;
      if (p.buttons[0] && p.buttons[0].pressed) thr = Math.max(thr, 1);
      if (p.buttons[1] && p.buttons[1].pressed) hb = true;
      const edge = (i, a) => { const v = !!(p.buttons[i] && p.buttons[i].pressed); if (v && !this.padPrev[i]) this.pressed.add(a); this.padPrev[i] = v; };
      edge(3, 'fourwd'); edge(2, 'low'); edge(9, 'pause'); edge(8, 'reset'); edge(5, 'camera');
      break;
    }
    return { throttle: thr, brake: brk, steer: st, handbrake: hb };
  }
}

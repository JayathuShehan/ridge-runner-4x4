import * as THREE from 'three';
import { Terrain, COURSE, CP_LABELS, HALF, N, WATER } from './terrain.js';
import { TruckPhysics, buildTruckModel, syncTruckModel } from './vehicle.js';
import { buildTerrainMeshes, buildWater, buildSky, buildTrees, buildRocks, buildGates, buildArrow } from './world.js';
import { Particles, Tracks } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { makeBot } from './bot.js';
import { clamp, lerp, makeRng } from './noise.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const fmt = (t) => { if (t == null || !isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const tick = () => new Promise(r => setTimeout(r, 16));
const PAINTS = [0xe8572a, 0xc62828, 0xf2b705, 0x1f8a8a, 0x2456b8, 0x5b6b3a, 0xe9e9e9, 0x222222];
const MEDALS = [[140, '🥇', 'Gold'], [185, '🥈', 'Silver'], [250, '🥉', 'Bronze']];
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

async function boot() {
  const setLoad = (p, msg) => { $('loadBar').style.width = `${p}%`; if (msg) $('loadMsg').textContent = msg; };
  setLoad(5);
  await tick();
  // ---------- renderer
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    $('loadMsg').textContent = 'WebGL is not available in this browser.';
    return;
  }
  let quality = store.get('rr_quality', isTouch ? 'low' : 'high');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2400);
  const fogDay = new THREE.Color(0xc9dcea);
  scene.fog = new THREE.Fog(fogDay.clone(), 140, 600);

  // ---------- lights
  const hemi = new THREE.HemisphereLight(0xd6ecff, 0x56663a, 1.15);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(0.45, 0.62, 0.35).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.9);
  sun.castShadow = true;
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50; sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const applyQuality = () => {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.25));
    const ms = quality === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    $('btnQuality').textContent = `Graphics: ${quality === 'high' ? 'High' : 'Low'}`;
    resize();
  };
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  applyQuality();

  // ---------- world
  setLoad(15, 'Shaping the terrain…'); await tick();
  const T = new Terrain(11);
  setLoad(45, 'Planting trees…'); await tick();
  const terrainLod = buildTerrainMeshes(T, scene);
  const water = buildWater(scene, makeRng(3));
  const sky = buildSky(scene);
  setLoad(65, 'Placing rocks…'); await tick();
  const props = [...buildTrees(T, scene), ...buildRocks(T, scene)];
  const gatesObj = buildGates(T, scene);
  const arrow = buildArrow(scene);
  // stars (night)
  const starGeo = new THREE.BufferGeometry();
  { const rng = makeRng(42); const arr = new Float32Array(1500 * 3); for (let i = 0; i < 1500; i++) { const u = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u); const y = Math.abs(u); arr.set([Math.cos(a) * r * 1300, y * 1300 + 50, Math.sin(a) * r * 1300], i * 3); } starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 }));
  scene.add(stars);
  setLoad(80, 'Building your truck…'); await tick();

  // ---------- truck
  const phys = new TruckPhysics(T);
  let paint = store.get('rr_paint', PAINTS[0]);
  let truck = buildTruckModel(paint);
  scene.add(truck);
  const headL = [];
  const makeHeadlights = () => {
    headL.length = 0;
    for (const x of [-0.68, 0.68]) {
      const sl = new THREE.SpotLight(0xfff2d0, 0, 110, 0.55, 0.5, 1.0);
      sl.position.set(x, 0.25, 2.2);
      sl.target.position.set(x * 1.6, -1.2, 14);
      truck.add(sl, sl.target);
      headL.push(sl);
    }
  };
  makeHeadlights();
  const particles = new Particles(scene);
  const tracks = new Tracks(scene);
  const audio = new GameAudio();
  const input = new Input();
  input.bindTouch($('touch'));

  // ---------- game state
  const S = {
    mode: 'menu', type: 'trail', next: 1, time: 0, running: false, countdown: 0, lastCp: 0,
    camMode: 0, night: false, resets: 0, splits: [], lastResetT: -10, upsideT: 0, hintsShown: {}, stuckT: 0,
    best: { trail: store.get('rr_best_trail', null) },
  };
  let bot = makeBot(T, phys);
  const cpCount = COURSE.length; // checkpoints 1..cpCount-1, then finish 0
  const placeAtCp = (i) => {
    const c = T.checkpoint(i);
    phys.reset(c.x - c.tx * 4, c.z - c.tz * 4, Math.atan2(c.tx, c.tz));
    tracks.clear();
  };

  // ---------- UI helpers
  let toastT = 0, hintT = 0;
  const toast = (html, dur = 1.6) => { const el = $('toast'); el.innerHTML = html; el.classList.add('show'); toastT = dur; };
  const hint = (html, dur = 4) => { const el = $('hint'); el.innerHTML = html; el.classList.add('show'); hintT = dur; };
  const showOnly = (id) => { for (const o of ['menu', 'pause', 'finish']) $(o).classList.toggle('hidden', o !== id); };
  const flash = () => { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = 0.35; requestAnimationFrame(() => { f.style.transition = 'opacity 0.5s'; f.style.opacity = 0; }); };

  // paint swatches
  const sw = $('swatches');
  PAINTS.forEach(p => {
    const d = document.createElement('div'); d.className = 'sw' + (p === paint ? ' sel' : ''); d.style.background = '#' + p.toString(16).padStart(6, '0');
    d.addEventListener('click', () => {
      paint = p; store.set('rr_paint', p); dirt = 0;
      truck.userData.paint.color.setHex(p);
      sw.querySelectorAll('.sw').forEach(e => e.classList.remove('sel')); d.classList.add('sel');
      audio.init(); audio.click();
    });
    sw.appendChild(d);
  });
  const updateMenuBest = () => { $('menuBest').textContent = S.best.trail ? `Best ${fmt(S.best.trail)} · 13 checkpoints` : '13 checkpoints · beat the clock'; };
  updateMenuBest();

  // ---------- modes
  function startGame(type) {
    audio.init();
    S.type = type; S.mode = 'countdown'; S.countdown = type === 'trail' ? 3.2 : 0.01; S.time = 0; S.next = 1; S.lastCp = 0; S.resets = 0; S.splits = [];
    S.running = false; S.upsideT = 0; S.stuckT = 0;
    phys.fourWD = true; phys.lowRange = false;
    dirt = 0;
    placeAtCp(0);
    input.override = null; input.clearActions();
    showOnly(null);
    $('hud').classList.remove('hidden');
    $('topLeft').classList.toggle('hidden', type !== 'trail');
    $('touch').classList.toggle('hidden', !isTouch);
    document.body.classList.toggle('touch', isTouch);
    S.camMode = 0; camState.init = false;
    gatesObj.gates.forEach(g => (g.group.visible = true));
    $('bestTime').textContent = fmt(S.best.trail);
    if (type === 'free') { toast('FREE ROAM<small>Explore the valley. Press Esc for the menu.</small>', 3); }
    lastCountNum = null;
  }
  function toMenu() {
    S.mode = 'menu';
    $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
    showOnly('menu');
    updateMenuBest();
    placeAtCp(0);
    bot = makeBot(T, phys); bot.resetTo(0);
    phys.fourWD = true;
    input.override = null;
    camState.init = false;
  }
  function pause(on) {
    if (on && (S.mode === 'play' || S.mode === 'countdown')) { S.prevMode = S.mode; S.mode = 'pause'; showOnly('pause'); }
    else if (!on && S.mode === 'pause') { S.mode = S.prevMode; showOnly(null); }
  }
  function finish() {
    S.mode = 'finish'; S.running = false;
    audio.chime(true); flash();
    const t = S.time;
    const prev = S.best.trail;
    const isBest = !prev || t < prev;
    if (isBest) { S.best.trail = t; store.set('rr_best_trail', t); }
    const medal = MEDALS.find(m => t <= m[0]);
    $('medal').textContent = medal ? medal[1] : '🏁';
    $('finTitle').textContent = medal ? `${medal[2].toUpperCase()} MEDAL` : 'TRAIL COMPLETE';
    $('finTime').textContent = fmt(t);
    const target = MEDALS.filter(m => t > m[0]).pop();
    $('finSub').innerHTML = (isBest ? (prev ? `New best! (was ${fmt(prev)})` : 'First finish — that\'s your best time!') : `Best: ${fmt(prev)}`) +
      `<br>Recoveries used: ${S.resets}` + (target ? ` · ${target[2]} needs ${fmt(target[0])}` : '');
    setTimeout(() => { if (S.mode === 'finish') showOnly('finish'); }, 1200);
  }

  $('btnTrail').onclick = () => startGame('trail');
  $('btnFree').onclick = () => startGame('free');
  $('btnResume').onclick = () => pause(false);
  $('btnRestart').onclick = () => startGame(S.type);
  $('btnMenu').onclick = toMenu; $('btnMenu2').onclick = toMenu;
  $('btnAgain').onclick = () => startGame('trail');
  $('btnFreeAfter').onclick = () => startGame('free');
  $('btnNight').onclick = () => setNight(!S.night);
  $('btnQuality').onclick = () => { quality = quality === 'high' ? 'low' : 'high'; store.set('rr_quality', quality); applyQuality(); };
  $('btnFull').onclick = () => { const el = document.documentElement; try { (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen()).catch(() => {}); } catch (e) { /* not allowed */ } };
  document.querySelectorAll('.btn').forEach(b => b.addEventListener('pointerdown', () => { audio.init(); audio.click(); }));

  // ---------- day / night
  const dayCols = { top: new THREE.Color(0x3d7fd1), horizon: new THREE.Color(0xcfe3f0), ground: new THREE.Color(0x9fb3a8) };
  const nightCols = { top: new THREE.Color(0x02050d), horizon: new THREE.Color(0x0e1a2c), ground: new THREE.Color(0x05080c) };
  function setNight(on) {
    S.night = on;
    const c = on ? nightCols : dayCols;
    sky.uniforms.top.value.copy(c.top); sky.uniforms.horizon.value.copy(c.horizon); sky.uniforms.ground.value.copy(c.ground);
    sky.uniforms.sunColor.value.set(on ? 0x8899bb : 0xfff1d0);
    sky.uniforms.sunSize.value = on ? 0.6 : 1;
    scene.fog.color.copy(on ? new THREE.Color(0x0b1420) : fogDay);
    scene.fog.near = on ? 60 : 140; scene.fog.far = on ? 320 : 600;
    hemi.intensity = on ? 0.35 : 1.15;
    hemi.color.set(on ? 0x6f86b0 : 0xd6ecff);
    sun.intensity = on ? 0.45 : 2.9;
    sun.color.set(on ? 0x9fb4ff : 0xfff0d4);
    headL.forEach(h => (h.intensity = on ? 220 : 0));
    const ud = truck.userData;
    ud.lightMat.emissiveIntensity = on ? 3 : 0.6;
    ud.tail.emissiveIntensity = on ? 2 : 0.5;
    stars.material.opacity = on ? 0.9 : 0;
    sky.cloudMat.color.set(on ? 0x3a4458 : 0xffffff);
    particles.mat.uniforms.light.value = on ? 0.35 : 1;
    renderer.toneMappingExposure = on ? 1.25 : 1.0;
  }

  // ---------- camera
  const camState = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, orbitYaw: 0, orbitPitch: 0, dragT: 0, shake: 0, fov: 62, cineT: 0 };
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => { if (S.mode === 'play' || S.mode === 'countdown') { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camState.orbitYaw -= (e.clientX - lastX) * 0.006; camState.orbitPitch = clamp(camState.orbitPitch + (e.clientY - lastY) * 0.004, -0.3, 0.9);
    lastX = e.clientX; lastY = e.clientY; camState.dragT = 2.5;
  });
  let zoom = 1;
  canvas.addEventListener('wheel', (e) => { zoom = clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.6, 2.2); }, { passive: true });
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _look = new THREE.Vector3();
  function updateCamera(dt) {
    const p = phys.pos;
    const fwdFlat = _v.set(phys.fwd.x, 0, phys.fwd.z);
    if (fwdFlat.lengthSq() < 0.01) fwdFlat.set(0, 0, 1);
    const targetYaw = Math.atan2(fwdFlat.x, fwdFlat.z);
    if (!camState.init) { camState.yaw = targetYaw; }
    let dy = targetYaw - camState.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    camState.yaw += dy * Math.min(1, dt * (S.mode === 'menu' ? 1.2 : 3.2));
    if (camState.dragT > 0) camState.dragT -= dt; else { camState.orbitYaw *= Math.pow(0.08, dt); camState.orbitPitch *= Math.pow(0.08, dt); }
    let desired, look;
    const spd = Math.abs(phys.speed);
    if (S.mode === 'menu') {
      camState.cineT += dt * 0.12;
      const a = camState.cineT;
      const r = 13 + Math.sin(a * 0.7) * 3;
      desired = _w.set(p.x + Math.sin(a) * r, p.y + 4.5 + Math.sin(a * 1.3) * 1.5, p.z + Math.cos(a) * r);
      look = _look.copy(p).add(new THREE.Vector3(0, 0.8, 0));
    } else if (S.camMode === 2) { // hood cam
      desired = _w.copy(phys.up).multiplyScalar(1.55).addScaledVector(phys.fwd, 0.4).add(p);
      look = _look.copy(phys.fwd).multiplyScalar(20).addScaledVector(phys.up, 0.8).add(p);
      camState.pos.copy(desired); camState.look.copy(look);
    } else {
      const far = S.camMode === 1;
      const dist = (far ? 13 : 8.2) * zoom, height = (far ? 5.5 : 3.1) * zoom;
      const yaw = camState.yaw + camState.orbitYaw + Math.PI;
      const pitchAdd = camState.orbitPitch * dist;
      desired = _w.set(p.x + Math.sin(yaw) * dist, p.y + height + pitchAdd, p.z + Math.cos(yaw) * dist);
      look = _look.set(p.x, p.y + 1.1, p.z);
    }
    // keep above terrain
    const gh = T.heightAt(desired.x, desired.z);
    if (desired.y < gh + 1.2) desired.y = gh + 1.2;
    if (!camState.init) { camState.pos.copy(desired); camState.look.copy(look); camState.init = true; }
    const k = S.camMode === 2 && S.mode !== 'menu' ? 1 : 1 - Math.pow(0.0015, dt);
    camState.pos.lerp(desired, k);
    camState.look.lerp(look, Math.min(1, k * 1.6));
    camera.position.copy(camState.pos);
    // shake
    if (camState.shake > 0) {
      const s = camState.shake * 0.25;
      camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
      camState.shake = Math.max(0, camState.shake - dt * 2.5);
    }
    camera.lookAt(camState.look);
    const fovT = (S.camMode === 2 ? 72 : 60) + Math.min(14, spd * 0.4);
    camState.fov = lerp(camState.fov, fovT, Math.min(1, dt * 3));
    if (Math.abs(camera.fov - camState.fov) > 0.05) { camera.fov = camState.fov; camera.updateProjectionMatrix(); }
  }

  // ---------- minimap
  const mm = $('minimap'), mctx = mm.getContext('2d');
  const mapImg = document.createElement('canvas');
  const MAPRES = 320; mapImg.width = mapImg.height = MAPRES;
  {
    const g = mapImg.getContext('2d'), id = g.createImageData(MAPRES, MAPRES);
    const step = (HALF * 2) / MAPRES;
    for (let j = 0; j < MAPRES; j++) for (let i = 0; i < MAPRES; i++) {
      const x = -HALF + (i + 0.5) * step, z = -HALF + (j + 0.5) * step;
      const h = T.heightAt(x, z), o = (j * MAPRES + i) * 4;
      let r, gg, b;
      if (h < WATER) { r = 50; gg = 120; b = 170; }
      else { const v = clamp(h / 60, 0, 1); r = 70 + v * 90; gg = 110 + v * 70; b = 60 + v * 70; }
      const tr = T.trailAt(x, z);
      if (tr > 0.3) { r = 225; gg = 190; b = 130; }
      if (T.mudAt(x, z) > 0.4) { r = 95; gg = 66; b = 40; }
      id.data[o] = r; id.data[o + 1] = gg; id.data[o + 2] = b; id.data[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }
  function drawMinimap() {
    const W = mm.width, cx = W / 2;
    const viewR = 150; // meters radius shown
    const sc = (W / 2) / viewR; // px per meter
    mctx.save();
    mctx.fillStyle = '#20301c'; mctx.fillRect(0, 0, W, W);
    mctx.translate(cx, cx);
    const ang = -Math.PI / 2 - Math.atan2(phys.fwd.z, phys.fwd.x);
    mctx.rotate(ang);
    mctx.scale(sc, sc);
    mctx.translate(-phys.pos.x, -phys.pos.z);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(mapImg, -HALF, -HALF, HALF * 2, HALF * 2);
    if (S.type === 'trail') {
      for (let i = 0; i < cpCount; i++) {
        const c = gatesObj.gates[i].cp;
        const isNext = i === (S.next % cpCount) && S.mode !== 'menu';
        const done = S.splits.length >= i && i > 0 && i < S.next;
        mctx.beginPath(); mctx.arc(c.x, c.z, isNext ? 7 : 4.5, 0, Math.PI * 2);
        mctx.fillStyle = isNext ? '#ffd34d' : done ? '#5ad16b' : i === 0 ? '#ffffff' : '#ff7a1a';
        mctx.fill();
        if (isNext) { mctx.lineWidth = 2.5; mctx.strokeStyle = 'rgba(255,211,77,0.6)'; mctx.beginPath(); mctx.arc(c.x, c.z, 12 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2); mctx.stroke(); }
      }
    }
    mctx.restore();
    // truck marker (always center, pointing up)
    mctx.save(); mctx.translate(cx, cx);
    mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.moveTo(0, -14); mctx.lineTo(10, 11); mctx.lineTo(0, 6); mctx.lineTo(-10, 11); mctx.closePath(); mctx.stroke(); mctx.fill();
    mctx.restore();
  }

  // ---------- effects emission
  const colMud = new THREE.Color(0x4a3420), colMud2 = new THREE.Color(0x2d1f12), colDust = new THREE.Color(0xc8b08a), colWater = new THREE.Color(0xdfeff5), colSmoke = new THREE.Color(0x8a8a8a), colRock = new THREE.Color(0x9a9088);
  const _e = new THREE.Vector3(), _wf = new THREE.Vector3();
  let exhaustT = 0;
  function emitEffects(dt) {
    const spd = Math.abs(phys.speed);
    for (let i = 0; i < 4; i++) {
      const w = phys.wheels[i];
      if (!w.contact) continue;
      const p = w.point;
      _wf.copy(phys.fwd); if (w.front) _wf.applyAxisAngle(phys.up, phys.steer);
      const spinSpeed = Math.abs(w.spinVel * phys.R);
      // tracks
      if (!w.rock && w.water < 0.6) tracks.add(i, p, phys.right, w.normal, Math.min(1, w.load / 6000) * (0.6 + w.mud), w.mud > 0.3);
      // mud flinging
      if (w.mud > 0.25 && (spinSpeed > 2 || w.slip > 0.15)) {
        const n = Math.min(4, Math.floor(1 + w.slip * 2 + spinSpeed * 0.2));
        const dir = Math.sign(w.spinVel) || 1;
        for (let k = 0; k < n; k++) {
          const sp = 2 + Math.random() * 3 + w.slip * 3;
          particles.emit(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.2, p.z + (Math.random() - 0.5) * 0.4,
            -_wf.x * dir * sp + (Math.random() - 0.5) * 2, 2 + Math.random() * 4 + w.slip * 1.5, -_wf.z * dir * sp + (Math.random() - 0.5) * 2,
            Math.random() < 0.5 ? colMud : colMud2, 0.18 + Math.random() * 0.22, 1.0 + Math.random() * 0.6, 1, 0, 1);
        }
      } else if (w.water > 0.15 && spd > 1.2) {
        const n = Math.min(5, Math.floor(spd * 0.5));
        for (let k = 0; k < n; k++) {
          particles.emit(p.x + (Math.random() - 0.5) * 0.6, WATER + 0.05, p.z + (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 3 + phys.vel.x * 0.3 + phys.right.x * (i % 2 ? 1 : -1) * -2, 2 + Math.random() * spd * 0.4, (Math.random() - 0.5) * 3 + phys.vel.z * 0.3 + phys.right.z * (i % 2 ? 1 : -1) * -2,
            colWater, 0.14 + Math.random() * 0.18, 0.6 + Math.random() * 0.5, 1, 0.3, 0.85);
        }
      } else if (!w.rock && w.mud < 0.1 && w.water < 0.05 && (spd > 7 || (w.slip > 0.3 && spinSpeed > 3)) && Math.random() < 0.45) {
        particles.emit(p.x, p.y + 0.3, p.z, phys.vel.x * 0.15 + (Math.random() - 0.5), 0.6 + Math.random(), phys.vel.z * 0.15 + (Math.random() - 0.5),
          colDust, 0.8 + Math.random() * 0.6, 1.4 + Math.random(), -0.02, 2.4, 0.22);
      } else if (w.rock && w.slip > 0.4 && Math.random() < 0.3) {
        particles.emit(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, colRock, 0.08, 0.6, 1, 0, 1);
      }
    }
    // big splash on water entry
    if (phys.inWater > 0.05 && spd > 4 && Math.random() < 0.6) {
      for (let k = 0; k < 6; k++) particles.emit(phys.pos.x + phys.fwd.x * 2.4 + (Math.random() - 0.5) * 2, WATER + 0.1, phys.pos.z + phys.fwd.z * 2.4 + (Math.random() - 0.5) * 2,
        phys.vel.x * 0.5 + (Math.random() - 0.5) * 5, 3 + Math.random() * 4, phys.vel.z * 0.5 + (Math.random() - 0.5) * 5, colWater, 0.25 + Math.random() * 0.25, 0.9, 1, 0.5, 0.8);
    }
    // exhaust
    exhaustT -= dt;
    if (exhaustT <= 0 && S.mode !== 'finish') {
      exhaustT = 0.12 - phys.engineLoad * 0.08;
      const ex = _e.copy(truck.userData.exhaust).applyQuaternion(phys.quat).add(phys.pos);
      particles.emit(ex.x, ex.y, ex.z, -phys.fwd.x * 1.5 + phys.vel.x * 0.8, 0.5, -phys.fwd.z * 1.5 + phys.vel.z * 0.8, colSmoke, 0.25, 1.0, -0.05, 1.0 + phys.engineLoad, 0.18 + phys.engineLoad * 0.25);
    }
  }

  // ---------- the truck gets muddy in bogs and rinses clean in water
  let dirt = 0;
  const paintBase = new THREE.Color(), mudTint = new THREE.Color(0x4a3524);
  function updateDirt(dt) {
    const slip = phys.wheels.reduce((a, w) => a + (w.mud > 0.2 ? Math.min(1, w.slip + Math.abs(w.spinVel) * 0.03) : 0), 0) / 4;
    dirt = clamp(dirt + slip * dt * 0.25 - phys.waterAmt * dt * 0.35 - phys.inWater * dt * 0.5, 0, 1);
    paintBase.setHex(paint);
    truck.userData.paint.color.copy(paintBase).lerp(mudTint, dirt * 0.7);
  }

  // ---------- HUD
  const susEls = [0, 1, 2, 3].map(i => $('s' + i));
  const hudOrder = [1, 0, 3, 2]; // display: front-left, front-right, rear-left, rear-right (screen-wise)
  let lastCountNum = null;
  function updateHud() {
    const kmh = Math.abs(phys.speed) * 3.6;
    $('speed').textContent = Math.round(kmh);
    $('chip4wd').classList.toggle('on', phys.fourWD);
    $('chip4wd').textContent = phys.fourWD ? '4WD' : '2WD';
    $('chipLo').classList.toggle('on', phys.lowRange);
    $('chipLo').textContent = phys.lowRange ? 'LOW' : 'HIGH';
    const pitch = Math.asin(clamp(phys.fwd.y, -1, 1)) * 180 / Math.PI;
    const roll = Math.asin(clamp(phys.right.y, -1, 1)) * 180 / Math.PI;
    $('pitchIcon').style.transform = `rotate(${-pitch}deg)`;
    $('rollIcon').style.transform = `rotate(${roll}deg)`;
    $('pitchVal').textContent = `${Math.round(Math.abs(pitch))}°`; $('pitchVal').classList.toggle('warn', Math.abs(pitch) > 30);
    $('rollVal').textContent = `${Math.round(Math.abs(roll))}°`; $('rollVal').classList.toggle('warn', Math.abs(roll) > 28);
    hudOrder.forEach((wi, k) => { susEls[k].style.height = `${clamp(phys.wheels[wi].comp / phys.restLen, 0, 1) * 100}%`; });
    if (S.type === 'trail') {
      $('timer').textContent = fmt(S.time);
      const ni = S.next % cpCount;
      const c = gatesObj.gates[ni].cp;
      $('cpNum').textContent = S.next >= cpCount ? 'FINISH' : `${S.next}/${cpCount - 1}`;
      $('cpName').textContent = CP_LABELS[ni];
      $('cpDist').textContent = `${Math.round(Math.hypot(c.x - phys.pos.x, c.z - phys.pos.z))} m`;
    }
    drawMinimap();
  }

  // ---------- gates/arrow animation
  function updateGates(t) {
    const ni = S.next % cpCount;
    const show = S.type === 'trail' && S.mode !== 'menu';
    const g = gatesObj.gates[ni];
    gatesObj.beam.visible = gatesObj.ring.visible = show && S.mode !== 'finish';
    if (show) {
      gatesObj.beam.position.set(g.cp.x, g.cp.y + 55, g.cp.z);
      gatesObj.ring.position.set(g.cp.x, g.cp.y + 0.3, g.cp.z);
      gatesObj.beamMat.opacity = 0.16 + Math.sin(t * 3) * 0.06;
      const s = 1 + Math.sin(t * 4) * 0.06; gatesObj.ring.scale.set(s, 1, s);
    }
    gatesObj.gates.forEach((gt, i) => {
      const passed = S.type === 'trail' && i > 0 && i < S.next && S.mode !== 'menu';
      gt.bannerMat.emissiveIntensity = (show && i === ni) ? 0.5 + Math.sin(t * 5) * 0.2 : passed ? 0.02 : 0.15;
      gt.bannerMat.color.set(passed ? 0x77aa77 : 0xffffff);
    });
    arrow.visible = show && S.mode === 'play';
    if (arrow.visible) {
      arrow.position.set(phys.pos.x, phys.pos.y + 3.4 + Math.sin(t * 3) * 0.12, phys.pos.z);
      const a = Math.atan2(g.cp.x - phys.pos.x, g.cp.z - phys.pos.z);
      arrow.rotation.set(0, a, 0);
      const d = Math.hypot(g.cp.x - phys.pos.x, g.cp.z - phys.pos.z);
      arrow.scale.setScalar(d < 25 ? Math.max(0.01, (d - 8) / 17) : 1);
    }
  }

  // ---------- gameplay logic per frame
  function gameplay(dt) {
    phys.updateAxes();
    if (S.mode === 'play' && S.type === 'trail') {
      S.time += dt;
      const ni = S.next % cpCount;
      const c = gatesObj.gates[ni].cp;
      if (Math.hypot(c.x - phys.pos.x, c.z - phys.pos.z) < 9.5 && Math.abs(c.y - phys.pos.y) < 8) {
        S.splits.push(S.time);
        S.lastCp = ni;
        if (S.next >= cpCount) { finish(); return; }
        audio.chime(false);
        toast(`${CP_LABELS[ni].toUpperCase()}<small>Checkpoint ${S.next}/${cpCount - 1} · ${fmt(S.time)}</small>`, 2);
        S.next++;
      }
    }
    if (S.mode !== 'play') return;
    // flipped detection
    if (phys.up.y < 0.35 && Math.abs(phys.speed) < 2.5) S.upsideT += dt; else S.upsideT = 0;
    if (S.upsideT > 1.5 && !S.hintsShown.flip) { hint('Flipped? Press <kbd>R</kbd> to recover', 4); S.hintsShown.flip = 1; setTimeout(() => (S.hintsShown.flip = 0), 8000); }
    // stuck hints
    if (S.lastInp && S.lastInp.throttle > 0 && Math.abs(phys.speed) < 1.5 && phys.contacts > 0) S.stuckT += dt; else S.stuckT = 0;
    if (S.stuckT > 2) {
      if (!phys.fourWD && !S.hintsShown.fwd) { hint('Wheels spinning? Engage 4WD with <kbd>F</kbd>', 5); S.hintsShown.fwd = 1; }
      else if (phys.fwd.y > 0.2 && !phys.lowRange && !S.hintsShown.low) { hint('Steep climb — try low range <kbd>L</kbd>', 5); S.hintsShown.low = 1; }
      else if (S.stuckT > 5 && !S.hintsShown.stuck) { hint('Truly stuck? Rock it with <kbd>S</kbd> / <kbd>W</kbd>, or press <kbd>R</kbd>', 5); S.hintsShown.stuck = 1; setTimeout(() => (S.hintsShown.stuck = 0), 15000); }
    }
    if (phys.inWater > 0.85 && Math.abs(phys.speed) < 1) { S.drownT = (S.drownT || 0) + dt; if (S.drownT > 3) { S.drownT = 0; recover(true); hint('Too deep! Recovered to last checkpoint', 3); } } else S.drownT = 0;
  }

  function recover(toCheckpoint) {
    S.resets++;
    const now = performance.now() / 1000;
    if (toCheckpoint || now - S.lastResetT < 2.5) {
      placeAtCp(S.type === 'trail' ? S.lastCp : 0);
      if (S.type === 'trail' && S.lastCp === 0) placeAtCp(0);
      toast('RECOVERED<small>Back to last checkpoint</small>', 1.4);
    } else {
      const yaw = Math.atan2(phys.fwd.x, phys.fwd.z);
      const fwdOk = Math.abs(phys.fwd.y) < 0.9;
      const h = fwdOk ? yaw : camState.yaw;
      phys.reset(phys.pos.x, phys.pos.z, h);
      phys.pos.y += 0.8;
      toast('RECOVERED<small>Press R twice quickly for last checkpoint</small>', 1.6);
    }
    S.lastResetT = now;
    tracks.clear();
  }

  // ---------- actions
  function handleActions() {
    if (input.take('pause')) { if (S.mode === 'pause') pause(false); else if (S.mode === 'play' || S.mode === 'countdown') pause(true); else if (S.mode === 'finish') toMenu(); }
    if (input.take('mute')) { audio.init(); audio.setMuted(!audio.muted); toast(audio.muted ? 'SOUND OFF' : 'SOUND ON', 1); }
    if (input.take('night')) { setNight(!S.night); toast(S.night ? 'NIGHT DRIVE<small>Headlights on</small>' : 'DAYTIME', 1.4); }
    if (input.take('help')) $('keysPanel').classList.toggle('hidden');
    if (S.mode !== 'play' && S.mode !== 'countdown') { input.clearActions(); return; }
    if (input.take('fourwd')) { phys.fourWD = !phys.fourWD; audio.click(); toast(phys.fourWD ? '4WD ENGAGED<small>Power to all four wheels</small>' : '2WD<small>Rear-wheel drive</small>', 1.4); }
    if (input.take('low')) { phys.lowRange = !phys.lowRange; audio.click(); toast(phys.lowRange ? 'LOW RANGE<small>Max torque, low speed — for crawling</small>' : 'HIGH RANGE', 1.4); }
    if (input.take('camera')) { S.camMode = (S.camMode + 1) % 3; camState.init = false; toast(['CHASE CAM', 'FAR CAM', 'HOOD CAM'][S.camMode], 1); }
    if (input.take('reset') && S.mode === 'play') recover(false);
  }

  // ---------- main loop
  let lastNow = performance.now();
  const clock = { getDelta() { const n = performance.now(), d = (n - lastNow) / 1000; lastNow = n; return d; } };
  let acc = 0, simTime = 0;
  const STEP = 1 / 120;
  const idleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  let fpsAcc = 0, fpsN = 0;
  window.__perf = { fps: 0 };

  function frame() {
    requestAnimationFrame(frame);
    let dt = Math.min(clock.getDelta(), 0.05);
    simTime += dt;
    handleActions();
    // countdown
    if (S.mode === 'countdown') {
      S.countdown -= dt;
      const n = Math.ceil(S.countdown);
      const el = $('countdown');
      if (S.type === 'trail') {
        if (n !== lastCountNum && n > 0 && n <= 3) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); audio.beep(false); lastCountNum = n; }
      }
      if (S.countdown <= 0) {
        S.mode = 'play'; S.running = true;
        if (S.type === 'trail') { el.textContent = 'GO!'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); audio.beep(true); setTimeout(() => { if ($('countdown').textContent === 'GO!') $('countdown').textContent = ''; }, 800); }
      }
    }
    let inp = idleInput;
    if (S.mode === 'play') inp = input.read(dt);
    else if (S.mode === 'menu') inp = bot.drive(dt);
    else if (S.mode === 'finish') inp = { throttle: 0, brake: 0.6, steer: 0, handbrake: false };
    else input.read(dt);
    S.lastInp = inp;
    const physOn = S.mode !== 'pause';
    if (physOn) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 8) { phys.step(STEP, inp); acc -= STEP; steps++; }
      if (steps === 8) acc = 0;
    }
    if (S.mode === 'menu') {
      // keep attract mode going forever
      phys.updateAxes();
      if (phys.up.y < 0.3 || Math.abs(phys.speed) < 0.3) { S.menuStuck = (S.menuStuck || 0) + dt; if (S.menuStuck > 4) { S.menuStuck = 0; const ci = Math.floor(Math.random() * cpCount); placeAtCp(ci); bot.resetTo(ci); camState.init = false; } } else S.menuStuck = 0;
    }
    gameplay(physOn ? dt : 0);
    // feedback
    if (phys.landing > 0) { camState.shake = Math.max(camState.shake, phys.landing * 0.9); audio.thud(phys.landing); phys.landing = 0; }
    if (phys.impacts > 0.15) { camState.shake = Math.max(camState.shake, phys.impacts * 0.8); audio.thud(phys.impacts * 0.8); }
    phys.impacts = 0;
    if (phys.treeHit > 0) { camState.shake = Math.max(camState.shake, phys.treeHit); audio.thud(phys.treeHit); phys.treeHit = 0; }

    syncTruckModel(truck, phys);
    if (physOn) { emitEffects(dt); particles.update(dt, T); updateDirt(dt); }
    tracks.update(dt);
    water.update(simTime);
    updateGates(simTime);
    // sun follows truck for crisp shadows
    sun.position.copy(phys.pos).addScaledVector(sunDir, 120);
    sun.target.position.copy(phys.pos);
    terrainLod.update(camera.position, scene.fog.far + 40);
    for (const pm of props) { const bs = pm.boundingSphere; pm.visible = bs.center.distanceTo(camera.position) - bs.radius < scene.fog.far; }
    sky.sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    sky.uniforms.sunDir.value.copy(sunDir);
    updateCamera(dt);
    particles.mat.uniforms.fogColor.value.copy(scene.fog.color);
    particles.mat.uniforms.fogNear.value = scene.fog.near; particles.mat.uniforms.fogFar.value = scene.fog.far;
    particles.mat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)) * 0.5;
    // audio
    const spd = Math.abs(phys.speed);
    const top = phys.lowRange ? 13 : 36;
    const wheelSpd = Math.max(...phys.wheels.map(w => Math.abs(w.spinVel * phys.R)));
    const ratio = clamp(Math.max(spd, wheelSpd * 0.8) / top, 0, 1.2);
    const gears = phys.lowRange ? 2 : 4;
    const gpos = ratio * gears, gfrac = gpos - Math.floor(Math.min(gpos, gears - 0.001));
    const rpm = 850 + (Math.min(gpos, gears) >= 1 ? 0.35 + gfrac * 0.65 : gfrac) * 4600 + phys.engineLoad * 300;
    audio.update({ on: S.mode !== 'pause', rpm, load: phys.engineLoad, speed: spd, mud: phys.mudAmt, spin: Math.max(1, wheelSpd), water: phys.waterAmt, ground: phys.contacts / 4 });
    if (S.mode !== 'menu') updateHud();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) $('hint').classList.remove('show'); }
    renderer.render(scene, camera);
    fpsAcc += dt; fpsN++; if (fpsAcc > 1) { window.__perf.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  }

  setLoad(100, 'Ready!');
  toMenu();
  $('loading').classList.add('hidden');
  frame();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); clock.getDelta(); });

  // ---------- test hooks
  window.__game = {
    T, phys, S, input, camera, renderer, scene,
    start: startGame, toMenu, setNight, recover,
    setInput(o) { input.override = o ? { throttle: 0, brake: 0, steer: 0, handbrake: false, ...o } : null; },
    press(a) { input.pressed.add(a); },
    teleportCp(i) { placeAtCp(i); camState.init = false; },
    // advance the simulation quickly without waiting for frames (for automated tests)
    advance(sec, o) {
      const inp = o ? { throttle: 0, brake: 0, steer: 0, handbrake: false, ...o } : idleInput;
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) {
        phys.step(STEP, inp);
        if (i % 4 === 3) { const d = STEP * 4; S.lastInp = inp; gameplay(d); emitEffects(d); particles.update(d, T); updateCamera(d); }
      }
      syncTruckModel(truck, phys);
    },
    botDrive(sec) {
      const b = makeBot(T, phys); b.resetTo(Math.max(0, (S.next - 1) % cpCount));
      const n = Math.round(sec / STEP);
      for (let i = 0; i < n; i++) {
        const inp = b.drive(STEP);
        phys.step(STEP, inp);
        if (i % 4 === 3) { const d = STEP * 4; S.lastInp = inp; gameplay(d); emitEffects(d); particles.update(d, T); updateCamera(d); }
      }
      syncTruckModel(truck, phys);
    },
    info() { return { mode: S.mode, next: S.next, time: S.time, speed: phys.speed, pos: phys.pos.toArray(), up: phys.up.toArray(), fourWD: phys.fourWD, low: phys.lowRange, contacts: phys.contacts, fps: window.__perf.fps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  };
}

boot().catch(e => { console.error(e); const m = document.getElementById('loadMsg'); if (m) m.textContent = 'Error: ' + e.message; });

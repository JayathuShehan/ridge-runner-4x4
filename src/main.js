import * as THREE from 'three';
import { Terrain, COURSE, CP_LABELS, HALF, WATER } from './terrain.js';
import { TruckPhysics } from './vehicle.js';
import { buildRealTruck, syncRealTruck } from './truckModel.js';
import { buildEnvironment } from './env.js';
import { buildTerrain } from './terrainRender.js';
import { buildVegetation } from './vegetation.js';
import { buildGrass } from './grass.js';
import { buildRocks, buildWater } from './rocks.js';
import { buildGates, buildArrow } from './gates.js';
import { buildPost } from './post.js';
import { Particles, Tracks } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { makeBot } from './bot.js';
import { clamp, lerp } from './noise.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
const fmt = (t) => { if (t == null || !isFinite(t)) return '—'; t = Math.round(t * 10) / 10; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const tick = () => new Promise(r => setTimeout(r, 20));
const PAINTS = [0x2f4fb8, 0xe9e9e6, 0x15171a, 0x4b5a35, 0x9e1b1b, 0xc8b48a, 0xe0661c, 0x4d6c7a];
const MEDALS = [[150, '🥇', 'Gold'], [195, '🥈', 'Silver'], [260, '🥉', 'Bronze']];
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const QUALITIES = ['low', 'medium', 'high'];

async function boot() {
  const warnings = [];
  window.__stage = 'start';
  const setLoad = (p, msg) => { $('loadBar').style.width = `${p}%`; if (msg) { $('loadMsg').textContent = msg; window.__stage = msg; } };
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { $('loadMsg').textContent = 'WebGL is not available in this browser.'; return; }
  const params = new URLSearchParams(location.search);
  let quality = params.get('q') || store.get('rr2_quality', isTouch ? 'low' : 'high');
  if (!QUALITIES.includes(quality)) quality = 'high';
  const usePost = params.get('post') !== '0';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = usePost ? THREE.NoToneMapping : THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 1.5) : quality === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 3500);

  // ---------- textures
  setLoad(4, 'Loading textures…');
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = {};
  const missing = [];
  // The artifact host only allows images from blob:/data: URLs, so fetch each file and hand three.js a blob URL.
  const load = (key, url, srgb) => {
    const t = new THREE.Texture();
    manager.itemStart(url);
    fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.blob(); })
      .then(b => new Promise((res, rej) => { const img = new Image(); const u = URL.createObjectURL(b); img.onload = () => { res(img); }; img.onerror = rej; img.src = u; }))
      .then(img => { t.image = img; t.needsUpdate = true; manager.itemEnd(url); })
      .catch(e => { console.warn('texture failed', url, e); missing.push(url); manager.itemError(url); manager.itemEnd(url); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, aniso);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    tex[key] = t;
  };
  for (const k of ['grass', 'forest', 'rock', 'trail', 'mud', 'boulder']) { load(`${k}_col`, `assets/${k}_col.jpg`, true); load(`${k}_nor`, `assets/${k}_nor.jpg`, false); }
  load('waternormals', 'assets/waternormals.jpg', false);
  load('pine_bark', 'assets/ez/pine_color_1k.jpg', true); load('pine_bark_n', 'assets/ez/pine_normal_1k.jpg', false);
  load('oak_bark', 'assets/ez/oak_color_1k.jpg', true); load('oak_bark_n', 'assets/ez/oak_normal_1k.jpg', false);
  for (const l of ['pine', 'oak', 'ash', 'aspen']) load(`${l}_leaf`, `assets/ez/${l}_color.png`, true);
  for (const k of ['pine_bark', 'oak_bark']) tex[k].repeat.set(1, 1);
  await new Promise((res) => { manager.onLoad = res; manager.onProgress = (u, a, b) => setLoad(4 + (a / b) * 30, 'Loading textures…'); manager.onError = () => {}; setTimeout(res, 30000); });

  // ---------- environment
  setLoad(36, 'Lighting the sky…'); await tick();
  const envReady = new Promise(res => { window.__envRes = res; });
  const env = buildEnvironment(renderer, scene, 'assets/env.json', () => window.__envRes());
  await envReady;

  // ---------- world
  setLoad(44, 'Shaping the valley…'); await tick();
  const T = new Terrain(11);
  setLoad(54, 'Painting the ground…'); await tick();
  const terrain = buildTerrain(T, scene, tex);
  const water = buildWater(scene, tex);
  setLoad(62, 'Placing rocks…'); await tick();
  const safe = (name, fn, fallback) => { try { return fn(); } catch (e) { console.error(name, e); warnings.push(name); return fallback; } };
  const rocks = safe('rocks', () => buildRocks(T, scene, tex), { meshes: [], stoneCount: 0 });
  setLoad(70, 'Growing the forest…'); await tick();
  const veg = safe('trees', () => buildVegetation(T, scene, renderer, tex, quality), { uniforms: { uTime: { value: 0 } }, refresh() {}, tris: [], bushTris: [] });
  setLoad(84, 'Planting grass…'); await tick();
  const grass = safe('grass', () => buildGrass(T, scene, quality), { update() {} });
  const gatesObj = buildGates(T, scene);
  const arrow = buildArrow(scene);
  arrow.visible = false;
  // stars
  const starGeo = new THREE.BufferGeometry();
  { const arr = new Float32Array(2000 * 3); let s = 5; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 2000; i++) { const u = r(), a = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u); arr.set([Math.cos(a) * rr * 2500, u * 2500 + 40, Math.sin(a) * rr * 2500], i * 3); } starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(stars);

  // ---------- truck
  setLoad(90, 'Building your truck…'); await tick();
  const phys = new TruckPhysics(T);
  let paint = store.get('rr2_paint', PAINTS[0]);
  const truck = buildRealTruck(paint);
  scene.add(truck);
  const headL = truck.userData.headPos.map(p => {
    const sl = new THREE.SpotLight(0xfff0d8, 0, 120, 0.5, 0.45, 1.2);
    sl.position.copy(p); sl.target.position.set(p.x * 1.5, -1.5, 18);
    truck.add(sl, sl.target);
    return sl;
  });
  const particles = new Particles(scene, 2500);
  const tracks = new Tracks(scene, 6000);
  const audio = new GameAudio();
  const input = new Input();
  input.bindTouch($('hud'));
  if (isTouch) input.bindWheel($('wheel'));
  let post = usePost ? safe('post-processing', () => buildPost(renderer, scene, camera, quality), null) : null;
  if (!post) renderer.toneMapping = THREE.AgXToneMapping;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (post) post.setSize(w, h);
  }
  addEventListener('resize', resize); resize();

  // ---------- state
  const S = { mode: 'menu', type: 'trail', next: 1, time: 0, countdown: 0, lastCp: 0, camMode: 0, night: false, lights: false, resets: 0, splits: [], lastResetT: -10, upsideT: 0, hintsShown: {}, stuckT: 0, unit: store.get('rr2_unit', 'kmh'), best: store.get('rr2_best', null) };
  let bot = makeBot(T, phys);
  const cpCount = COURSE.length;
  const placeAtCp = (i) => { const c = T.checkpoint(i); phys.reset(c.x - c.tx * 5, c.z - c.tz * 5, Math.atan2(c.tx, c.tz)); tracks.clear(); };

  let toastT = 0, hintT = 0;
  const toast = (html, dur = 1.6) => { const el = $('toast'); el.innerHTML = html; el.classList.add('show'); toastT = dur; };
  const hint = (html, dur = 4) => { const el = $('hint'); el.innerHTML = html; el.classList.add('show'); hintT = dur; };
  const showOnly = (id) => { for (const o of ['menu', 'pause', 'finish']) $(o).classList.toggle('hidden', o !== id); };

  // paint swatches
  const sw = $('swatches');
  PAINTS.forEach(p => {
    const d = document.createElement('div'); d.className = 'sw' + (p === paint ? ' sel' : ''); d.style.background = '#' + p.toString(16).padStart(6, '0');
    d.addEventListener('click', () => { paint = p; store.set('rr2_paint', p); truck.userData.paint.color.setHex(p); sw.querySelectorAll('.sw').forEach(e => e.classList.remove('sel')); d.classList.add('sel'); audio.init(); audio.click(); });
    sw.appendChild(d);
  });
  const updateMenuBest = () => { $('menuBest').textContent = S.best ? `Best ${fmt(S.best)} · 13 checkpoints` : '13 checkpoints · beat the clock'; };
  updateMenuBest();
  $('btnQuality').textContent = `Graphics: ${quality[0].toUpperCase() + quality.slice(1)}`;

  // ---------- modes
  let lastCountNum = null;
  function startGame(type) {
    audio.init();
    Object.assign(S, { type, mode: 'countdown', countdown: type === 'trail' ? 3.2 : 0.01, time: 0, next: 1, lastCp: 0, resets: 0, splits: [], upsideT: 0, stuckT: 0 });
    phys.fourWD = true; phys.lowRange = false; dirt.v = 0;
    placeAtCp(0);
    input.override = null; input.clearActions();
    showOnly(null);
    $('hud').classList.remove('hidden');
    $('trailBox').classList.toggle('hidden', type !== 'trail');
    document.body.classList.toggle('touch', isTouch);
    S.camMode = 0; cam.init = false; lastCountNum = null;
    gatesObj.gates.forEach(g => (g.group.visible = type === 'trail'));
    $('keys').classList.remove('hidden'); clearTimeout(S.keysT); S.keysT = setTimeout(() => $('keys').classList.add('hidden'), 15000);
    if (type === 'free') toast('FREE ROAM<small>Explore the valley · Esc for menu</small>', 3);
  }
  function toMenu() {
    S.mode = 'menu';
    $('hud').classList.add('hidden');
    showOnly('menu'); updateMenuBest();
    placeAtCp(0); bot = makeBot(T, phys); bot.resetTo(0);
    phys.fourWD = true; phys.lowRange = false;
    input.override = null; cam.init = false;
    gatesObj.gates.forEach(g => (g.group.visible = true));
  }
  function pause(on) {
    if (on && (S.mode === 'play' || S.mode === 'countdown')) { S.prevMode = S.mode; S.mode = 'pause'; showOnly('pause'); }
    else if (!on && S.mode === 'pause') { S.mode = S.prevMode; showOnly(null); }
  }
  function finish() {
    S.mode = 'finish';
    audio.chime(true);
    const t = S.time, prev = S.best, isBest = !prev || t < prev;
    if (isBest) { S.best = t; store.set('rr2_best', t); }
    const medal = MEDALS.find(m => t <= m[0]);
    $('medal').textContent = medal ? medal[1] : '🏁';
    $('finTitle').textContent = medal ? `${medal[2].toUpperCase()} MEDAL` : 'TRAIL COMPLETE';
    $('finTime').textContent = fmt(t);
    const target = MEDALS.filter(m => t > m[0]).pop();
    $('finSub').innerHTML = (isBest ? (prev ? `New best! (was ${fmt(prev)})` : 'First finish — that\'s your best time!') : `Best: ${fmt(prev)}`) + `<br>Recoveries used: ${S.resets}` + (target ? ` · ${target[2]} needs ${fmt(target[0])}` : '');
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
  $('btnQuality').onclick = () => { const q = QUALITIES[(QUALITIES.indexOf(quality) + 1) % 3]; store.set('rr2_quality', q); $('btnQuality').textContent = 'Reloading…'; setTimeout(() => location.reload(), 100); };
  $('btnFull').onclick = () => { try { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); } catch (e) { /* not allowed */ } };
  $('speedUnit').onclick = () => { S.unit = S.unit === 'kmh' ? 'mph' : 'kmh'; store.set('rr2_unit', S.unit); };
  document.querySelectorAll('.btn').forEach(b => b.addEventListener('pointerdown', () => { audio.init(); audio.click(); }));

  // ---------- lights / night
  function setLights(on) {
    S.lights = on;
    headL.forEach(h => (h.intensity = on ? (S.night ? 260 : 120) : 0));
    const m = truck.userData.mats;
    m.head.emissiveIntensity = on ? 6 : 0.25;
    m.ledbar.emissiveIntensity = on && S.night ? 6 : 0;
    m.tail.emissiveIntensity = on ? 1.6 : 0.35;
    $('btnLights').classList.toggle('on', on);
  }
  function setNight(on) {
    S.night = on;
    env.setNight(on);
    if (post) post.setNight(on);
    stars.material.opacity = on ? 0.85 : 0;
    particles.mat.uniforms.light.value = on ? 0.25 : 1;
    setLights(on);
  }

  // ---------- camera
  const cam = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, orbitYaw: 0, orbitPitch: 0, dragT: 0, shake: 0, fov: 55, cine: 0 };
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => { if (S.mode === 'play' || S.mode === 'countdown') { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
  addEventListener('pointerup', () => (dragging = false));
  addEventListener('pointermove', (e) => { if (!dragging) return; cam.orbitYaw -= (e.clientX - lastX) * 0.006; cam.orbitPitch = clamp(cam.orbitPitch + (e.clientY - lastY) * 0.004, -0.25, 0.9); lastX = e.clientX; lastY = e.clientY; cam.dragT = 2.5; });
  let zoom = 1;
  canvas.addEventListener('wheel', (e) => { zoom = clamp(zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.6, 2.2); }, { passive: true });
  const _w = new THREE.Vector3(), _l = new THREE.Vector3();
  function updateCamera(dt) {
    const p = phys.pos;
    const targetYaw = Math.atan2(phys.fwd.x, phys.fwd.z);
    if (!cam.init) cam.yaw = targetYaw;
    let dy = targetYaw - cam.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    cam.yaw += dy * Math.min(1, dt * 2.6);
    if (cam.dragT > 0) cam.dragT -= dt; else { cam.orbitYaw *= Math.pow(0.1, dt); cam.orbitPitch *= Math.pow(0.1, dt); }
    let desired, look, snap = false;
    if (S.mode === 'menu') {
      cam.cine += dt * 0.09;
      const a = cam.cine, r = 7.5 + Math.sin(a * 0.6) * 1.5;
      desired = _w.set(p.x + Math.sin(a) * r, p.y + 1.2 + Math.sin(a * 1.3) * 0.6, p.z + Math.cos(a) * r);
      look = _l.set(p.x, p.y + 0.5, p.z);
    } else if (S.camMode === 2) {
      desired = _w.copy(phys.up).multiplyScalar(0.98).addScaledVector(phys.right, -0.38).addScaledVector(phys.fwd, -0.45).add(p);
      look = _l.copy(phys.fwd).multiplyScalar(20).addScaledVector(phys.up, 0.6).add(p);
      snap = true;
    } else {
      const far = S.camMode === 1;
      const dist = (far ? 11 : 6.6) * zoom, height = (far ? 4.2 : 2.25) * zoom;
      const yaw = cam.yaw + cam.orbitYaw + Math.PI + (far ? 0 : 0.18);
      desired = _w.set(p.x + Math.sin(yaw) * dist, p.y + height + cam.orbitPitch * dist, p.z + Math.cos(yaw) * dist);
      look = _l.set(p.x, p.y + 0.9, p.z).addScaledVector(phys.fwd, 1.5);
    }
    const gh = T.heightAt(desired.x, desired.z);
    if (desired.y < gh + 0.9) desired.y = gh + 0.9;
    if (!cam.init) { cam.pos.copy(desired); cam.look.copy(look); cam.init = true; }
    const k = snap ? 1 : 1 - Math.pow(0.002, dt);
    cam.pos.lerp(desired, k); cam.look.lerp(look, Math.min(1, k * 1.5));
    camera.position.copy(cam.pos);
    if (cam.shake > 0) { const s = cam.shake * 0.12; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; cam.shake = Math.max(0, cam.shake - dt * 2.5); }
    camera.lookAt(cam.look);
    if (snap) camera.up.copy(phys.up); else camera.up.set(0, 1, 0);
    const fovT = (S.camMode === 2 ? 68 : 55) + Math.min(10, Math.abs(phys.speed) * 0.3);
    cam.fov = lerp(cam.fov, fovT, Math.min(1, dt * 3));
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  // ---------- minimap (light road-map style)
  const mm = $('minimap'), mctx = mm.getContext('2d');
  const mapImg = document.createElement('canvas'); const MR = 320; mapImg.width = mapImg.height = MR;
  {
    const g = mapImg.getContext('2d'), id = g.createImageData(MR, MR), st = (HALF * 2) / MR;
    for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
      const x = -HALF + (i + 0.5) * st, z = -HALF + (j + 0.5) * st, h = T.heightAt(x, z), o = (j * MR + i) * 4;
      let c = [214, 218, 210];
      const f = T.forestAt(x, z); c = [214 - f * 30, 218 - f * 18, 210 - f * 30];
      c = c.map(v => v - Math.min(30, Math.max(0, h - 10) * 0.6));
      if (h < WATER) c = [150, 184, 204];
      if (T.mudAt(x, z) > 0.4) c = [160, 140, 115];
      id.data.set([c[0], c[1], c[2], 255], o);
    }
    g.putImageData(id, 0, 0);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
    T.trailPts.forEach(([x, z], k) => { const px = (x + HALF) / st, pz = (z + HALF) / st; k ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.closePath(); g.stroke();
    g.strokeStyle = '#7b8279'; g.lineWidth = 2; g.stroke();
  }
  function drawMinimap() {
    const W = mm.width, cx = W / 2, viewR = 130, sc = (W / 2) / viewR;
    mctx.save(); mctx.fillStyle = '#c9cdc7'; mctx.fillRect(0, 0, W, W);
    mctx.translate(cx, cx); mctx.rotate(-Math.PI / 2 - Math.atan2(phys.fwd.z, phys.fwd.x)); mctx.scale(sc, sc); mctx.translate(-phys.pos.x, -phys.pos.z);
    mctx.drawImage(mapImg, -HALF, -HALF, HALF * 2, HALF * 2);
    if (S.type === 'trail' && S.mode !== 'menu') for (let i = 0; i < cpCount; i++) {
      const c = gatesObj.gates[i].cp, isNext = i === S.next % cpCount, done = i > 0 && i < S.next;
      mctx.beginPath(); mctx.arc(c.x, c.z, isNext ? 6 : 3.5, 0, Math.PI * 2);
      mctx.fillStyle = isNext ? '#ffb000' : done ? '#3ddc84' : i === 0 ? '#111' : '#e55'; mctx.fill();
    }
    mctx.restore();
    mctx.save(); mctx.translate(cx, cx); mctx.fillStyle = '#1e88ff'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(10, 10); mctx.lineTo(0, 5); mctx.lineTo(-10, 10); mctx.closePath(); mctx.stroke(); mctx.fill(); mctx.restore();
  }

  // ---------- effects
  const C = (h) => new THREE.Color(h);
  const colMud = C(0x3a2a1a), colMud2 = C(0x251a10), colDust = C(0xb8a68a), colWater = C(0xdfe9e6), colSmoke = C(0x7a7a7a), colRock = C(0x8f8a80);
  const _e = new THREE.Vector3(), _wf = new THREE.Vector3();
  let exhaustT = 0;
  function emitEffects(dt) {
    const spd = Math.abs(phys.speed);
    for (let i = 0; i < 4; i++) {
      const w = phys.wheels[i]; if (!w.contact) continue;
      const p = w.point; _wf.copy(phys.fwd); if (w.front) _wf.applyAxisAngle(phys.up, phys.steer);
      const spin = Math.abs(w.spinVel * phys.R);
      if (!w.rock && w.water < 0.6) tracks.add(i, p, phys.right, w.normal, Math.min(1, w.load / 6000) * (0.55 + w.mud), w.mud > 0.3);
      if (w.mud > 0.25 && (spin > 2 || w.slip > 0.15)) {
        const n = Math.min(5, Math.floor(1 + w.slip * 2 + spin * 0.25)), dir = Math.sign(w.spinVel) || 1;
        for (let k = 0; k < n; k++) { const sp = 2 + Math.random() * 3 + w.slip * 3; particles.emit(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.15, p.z + (Math.random() - 0.5) * 0.4, -_wf.x * dir * sp + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 4 + w.slip * 1.5, -_wf.z * dir * sp + (Math.random() - 0.5) * 2, Math.random() < 0.5 ? colMud : colMud2, 0.09 + Math.random() * 0.13, 1.0 + Math.random() * 0.6, 1, 0, 1); }
      } else if (w.water > 0.15 && spd > 1.2) {
        const n = Math.min(6, Math.floor(spd * 0.6));
        for (let k = 0; k < n; k++) particles.emit(p.x + (Math.random() - 0.5) * 0.6, WATER + 0.05, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 3 + phys.vel.x * 0.3, 1.5 + Math.random() * spd * 0.35, (Math.random() - 0.5) * 3 + phys.vel.z * 0.3, colWater, 0.07 + Math.random() * 0.12, 0.6 + Math.random() * 0.5, 1, 0.25, 0.7);
      } else if (!w.rock && w.mud < 0.1 && w.water < 0.05 && (spd > 6 || (w.slip > 0.3 && spin > 3)) && Math.random() < 0.4) {
        particles.emit(p.x, p.y + 0.25, p.z, phys.vel.x * 0.12 + (Math.random() - 0.5), 0.5 + Math.random(), phys.vel.z * 0.12 + (Math.random() - 0.5), colDust, 0.7 + Math.random() * 0.6, 1.6 + Math.random(), -0.02, 2.6, 0.16);
      } else if (w.rock && w.slip > 0.4 && Math.random() < 0.3) {
        particles.emit(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, colRock, 0.05, 0.6, 1, 0, 1);
      }
    }
    if (phys.inWater > 0.05 && spd > 3.5 && Math.random() < 0.6) for (let k = 0; k < 6; k++) particles.emit(phys.pos.x + phys.fwd.x * 2.6 + (Math.random() - 0.5) * 2, WATER + 0.1, phys.pos.z + phys.fwd.z * 2.6 + (Math.random() - 0.5) * 2, phys.vel.x * 0.5 + (Math.random() - 0.5) * 5, 2.5 + Math.random() * 4, phys.vel.z * 0.5 + (Math.random() - 0.5) * 5, colWater, 0.12 + Math.random() * 0.2, 0.9, 1, 0.4, 0.75);
    exhaustT -= dt;
    if (exhaustT <= 0) {
      exhaustT = 0.1 - phys.engineLoad * 0.06;
      const ex = _e.set(-0.62, -0.43, -2.4).applyQuaternion(phys.quat).add(phys.pos);
      particles.emit(ex.x, ex.y, ex.z, -phys.fwd.x * 1.2 + phys.vel.x * 0.8, 0.35, -phys.fwd.z * 1.2 + phys.vel.z * 0.8, colSmoke, 0.18, 1.0, -0.05, 0.9 + phys.engineLoad, 0.1 + phys.engineLoad * 0.2);
    }
  }
  const dirt = { v: 0 };
  function updateDirt(dt) {
    const slip = phys.wheels.reduce((a, w) => a + (w.mud > 0.2 ? Math.min(1, w.slip + Math.abs(w.spinVel) * 0.03) : 0), 0) / 4;
    dirt.v = clamp(dirt.v + slip * dt * 0.22 + (phys.mudAmt > 0.2 ? dt * 0.03 : 0) - phys.waterAmt * dt * 0.3 - phys.inWater * dt * 0.5, 0, 1);
    truck.userData.dirt.value = dirt.v;
  }

  // ---------- HUD
  function updateHud() {
    const v = Math.abs(phys.speed) * (S.unit === 'kmh' ? 3.6 : 2.237);
    $('speedNum').textContent = String(Math.round(v)).padStart(3, '0');
    $('speedUnit').textContent = S.unit === 'kmh' ? 'KM/H' : 'MPH';
    $('chip4wd').classList.toggle('on', phys.fourWD); $('chip4wd').textContent = phys.fourWD ? '4WD' : '2WD';
    $('chipLo').classList.toggle('on', phys.lowRange);
    $('btn4wd').classList.toggle('on', phys.fourWD); $('btnLow').classList.toggle('on', phys.lowRange);
    const g = S.lastInp && S.lastInp.brake > 0 && phys.speed < 0.5 ? 'R' : Math.abs(phys.speed) < 0.3 && !(S.lastInp && S.lastInp.throttle) ? 'N' : 'D';
    $('chipGear').textContent = g; $('chipGear').classList.toggle('on', g === 'R');
    if (S.type === 'trail') {
      $('timer').textContent = fmt(S.time);
      const ni = S.next % cpCount, c = gatesObj.gates[ni].cp;
      $('cpNum').textContent = S.next >= cpCount ? 'FINISH' : `${S.next}/${cpCount - 1}`;
      $('cpName').textContent = CP_LABELS[ni];
      $('cpDist').textContent = `${Math.round(Math.hypot(c.x - phys.pos.x, c.z - phys.pos.z))} m`;
    }
    drawMinimap();
    if (isTouch) document.querySelectorAll('.pedal').forEach(p => p.classList.toggle('on', !!input.touch[p.dataset.touch]));
  }
  function updateGates(t) {
    const ni = S.next % cpCount, show = S.type === 'trail' && S.mode !== 'menu' && S.mode !== 'finish';
    const g = gatesObj.gates[ni];
    gatesObj.beam.visible = gatesObj.ring.visible = show;
    if (show) {
      gatesObj.beam.position.set(g.cp.x, g.cp.y + 55, g.cp.z); gatesObj.ring.position.set(g.cp.x, g.cp.y + 0.3, g.cp.z);
      gatesObj.beamMat.opacity = 0.08 + Math.sin(t * 3) * 0.03;
      const s = 1 + Math.sin(t * 4) * 0.05; gatesObj.ring.scale.set(s, 1, s);
    }
    gatesObj.gates.forEach((gt, i) => { const passed = S.type === 'trail' && i > 0 && i < S.next && S.mode !== 'menu'; gt.bannerMat.emissiveIntensity = (show && i === ni) ? 0.35 + Math.sin(t * 5) * 0.15 : 0.03; gt.bannerMat.color.set(passed ? 0x88aa88 : 0xffffff); });
  }

  // ---------- gameplay
  function gameplay(dt) {
    phys.updateAxes();
    if (S.mode === 'play' && S.type === 'trail') {
      S.time += dt;
      const ni = S.next % cpCount, c = gatesObj.gates[ni].cp;
      if (Math.hypot(c.x - phys.pos.x, c.z - phys.pos.z) < 9.5 && Math.abs(c.y - phys.pos.y) < 8) {
        S.splits.push(S.time); S.lastCp = ni;
        if (S.next >= cpCount) { finish(); return; }
        audio.chime(false);
        toast(`${CP_LABELS[ni].toUpperCase()}<small>Checkpoint ${S.next}/${cpCount - 1} · ${fmt(S.time)}</small>`, 2);
        S.next++;
      }
    }
    if (S.mode !== 'play') return;
    if (phys.up.y < 0.35 && Math.abs(phys.speed) < 2.5) S.upsideT += dt; else S.upsideT = 0;
    if (S.upsideT > 1.5 && !S.hintsShown.flip) { hint(isTouch ? 'Rolled over? Tap the recover button ↻' : 'Rolled over? Press <kbd>R</kbd> to recover', 4); S.hintsShown.flip = 1; setTimeout(() => (S.hintsShown.flip = 0), 8000); }
    if (S.lastInp && S.lastInp.throttle > 0 && Math.abs(phys.speed) < 1.5 && phys.contacts > 0) S.stuckT += dt; else S.stuckT = 0;
    if (S.stuckT > 2) {
      if (!phys.fourWD && !S.hintsShown.fwd) { hint('Wheels spinning? Engage 4WD (<kbd>F</kbd>)', 5); S.hintsShown.fwd = 1; }
      else if (phys.fwd.y > 0.2 && !phys.lowRange && !S.hintsShown.low) { hint('Steep climb — use low range (<kbd>L</kbd>)', 5); S.hintsShown.low = 1; }
      else if (S.stuckT > 5 && !S.hintsShown.stuck) { hint('Stuck? Rock it back and forth, or recover (<kbd>R</kbd>)', 5); S.hintsShown.stuck = 1; setTimeout(() => (S.hintsShown.stuck = 0), 15000); }
    }
    if (phys.inWater > 0.85 && Math.abs(phys.speed) < 1) { S.drownT = (S.drownT || 0) + dt; if (S.drownT > 3) { S.drownT = 0; recover(true); hint('Too deep! Recovered to last checkpoint', 3); } } else S.drownT = 0;
  }
  function recover(toCp) {
    S.resets++;
    const now = performance.now() / 1000;
    if (toCp || now - S.lastResetT < 2.5) { placeAtCp(S.type === 'trail' ? S.lastCp : 0); toast('RECOVERED<small>Back to last checkpoint</small>', 1.4); }
    else { const yaw = Math.abs(phys.fwd.y) < 0.9 ? Math.atan2(phys.fwd.x, phys.fwd.z) : cam.yaw; phys.reset(phys.pos.x, phys.pos.z, yaw); phys.pos.y += 0.6; toast('RECOVERED<small>Recover twice quickly for last checkpoint</small>', 1.6); }
    S.lastResetT = now; tracks.clear();
  }
  function handleActions() {
    if (input.take('pause')) { if (S.mode === 'pause') pause(false); else if (S.mode === 'play' || S.mode === 'countdown') pause(true); else if (S.mode === 'finish') toMenu(); }
    if (input.take('mute')) { audio.init(); audio.setMuted(!audio.muted); toast(audio.muted ? 'SOUND OFF' : 'SOUND ON', 1); }
    if (input.take('night')) { setNight(!S.night); toast(S.night ? 'NIGHT<small>Headlights on</small>' : 'DAY', 1.4); }
    if (input.take('help')) $('keys').classList.toggle('hidden');
    if (S.mode !== 'play' && S.mode !== 'countdown') { input.clearActions(); return; }
    if (input.take('lights')) { setLights(!S.lights); toast(S.lights ? 'HEADLIGHTS ON' : 'HEADLIGHTS OFF', 1); }
    if (input.take('fourwd')) { phys.fourWD = !phys.fourWD; audio.click(); toast(phys.fourWD ? '4WD ENGAGED<small>Power to all four wheels</small>' : '2WD<small>Rear-wheel drive</small>', 1.4); }
    if (input.take('low')) { phys.lowRange = !phys.lowRange; audio.click(); toast(phys.lowRange ? 'LOW RANGE<small>Max torque for crawling</small>' : 'HIGH RANGE', 1.4); }
    if (input.take('camera')) { S.camMode = (S.camMode + 1) % 3; cam.init = false; toast(['CHASE CAM', 'WIDE CAM', 'DRIVER CAM'][S.camMode], 1); }
    if (input.take('reset') && S.mode === 'play') recover(false);
  }

  // ---------- loop
  let lastNow = performance.now(), acc = 0, simT = 0;
  const STEP = 1 / 120, idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  let fpsAcc = 0, fpsN = 0; window.__perf = { fps: 0 };
  let frameErrs = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(); const dt = Math.min((now - lastNow) / 1000, 0.05); lastNow = now;
    try { tickOnce(dt, true); } catch (e) {
      frameErrs++; console.error(e);
      if (frameErrs === 1) showError(e, 'while running');
      if (post && frameErrs === 3) { post = null; renderer.toneMapping = THREE.AgXToneMapping; }  // fall back to plain rendering
    }
  }
  function tickOnce(dt, doRender) {
    simT += dt;
    handleActions();
    if (S.mode === 'countdown') {
      S.countdown -= dt;
      const n = Math.ceil(S.countdown), el = $('countdown');
      if (S.type === 'trail' && n !== lastCountNum && n > 0 && n <= 3) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); audio.beep(false); lastCountNum = n; }
      if (S.countdown <= 0) { S.mode = 'play'; if (S.type === 'trail') { el.textContent = 'GO!'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); audio.beep(true); setTimeout(() => { if (el.textContent === 'GO!') el.textContent = ''; }, 800); } }
    }
    let inp = idle;
    if (S.mode === 'play') inp = input.read(dt);
    else if (S.mode === 'menu') inp = bot.drive(dt);
    else if (S.mode === 'finish') inp = { throttle: 0, brake: 0.6, steer: 0, handbrake: false };
    else input.read(dt);
    S.lastInp = inp;
    const physOn = S.mode !== 'pause';
    if (physOn) { acc += dt; let n = 0; while (acc >= STEP && n < 8) { phys.step(STEP, inp); acc -= STEP; n++; } if (n === 8) acc = 0; }
    if (S.mode === 'menu') { phys.updateAxes(); if (phys.up.y < 0.3 || Math.abs(phys.speed) < 0.3) { S.menuStuck = (S.menuStuck || 0) + dt; if (S.menuStuck > 5) { S.menuStuck = 0; const ci = Math.floor(Math.random() * cpCount); placeAtCp(ci); bot.resetTo(ci); cam.init = false; } } else S.menuStuck = 0; }
    gameplay(physOn ? dt : 0);
    if (phys.landing > 0) { cam.shake = Math.max(cam.shake, phys.landing); audio.thud(phys.landing); phys.landing = 0; }
    if (phys.impacts > 0.15) { cam.shake = Math.max(cam.shake, phys.impacts * 0.8); audio.thud(phys.impacts * 0.8); }
    phys.impacts = 0;
    if (phys.treeHit > 0) { cam.shake = Math.max(cam.shake, phys.treeHit); audio.thud(phys.treeHit); phys.treeHit = 0; }
    if (doRender) renderWorld(dt, inp, physOn); else { syncRealTruck(truck, phys); updateCamera(dt); }
    const spd = Math.abs(phys.speed), top = phys.lowRange ? 13 : 36;
    const wheelSpd = Math.max(...phys.wheels.map(w => Math.abs(w.spinVel * phys.R)));
    const ratio = clamp(Math.max(spd, wheelSpd * 0.8) / top, 0, 1.2), gears = phys.lowRange ? 2 : 5, gp = ratio * gears, gf = gp - Math.floor(Math.min(gp, gears - 0.001));
    audio.update({ on: S.mode !== 'pause', rpm: 800 + (Math.min(gp, gears) >= 1 ? 0.35 + gf * 0.65 : gf) * 4200 + phys.engineLoad * 300, load: phys.engineLoad, speed: spd, mud: phys.mudAmt, spin: Math.max(1, wheelSpd), water: phys.waterAmt, ground: phys.contacts / 4 });
    if (S.mode !== 'menu') updateHud();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) $('hint').classList.remove('show'); }
    fpsAcc += dt; fpsN++; if (fpsAcc > 1) { window.__perf.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  }
  function renderWorld(dt, inp, physOn) {
    syncRealTruck(truck, phys);
    // brake / reverse lights
    const m = truck.userData.mats;
    const braking = inp.brake > 0 && phys.speed > 0.5 || inp.handbrake;
    m.tail.emissiveIntensity = braking ? 5 : S.lights ? 1.6 : 0.35;
    m.reverse.emissiveIntensity = inp.brake > 0 && phys.speed < 0.3 ? 4 : 0;
    if (physOn) { emitEffects(dt); particles.update(dt, T); updateDirt(dt); }
    tracks.update(dt);
    water.update(simT);
    updateGates(simT);
    env.follow(phys.pos);
    updateCamera(dt);
    terrain.update(camera.position, 700, quality === 'low' ? 80 : 115);
    veg.refresh(camera.position);
    veg.uniforms.uTime.value = simT;
    grass.update(camera.position, simT, { x: phys.pos.x, z: phys.pos.z, w: phys.contacts > 0 ? 1 : 0 });
    for (const rm of rocks.meshes) { const bs = rm.boundingSphere; rm.visible = bs.center.distanceTo(camera.position) - bs.radius < 450; }
    stars.position.copy(camera.position);
    particles.mat.uniforms.fogColor.value.copy(scene.fog.color);
    particles.mat.uniforms.fogNear.value = 40; particles.mat.uniforms.fogFar.value = 500;
    particles.mat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)) * 0.5;
    if (post) post.render(dt); else renderer.render(scene, camera);
  }

  if (missing.length || warnings.length) console.warn('Loaded with issues', missing, warnings);
  setLoad(100, 'Ready!');
  toMenu();
  // warm up shaders / first frame
  renderWorld(0.016, idle, false);
  $('loading').classList.add('hidden');
  const manual = params.get('manual') === '1';
  if (!manual) frame();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); lastNow = performance.now(); });

  // ---------- test hooks
  window.__game = {
    T, phys, S, input, camera, renderer, scene, veg, rocks,
    start: startGame, toMenu, setNight, setLights, recover,
    setInput(o) { input.override = o ? { throttle: 0, brake: 0, steer: 0, handbrake: false, ...o } : null; },
    teleportCp(i) { placeAtCp(i); cam.init = false; },
    advance(sec, o) { const inp = o ? { ...idle, ...o } : idle; const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { phys.step(STEP, inp); if (i % 4 === 3) { const d = STEP * 4; S.lastInp = inp; gameplay(d); emitEffects(d); particles.update(d, T); updateDirt(d); updateCamera(d); } } syncRealTruck(truck, phys); },
    botDrive(sec) { const b = makeBot(T, phys); b.resetTo(Math.max(0, (S.next - 1) % cpCount)); const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { const inp = b.drive(STEP); phys.step(STEP, inp); if (i % 4 === 3) { const d = STEP * 4; S.lastInp = inp; gameplay(d); emitEffects(d); particles.update(d, T); updateDirt(d); updateCamera(d); } } syncRealTruck(truck, phys); },
    tick(dt = 1 / 30, n = 1, render = false) { for (let i = 0; i < n; i++) tickOnce(dt, render); },
    renderOnce(dt = 0.016) { const t0 = performance.now(); handleActions(); renderWorld(dt, S.lastInp || idle, false); if (S.mode !== 'menu') updateHud(); if (renderer.getContext().finish) renderer.getContext().finish(); return performance.now() - t0; },
    setCam(m) { S.camMode = m; cam.init = false; },
    setDirt(v) { dirt.v = v; truck.userData.dirt.value = v; },
    info() { return { mode: S.mode, next: S.next, time: S.time, speed: phys.speed, pos: phys.pos.toArray(), up: phys.up.toArray(), fourWD: phys.fourWD, low: phys.lowRange, contacts: phys.contacts, fps: window.__perf.fps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, quality }; },
  };
}

function showError(e, when) {
  let el = document.getElementById('errBox');
  if (!el) { el = document.createElement('div'); el.id = 'errBox'; el.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:99;background:rgba(120,10,10,0.9);color:#fff;font:12px/1.4 monospace;padding:10px 12px;border-radius:8px;white-space:pre-wrap;max-height:40vh;overflow:auto;pointer-events:auto'; el.onclick = () => el.remove(); document.body.appendChild(el); }
  const stack = (e && e.stack ? e.stack : String(e)).split('\n').slice(0, 6).join('\n');
  el.textContent = `Error ${when} (step: ${window.__stage || '?'}) — tap to dismiss\n${stack}`;
}
window.addEventListener('error', (ev) => { if (ev.error) showError(ev.error, 'uncaught'); });
boot().catch(e => { console.error(e); const m = document.getElementById('loadMsg'); if (m) m.textContent = 'Error: ' + e.message; showError(e, 'while loading'); });

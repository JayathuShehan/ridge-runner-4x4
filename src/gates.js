// Checkpoint gates + navigation arrow
import * as THREE from 'three';
import { COURSE, CP_LABELS } from './terrain.js';

function bannerTexture(text, sub, finish) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128;
  const g = cv.getContext('2d');
  if (finish) {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 32, j * 32, 32, 32); }
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(250, 14, 524, 100);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ff8a1f'); gr.addColorStop(1, '#e2541b');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 128);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 1024; i += 64) g.fillRect(i, 0, 32, 10), g.fillRect(i + 32, 118, 32, 10);
  }
  g.fillStyle = '#fff'; g.font = 'bold 72px system-ui, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 60);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildGates(T, scene) {
  const gates = [];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4b2e, roughness: 0.85 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffc533, roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < COURSE.length; i++) {
    const cp = T.checkpoint(i);
    const g = new THREE.Group();
    g.position.set(cp.x, 0, cp.z);
    g.rotation.y = Math.atan2(cp.tx, cp.tz);
    const W = 6.5;
    const ys = [];
    for (const sx of [-W, W]) {
      // local +x in group == world direction rotated; find ground height at the post
      const wx = cp.x + Math.cos(g.rotation.y) * sx, wz = cp.z - Math.sin(g.rotation.y) * sx;
      const gy = T.heightAt(wx, wz);
      ys.push(gy);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.5, 8), postMat);
      post.position.set(sx, gy + 2.75 - 0.3, 0); post.castShadow = true; g.add(post);
      for (let k = 0; k < 3; k++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.45, 8), stripe); st.position.set(sx, gy + 0.6 + k * 1.5, 0); g.add(st); }
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), flagMat);
      flag.position.set(sx + Math.sign(sx) * 0.48, gy + 5.0, 0); g.add(flag);
    }
    const top = Math.max(...ys) + 5.2;
    const label = i === 0 ? 'FINISH' : `${i} · ${CP_LABELS[i].toUpperCase()}`;
    const tex = bannerTexture(label, '', i === 0);
    const bm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.05 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.6, 1.5, 0.12), [postMat, postMat, postMat, postMat, bm, bm]);
    banner.position.set(0, top, 0); banner.castShadow = true; g.add(banner);
    // flip the back face texture so it reads correctly from behind
    scene.add(g);
    gates.push({ group: g, cp, banner, bannerMat: bm });
  }
  // beacon beam + ground ring for next checkpoint
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 120, 24, 1, true), beamMat);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.18, 8, 48).rotateX(Math.PI / 2), ringMat);
  scene.add(beam, ring);
  return { gates, beam, ring, beamMat, ringMat };
}

// arrow above the truck pointing at the next checkpoint
export function buildArrow(scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffa500, emissiveIntensity: 0.6, roughness: 0.4 });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.9), mat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 1.0).translate(0, 0, 0), mat);
  head.scale.y = 0.4;
  g.add(head, tail);
  scene.add(g);
  return g;
}

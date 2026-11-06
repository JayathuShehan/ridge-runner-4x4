// Sky, sun, image-based lighting, fog
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export function buildEnvironment(renderer, scene, hdrUrl, onReady) {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  scene.add(sky);
  const sunDir = new THREE.Vector3();
  const setSun = (elevDeg, azDeg) => {
    const phi = THREE.MathUtils.degToRad(90 - elevDeg), th = THREE.MathUtils.degToRad(azDeg);
    sunDir.setFromSphericalCoords(1, phi, th);
    u.sunPosition.value.copy(sunDir);
  };
  setSun(38, 215);
  const lightDir = sunDir.clone();
  const moonDir = new THREE.Vector3(-0.35, 0.8, 0.45).normalize();

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x3b4a28, 0.25);
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(0xb9c9cf, 0.0032);
  const pm = new THREE.PMREMGenerator(renderer);
  // HDR sky stored as half-float RGBA in JSON (served as a plain file)
  fetch(hdrUrl).then(r => r.json()).then(({ w, h, data }) => {
    const bin = atob(data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const tex = new THREE.DataTexture(new Uint16Array(u8.buffer), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    scene.environment = pm.fromEquirectangular(tex).texture;
    scene.environmentIntensity = 0.75;
    tex.dispose(); pm.dispose();
    onReady && onReady();
  }).catch(() => onReady && onReady());

  return {
    sky, sun, hemi, sunDir, setSun,
    follow(target) {
      sun.position.copy(target).addScaledVector(lightDir, 160);
      sun.target.position.copy(target);
      // snap shadow camera to texel grid to avoid shimmering
      sun.target.updateMatrixWorld();
    },
    setNight(on) {
      if (on) {
        setSun(-8, 215);
        u.turbidity.value = 1; u.rayleigh.value = 0.2;
        sun.intensity = 0.28; sun.color.set(0x9db3ff);
        lightDir.copy(moonDir);
        hemi.intensity = 0.06;
        scene.environmentIntensity = 0.06;
        scene.fog.color.set(0x070b12); scene.fog.density = 0.006;
      } else {
        setSun(38, 215); lightDir.copy(sunDir);
        u.turbidity.value = 4.5; u.rayleigh.value = 1.4;
        sun.intensity = 3.4; sun.color.set(0xfff1dc);
        hemi.intensity = 0.25;
        scene.environmentIntensity = 0.75;
        scene.fog.color.set(0xb9c9cf); scene.fog.density = 0.0032;
      }
    },
  };
}

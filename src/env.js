// Sky, sun, image-based lighting, fog
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export function buildEnvironment(renderer, scene, hdrUrl, onReady, quality = 'high') {
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
  // shadow cost scales with map size: low 1024 over 70 m, medium 1536 over 90 m, high 2048 over 90 m
  const SH = quality === 'low' ? { size: 1024, ext: 35 } : quality === 'medium' ? { size: 1536, ext: 45 } : { size: 2048, ext: 45 };
  sun.shadow.mapSize.set(SH.size, SH.size);
  const sc = sun.shadow.camera; sc.left = -SH.ext; sc.right = SH.ext; sc.top = SH.ext; sc.bottom = -SH.ext; sc.near = 1; sc.far = 400;
  const texel = (2 * SH.ext) / SH.size, _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _snap = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
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
      // snap the shadow camera to the shadow-map texel grid (in light space) so shadows don't crawl/shimmer as the truck moves
      _lx.crossVectors(_up, lightDir).normalize(); _ly.crossVectors(lightDir, _lx);
      const px = Math.round(target.dot(_lx) / texel) * texel, py = Math.round(target.dot(_ly) / texel) * texel, pz = target.dot(lightDir);
      _snap.set(0, 0, 0).addScaledVector(_lx, px).addScaledVector(_ly, py).addScaledVector(lightDir, pz);
      sun.position.copy(_snap).addScaledVector(lightDir, 160);
      sun.target.position.copy(_snap);
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

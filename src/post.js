// Post-processing: ambient occlusion, bloom, filmic tone mapping, colour grade, vignette, SMAA
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export function buildPost(renderer, scene, camera, quality) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (quality !== 'low') {
    ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.6;
    ao.configuration.halfRes = false; // half-res mode is incompatible with this three.js version (crashes in setupRenderTarget)
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
    composer.addPass(ao);
  }
  const bloom = new BloomEffect({ luminanceThreshold: 0.92, luminanceSmoothing: 0.2, intensity: 0.85, mipmapBlur: true, radius: 0.7 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
  const hs = new HueSaturationEffect({ saturation: 0.12 });
  const vig = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  const effects = [bloom, tone, bc, hs, vig];
  if (quality !== 'low') effects.push(new SMAAEffect());
  composer.addPass(new EffectPass(camera, ...effects));
  return {
    composer, ao, bloom, tone,
    setSize(w, h) { composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
    setNight(on) { bloom.intensity = on ? 1.6 : 0.85; bloom.luminanceMaterial.threshold = on ? 0.6 : 0.92; },
  };
}

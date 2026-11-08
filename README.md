# Ridge Runner 4x4 — Trail Edition

A realistic off-road 4x4 driving game that runs in the browser, built with three.js.

**Play:** https://thinukalehan.github.io/ridge-runner-4x4/  ·  original stylised v1: https://thinukalehan.github.io/ridge-runner-4x4/v1/

- Forest trail with 13 checkpoints: whoops, mud pits, a summit climb, river ford, rock garden, jumps and a bog
- Custom vehicle physics: raycast suspension with articulating solid axles, friction-circle tyres, per-surface grip, real 4WD / low-range behaviour
- Detailed procedural off-roader, photo-textured PBR terrain, ez-tree forests with billboard LODs, GPU grass, HDR lighting, ambient occlusion, bloom
- Physically-modelled V8 engine sound synthesised live (cylinders, valves, header/exhaust/muffler waveguides, dual exhaust), driven by a 5-speed automatic + torque-converter model: starter, idle lope, shifts, kickdown, low-range flare, wheelspin revs, overrun pops, drivetrain whine, cabin vs. chase-cam perspective
- Garage (main menu): 11 vehicles in categories — the procedural trail rigs (Ridge Runner, Scout, Titan) plus eight realistic 3D models (Rubicon 4-door off-roader, Cougar 6x6 armoured truck, Challenger ’70, GT300 race car, MP4/5 F1 car, NASA's Mars Rover, Milk Float, Street Concept). Every vehicle can be tuned (suspension travel, tyre size, tyre grip, width) with a live turntable preview; settings are saved per vehicle
- Realistic models have their own wheelbase, springs, gearing, steering, body collision box and cameras; six-wheelers (Cougar, Rover) animate the middle axle too. Models stream in on demand when picked
- Day / night with working headlights, mud that builds up on the truck and washes off in water
- Keyboard, gamepad, and touch (steering wheel + pedals)

## Controls
WASD / arrows drive · Space handbrake · F 4WD · L low range · R recover (twice = last checkpoint) · C camera · N night · M mute · Esc pause

## Develop
```bash
npm install
npm run build          # bundles src/ into docs/ (served by GitHub Pages)
npm run test:physics   # headless physics + autopilot course test
npm run test:vehicles  # browser test: every realistic model loads, drives and can be picked/tuned in the garage (serve docs/ on :8767)
```
Serve `docs/` with any static server (e.g. `python3 -m http.server -d docs`) and open it in a browser.

## Performance
- Press **F3** (or open with `?perf=1`) for an overlay: fps, frame time, CPU time split (tick / physics / render submit), draw calls, triangles, resolution and render scale.
- **Dynamic resolution** (menu checkbox, on by default) lowers the render scale (down to 60%) when frames run long and raises it again when there is headroom.
- The truck and camera are drawn interpolated between 120 Hz physics steps, so motion is smooth at any display refresh rate.
- Shadow map size/range scale with the graphics level (Low also updates shadows every 2nd frame), and the shadow camera is snapped to the texel grid so shadows don't shimmer.

## Layout
- `src/` — game source (physics, vehicle model, terrain, vegetation, grass, rocks, post-processing, UI)
- `src/garage.js` — vehicle roster, modification ranges and the maths that turns a setup into physics/model parameters
- `src/vehicles3d.js` — specs of the realistic models (pure data); `src/modelVehicle.js` loads and builds them
- `assets/vehicles/` — converted models (json + bin + webp), `assets/thumbs/` — garage thumbnails
- `tools/convertVehicle.mjs` — glTF → game vehicle converter (wheel detection, simplification, texture re-encode)
- `src/engine/` — engine sound synthesis (runs in an AudioWorklet, bundled to `docs/engine-worklet.js`); `makeV8.mjs` regenerates the V8 configuration
- `assets/` — textures (CC0) used by the build
- `docs/` — built site published by GitHub Pages (`docs/v1/` is the original stylised version)
- `v1/` — source of the original stylised version
- `test/` — physics and browser tests

See `THIRD_PARTY_NOTICES.md` for asset and library credits.

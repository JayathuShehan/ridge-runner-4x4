# Ridge Runner 4x4 — Trail Edition

A realistic off-road 4x4 driving game that runs in the browser, built with three.js.

**Play:** https://thinukalehan.github.io/ridge-runner-4x4/  ·  original stylised v1: https://thinukalehan.github.io/ridge-runner-4x4/v1/

- Forest trail with 13 checkpoints: whoops, mud pits, a summit climb, river ford, rock garden, jumps and a bog
- Custom vehicle physics: raycast suspension with articulating solid axles, friction-circle tyres, per-surface grip, real 4WD / low-range behaviour
- Detailed procedural off-roader, photo-textured PBR terrain, ez-tree forests with billboard LODs, GPU grass, HDR lighting, ambient occlusion, bloom
- Day / night with working headlights, mud that builds up on the truck and washes off in water
- Keyboard, gamepad, and touch (steering wheel + pedals)

## Controls
WASD / arrows drive · Space handbrake · F 4WD · L low range · R recover (twice = last checkpoint) · C camera · N night · M mute · Esc pause

## Develop
```bash
npm install
npm run build          # bundles src/ into docs/ (served by GitHub Pages)
npm run test:physics   # headless physics + autopilot course test
```
Serve `docs/` with any static server (e.g. `python3 -m http.server -d docs`) and open it in a browser.

## Layout
- `src/` — game source (physics, vehicle model, terrain, vegetation, grass, rocks, post-processing, UI)
- `assets/` — textures (CC0) used by the build
- `docs/` — built site published by GitHub Pages (`docs/v1/` is the original stylised version)
- `v1/` — source of the original stylised version
- `test/` — physics and browser tests

See `THIRD_PARTY_NOTICES.md` for asset and library credits.

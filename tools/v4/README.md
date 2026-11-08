# Ridge Runner v4 — realistic vehicles build tools

`docs/v4/` is a self-contained build of the v4 preview: 15 vehicles in total, including 6 converted from real glTF models, plus a vehicle-select screen with categories.

It was produced by patching the minified v3 build. It does not come from `src/`, so the main game and the PR #1 garage are untouched. These scripts let it be reproduced.

| file | what it does |
|---|---|
| `convert.mjs` | Converts a source GLB into the game's vehicle format: `<id>.json`, a base64 `<id>.bin.txt` and `<id>_N.webp` textures. It simplifies the mesh to a triangle budget, detects the wheels, splits them into parts and resizes the textures. |
| `patch_v4.py` | Patches the v3 `game.js` into v4. It adds glTF alpha modes, visual-only 5th and 6th wheels, the new vehicle specs, categories, and the `window.__rrGarage` hook. |
| `vehicles_v4.js` | The six new vehicle specs (physics, hull, paint and credits). `patch_v4.py` injects them. |
| `../../docs/v4/vehicle-select.js` | The vehicle-select grid (All / Off-road / Trucks / Road & race / Specials). |

## Re-converting a model

```bash
npm i @gltf-transform/core@4.5 @gltf-transform/extensions@4.5 @gltf-transform/functions@4.5 draco3dgltf meshoptimizer sharp gl-matrix
mkdir dl && cd dl
B=https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models
curl -LO $B/vehicles/jeep-wrangler-rubicon.glb -LO $B/vehicles/toyota-supra-gt300.glb -LO $B/vehicles/mclaren-mp4-5.glb \
     -LO $B/blendswap/dodge-challenger.glb -LO $B/nasa-m2020/Perseverance.glb
curl -L -o GroundVehicle.glb https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb
cd ..
RR_DL=$PWD/dl node tools/v4/convert.mjs jeep docs/v4/assets/vehicles
```

Running this for jeep, challenger, rover, supra and mclaren reproduces the committed `.json` and `.bin.txt` files byte for byte. This was checked with sha256.

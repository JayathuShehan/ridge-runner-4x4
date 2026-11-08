// Realistic glTF vehicles for the garage. Pure data (no three.js) so the headless physics tests can use it.
// Each entry is turned into a normal garage vehicle by garage.js: the four modifications (travel, tyre,
// grip, width) work on them exactly like on the procedural trucks, starting from each model's real stock values.
//
// Geometry is in the model's own frame (+z forward, +x = left, +y up, metres) as written by tools/convertVehicle.mjs:
//   z: [front axle z, rear axle z]    half: half track (m)    R: tyre radius (m)
//   wy: wheel-centre height relative to the centre of mass at rest   restLen: suspension travel (m)
//   sag: static spring compression (m) -> sets spring stiffness     fHi: high-range pulling force at stock tyres (N)
//   vHi: top speed in high range (m/s)   steer: max steering angle (rad)   grip: tyre grip vs stock rubber (%)
//   dims: rough L/W/H for inertia + camera   hull: body contact box (see hullPoints in garage.js)
//   hard: a road car that isn't expected to finish the trail (tests only require it to stay upright)
//   assist: rollover-assist strength   cam: chase-camera distance multiplier   cab: cockpit-camera eye point   heads: headlight positions
export const MODEL_VEHICLES = [
  {
    id: 'rubicon', model: 'jeep', name: 'Rubicon', blurb: 'Modern 4-door off-roader, doors off', cat: 'Off-road',
    mass: 2050, z: [1.74, -1.269], half: 0.847, R: 0.415, wy: -0.433, restLen: 0.55, sag: 0.258,
    fHi: 13500, vHi: 37, assist: 0.6, steer: 0.62, grip: 105, dims: { L: 4.9, W: 2, H: 1.8 },
    hull: { w: 2, yBot: -0.4, yMid: 0.3, yTop: 0.96, zF: 2.49, zR: -2.39, rf: 0.9, rr: -2, rw: 1.5 },
    cam: 1.05, cab: [0.38, 0.62, -0.25], heads: [[-0.48, 0.17, 2.2], [0.48, 0.17, 2.2]],
    paintMat: 'PRIMARY', colors: [0x3a3d40, 0xb3241c, 0x1f5fa8, 0x5b6148, 0xe8e8e4, 0xe0b52a],
    credit: '“Jeep Wrangler Adventure Rubicon” by vecarz (sketchfab.com/heynic), CC BY-NC-SA',
  },
  {
    id: 'cougar', model: 'cougar', name: 'Cougar 6x6', blurb: 'Seven-tonne armoured six-wheeler', cat: 'Trucks',
    mass: 6000, z: [2.402, -2.661], half: 1.051, R: 0.573, wy: -0.72, restLen: 0.55, sag: 0.3,
    fHi: 32000, vHi: 24, assist: 0.8, steer: 0.5, grip: 100, dims: { L: 7, W: 2.6, H: 2.6 },
    hull: { w: 2.7, yBot: -0.6, yMid: 0.2, yTop: 1.3, zF: 3.65, zR: -4.1, rf: 1.8, rr: -4, rw: 2.4, extraZ: [-1.355] },
    cam: 1.55, cab: [0.5, 0.9, 1.5], heads: [[-0.9, -0.2, 3.6], [0.9, -0.2, 3.6]],
    credit: 'Ground Vehicle model © Cesium GS, Apache 2.0 (CesiumJS sample data)',
  },
  {
    id: 'challenger', model: 'challenger', name: 'Challenger ’70', blurb: 'Classic muscle car, big V8, no clearance', cat: 'Road & race',
    mass: 1650, z: [1.446, -1.441], half: 0.76, R: 0.318, wy: -0.22, restLen: 0.4, sag: 0.184,
    fHi: 15500, vHi: 52, assist: 1, steer: 0.56, grip: 90, dims: { L: 4.9, W: 1.95, H: 1.35 },
    hull: { w: 1.95, yBot: -0.36, yMid: 0, yTop: 0.82, zF: 2.4, zR: -2.48, rf: 0.3, rr: -0.9, rw: 1.3 },
    cam: 1, cab: [0.43, 0.55, -0.25], heads: [[-0.62, 0.07, 2.3], [0.62, 0.07, 2.3]],
    paintMat: 'paint_w_stripes', colors: [0x5a2a7a, 0x7fbf2a, 0xe35b12, 0xe8e6df, 0x16181b, 0xa3171b],
    credit: '“Dodge Challenger 1970 R/T” by kryptonmedia (Blend Swap), CC0',
  },
  {
    id: 'gt300', model: 'supra', name: 'GT300 Racer', blurb: 'Super GT race car — hard mode', cat: 'Road & race',
    mass: 1250, z: [1.425, -1.205], half: 0.837, R: 0.35, wy: -0.12, restLen: 0.3, sag: 0.102,
    fHi: 14000, vHi: 58, assist: 1.2, steer: 0.55, grip: 95, dims: { L: 4.5, W: 2.06, H: 1.3 },
    hull: { w: 2.05, yBot: -0.38, yMid: 0.1, yTop: 0.85, zF: 2.4, zR: -2.12, rf: 0.2, rr: -1, rw: 1.2 },
    cam: 0.95, cab: [-0.4, 0.55, -0.3], heads: [[-0.7, 0.05, 2.25], [0.7, 0.05, 2.25]],
    credit: '“Toyota GR Supra GT300” by vecarz (sketchfab.com/heynic), CC BY',
  },
  {
    id: 'f1', model: 'mclaren', name: 'MP4/5 F1', blurb: '1989 Formula 1 car — silly mode', cat: 'Road & race',
    hard: true, mass: 600, z: [1.275, -1.704], half: 0.893, R: 0.34, wy: -0.02, restLen: 0.2, sag: 0.051,
    fHi: 9000, vHi: 70, assist: 1.4, steer: 0.45, grip: 105, dims: { L: 4.5, W: 1.9, H: 0.95 },
    hull: { w: 1.5, yBot: -0.27, yMid: 0, yTop: 0.6, zF: 2.27, zR: -2.27, rf: 0.5, rr: -0.8, rw: 0.5 },
    cam: 0.9, cab: [0, 0.55, -0.15], heads: [[-0.3, 0.1, 2], [0.3, 0.1, 2]],
    credit: '“McLaren MP4/5” by vecarz (sketchfab.com/heynic), CC BY',
  },
  {
    id: 'rover', model: 'rover', name: 'Mars Rover', blurb: 'NASA Perseverance, sped up for Earth', cat: 'Specials',
    mass: 1025, z: [1.095, -1.165], half: 1.062, R: 0.261, wy: -0.74, restLen: 0.3, sag: 0.1,
    fHi: 6000, vHi: 14, assist: 1, steer: 0.7, grip: 115, dims: { L: 3, W: 2.7, H: 2.2 }, albedo: 0.72,
    hull: { w: 2, yBot: -0.35, yMid: 0, yTop: 1.2, zF: 1.3, zR: -1.7, rf: 0.9, rr: -1, rw: 0.8, extraZ: [-0.09] },
    cam: 1, cab: [0, 1.05, 0.45], heads: [[-0.4, -0.1, 1.4], [0.4, -0.1, 1.4]],
    credit: 'Perseverance rover 3D model courtesy NASA/JPL-Caltech',
  },
  {
    id: 'milk', model: 'milk', name: 'Milk Float', blurb: 'Tall vintage delivery truck', cat: 'Trucks',
    mass: 2700, z: [1.433, -1.352], half: 0.929, R: 0.426, wy: -0.4, restLen: 0.5, sag: 0.3,
    fHi: 17000, vHi: 29, assist: 0.5, steer: 0.55, grip: 95, dims: { L: 4.9, W: 2, H: 2.6 }, albedo: 0.8,
    hull: { w: 2.6, yBot: -0.38, yMid: 0.6, yTop: 1.95, zF: 2.4, zR: -2.4, rf: 1.5, rr: -2.3, rw: 2.4 },
    cam: 1.2, cab: [-0.45, 1.45, 1], heads: [[-0.68, 0.02, 2.4], [0.68, 0.02, 2.4]],
    credit: 'Cesium Milk Truck © Cesium, CC BY 4.0 (Khronos glTF Sample Assets)',
  },
  {
    id: 'concept', model: 'concept', name: 'Street Concept', blurb: 'Clearcoat concept car — hard mode', cat: 'Road & race',
    hard: true, mass: 1350, z: [1.485, -1.314], half: 0.977, R: 0.383, wy: -0.34, restLen: 0.44, sag: 0.174,
    fHi: 12000, vHi: 50, assist: 1.2, steer: 0.58, grip: 90, dims: { L: 4.4, W: 2, H: 1.2 },
    hull: { w: 2.2, yBot: -0.36, yMid: 0, yTop: 0.45, zF: 2.4, zR: -1.94, rf: 0.6, rr: -1, rw: 1.4 },
    cam: 0.95, cab: [0, 0.85, 0.1], heads: [[-0.62, 0.43, 2.3], [0.62, 0.43, 2.3]],
    paintMat: '^Paint 1', colors: [0xaa0000, 0x1f4fb8, 0xe8e8e4, 0x16181b, 0xe0b52a, 0x2f7a4a],
    credit: 'Car Concept © Darmstadt Graphics Group, CC BY 4.0 (Khronos glTF Sample Assets)',
  },
];

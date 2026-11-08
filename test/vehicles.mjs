// Browser test for the realistic glTF vehicles: every one loads, swaps in, drives, and can be picked from the garage.
// Serve docs/ first:  python3 -m http.server 8767 -d docs   then  node test/vehicles.mjs [--shots]
import { chromium } from 'playwright';
import fs from 'fs';
const shots = process.argv.includes('--shots');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0; const check = (n, ok, i = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n, i); if (!ok) fails++; };
const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::ERR/.test(m.text())) errs.push(m.text()); });
await p.goto('http://localhost:8767/index.html?q=low&post=0&manual=1');
await p.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 240000 });
const G = (f, a) => p.evaluate(f, a);
const ids = await G(() => [...document.querySelectorAll('#vehList .vcard.model')].length);
check('garage lists the realistic models', ids >= 8, `${ids} model cards`);
if (shots) fs.mkdirSync('test/out', { recursive: true });

const list = ['rubicon', 'cougar', 'challenger', 'gt300', 'f1', 'rover', 'milk', 'concept'];
for (const id of list) {
  const t0 = Date.now();
  const r = await G(async (id) => {
    const g = window.__game, s = await g.setVehicle(id), v = g.vehicle();
    g.start('free'); g.S.countdown = 0; g.advance(2);
    const y0 = g.phys.pos.y; g.advance(4, { throttle: 1 });
    const n = []; g.scene.traverse(o => { if (o.isMesh && !o.geometry.attributes.position.array.every(Number.isFinite)) n.push(o.name); });
    return { model: v.model, id: s.id, speed: g.phys.speed * 3.6, up: g.phys.up.y, finite: Number.isFinite(g.phys.pos.x + y0), bad: n.length };
  }, id);
  check(`${id} loads and drives`, r.id === id && r.model !== 'procedural' && r.speed > 8 && r.up > 0.6 && r.finite && !r.bad, `${r.model} ${r.speed.toFixed(0)} km/h up=${r.up.toFixed(2)} ${Date.now() - t0} ms`);
  if (shots) { await G(() => window.__game.renderOnce()); await p.screenshot({ path: `test/out/drive_${id}.png`, timeout: 240000 }); }
}
// pick from the garage UI, tune a slider, then go back to the procedural truck
await G(() => window.__game.toMenu());
await p.click('#btnGarage');
await p.click('.vcat[data-c="Road & race"]');
const visible = await G(() => [...document.querySelectorAll('#vehList .vcard')].filter(c => !c.classList.contains('hidden')).length);
check('category filter', visible === 4, `${visible} cards in Road & race`);
await p.click('.vcat[data-c="All"]');
const card = (name) => p.locator('#vehList .vcard', { hasText: name });
await card('Rubicon').click();
await p.waitForFunction(() => window.__game.vehicle().model === 'jeep' && !document.querySelector('.vcard.loading'), null, { timeout: 120000 });
const tyre = p.locator('#mods input[type=range]').nth(1);
const r0 = await G(() => window.__game.phys.R);
await tyre.evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input')); });
const r1 = await G(() => window.__game.phys.R);
check('tyre slider works on a model', r1 > r0 + 0.04, `R ${r0.toFixed(3)} -> ${r1.toFixed(3)}`);
check('garage name shows tuned', /Rubicon · tuned/.test(await G(() => document.getElementById('garageName').textContent)));
await p.click('#btnModReset');
if (shots) { await G(() => { window.__game.tick(1 / 30, 40); window.__game.renderOnce(); }); await p.screenshot({ path: 'test/out/garage_rubicon.png', timeout: 240000 }); }
await card('Ridge Runner').click();
await p.waitForFunction(() => window.__game.vehicle().model === 'procedural', null, { timeout: 60000 });
check('back to the procedural truck', (await G(() => window.__game.phys.setup.id)) === 'runner');
check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

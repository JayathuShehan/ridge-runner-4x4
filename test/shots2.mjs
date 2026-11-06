import { chromium } from 'playwright';
const q = process.argv[2] || 'high', W = +(process.argv[3] || 960), H = +(process.argv[4] || 540);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
await p.goto(`http://localhost:8765/dist/index.html?q=${q}&manual=1`);
await p.waitForFunction(() => window.__game, null, { timeout: 240000 });
const G = (f, a) => p.evaluate(f, a);
const shot = async (name, n = 2) => { let ms = 0; for (let i = 0; i < n; i++) ms = await G(() => window.__game.renderOnce(0.05)); await p.screenshot({ path: `/tmp/v2-${name}.png`, timeout: 120000 }); return ms; };
console.log('menu render ms', (await shot('menu', 3)).toFixed(0));
console.log(JSON.stringify(await G(() => ({ ...window.__game.info(), vegTris: window.__game.veg.tris, bush: window.__game.veg.bushTris, stones: window.__game.rocks.stoneCount }))));
await G(() => { const g = window.__game; g.start('trail'); g.S.countdown = 0; g.S.mode = 'play'; });
const scenes = process.argv[5] ? JSON.parse(process.argv[5]) : [['start', 0, 2], ['whoops', 1, 5], ['mud', 2, 9], ['river', 6, 8.8], ['rocks', 7, 12], ['summit', 4, 9]];
for (const [name, cp, secs] of scenes) {
  await G(([c, s]) => { const g = window.__game; g.teleportCp(c); g.S.next = c + 1; g.botDrive(s); }, [cp, secs]);
  for (let i = 0; i < 30; i++) await G(() => { window.__game.renderOnce(0.05); });  // let camera settle (renders without physics)
  console.log(name, 'ms', (await shot(name, 1)).toFixed(0), JSON.stringify(await G(() => { const i = window.__game.info(); return { calls: i.calls, tris: i.tris, speed: i.speed.toFixed(1) }; })));
}
console.log(errs.slice(0, 12).join('\n'));
await b.close();

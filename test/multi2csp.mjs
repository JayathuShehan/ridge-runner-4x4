import { chromium } from 'playwright';
const q = process.argv[2] || 'high';
const scenes = JSON.parse(process.argv[3]);
const [W, H] = (process.argv[4] || '800x450').split('x').map(Number);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.type() + ' ' + m.text().slice(0, 300)); });
await p.goto(`http://localhost:8766/index.html?q=${q}&manual=1`);
await p.waitForFunction(() => window.__game, null, { timeout: 240000 });
const G = (f, a) => p.evaluate(f, a);
for (const sc of scenes) {
  const [name, cp, secs, opts] = sc;
  await G(([c, s, o]) => {
    const g = window.__game;
    if (o && o.menu) { g.toMenu(); g.botDrive(s); return; }
    if (g.S.mode === 'menu') { g.start('trail'); g.S.countdown = 0; g.S.mode = 'play'; }
    if (o && o.night !== undefined) g.setNight(o.night);
    g.teleportCp(c); g.S.next = c + 1; g.botDrive(s);
    if (o && o.dirt !== undefined) g.setDirt(o.dirt);
    if (o && o.cam !== undefined) g.setCam(o.cam);
  }, [cp, secs, opts || null]);
  await G(() => { const g = window.__game; g.renderOnce(0.05); g.renderOnce(0.05); });
  await p.screenshot({ path: `/tmp/v2-${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await G(() => { const i = window.__game.info(); return { speed: i.speed.toFixed(1), pos: i.pos.map(v => v.toFixed(0)), next: i.next }; })));
}
console.log(errs.slice(0, 12).join('\n') || 'no errors');
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto('http://localhost:8765/viewer/index.html' + (process.argv[2] || ''));
await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
console.log('tris', await p.evaluate(() => window.tris()));
const views = [['front34', 0.75, 0.18, 7.5, 0], ['rear34', 2.5, 0.22, 7.5, 0], ['side', Math.PI / 2, 0.05, 7.5, 0], ['front', 0, 0.1, 6.5, 0], ['muddy', -0.9, 0.2, 7, 0.9]];
for (const [n, az, el, d, dirt] of views) { await p.evaluate(([a, e, dd, di]) => window.setView(a, e, dd, di), [az, el, d, dirt]); await p.waitForTimeout(300); await p.screenshot({ path: `/tmp/truck-${n}.png` }); }
await b.close();

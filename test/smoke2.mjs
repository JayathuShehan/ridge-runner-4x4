import { chromium } from 'playwright';
const q = process.argv[2] || 'high';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 400)); });
const t0 = Date.now();
await p.goto(`http://localhost:8765/dist/index.html?q=${q}`);
try { await p.waitForFunction(() => window.__game, null, { timeout: 240000 }); } catch (e) { console.log('timeout; load msg:', await p.evaluate(() => document.getElementById('loadMsg').textContent)); }
console.log('load s', ((Date.now() - t0) / 1000).toFixed(1));
await p.waitForTimeout(3000);
await p.screenshot({ path: `/tmp/v2-menu-${q}.png` });
if (await p.evaluate(() => !!window.__game)) {
  console.log(JSON.stringify(await p.evaluate(() => ({ ...window.__game.info(), vegTris: window.__game.veg.tris, bush: window.__game.veg.bushTris, stones: window.__game.rocks.stoneCount }))));
  await p.click('#btnTrail');
  await p.evaluate(() => { window.__game.S.countdown = 0.01; });
  await p.waitForFunction(() => window.__game.info().mode === 'play', null, { timeout: 60000 });
  await p.evaluate(() => window.__game.botDrive(6));
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `/tmp/v2-drive-${q}.png` });
  console.log(JSON.stringify(await p.evaluate(() => window.__game.info())));
}
console.log(errs.slice(0, 15).join('\n'));
await b.close();

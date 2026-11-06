import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0;
for (const q of ['medium', 'low', 'high']) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:8766/index.html?q=${q}&manual=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => window.__game || document.getElementById('errBox'), null, { timeout: 240000 }).catch(() => {});
  let box = await p.evaluate(() => document.getElementById('errBox')?.textContent || '');
  if (!box) { try { await p.evaluate(() => { const g = window.__game; g.renderOnce(); g.start('trail'); g.S.countdown = 0; g.tick(1 / 30, 3, true); g.setNight(true); g.renderOnce(); }); } catch (e) { errs.push(e.message); } box = await p.evaluate(() => document.getElementById('errBox')?.textContent || ''); }
  const ok = !box && !errs.length; if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + q, box.slice(0, 200), errs.join(' | '));
  await p.close();
}
await b.close(); process.exit(fails ? 1 : 0);

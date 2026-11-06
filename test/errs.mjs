import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [q, touch] of [['low', true], ['medium', false], ['high', false], ['low', false]]) {
  const ctx = await b.newContext({ viewport: { width: 740, height: 360 }, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.stack.split('\n').slice(0, 4).join(' | ')));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await p.goto(`http://localhost:8765/dist/index.html?q=${q}&manual=1`);
  await p.waitForFunction(() => window.__game || /Error/.test(document.getElementById('loadMsg').textContent), null, { timeout: 240000 }).catch(() => {});
  const msg = await p.evaluate(() => document.getElementById('loadMsg').textContent);
  if (await p.evaluate(() => !!window.__game)) { try { await p.evaluate(() => { const g = window.__game; g.renderOnce(); g.start('trail'); g.S.countdown = 0; g.tick(1 / 30, 5, true); }); } catch (e) { errs.push('tick: ' + e.message); } }
  console.log(q, touch ? 'touch' : 'desk', '| loadMsg:', msg, '|', errs.join(' || ') || 'no errors');
  await ctx.close();
}
await b.close();

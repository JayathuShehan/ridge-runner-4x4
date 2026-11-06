import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const q of ['low', 'high']) {
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.stack.split('\n').slice(0, 5).join(' | ')));
  p.on('console', m => { if (m.type() === 'error' || /failed|issues/.test(m.text())) errs.push(m.type() + ': ' + m.text().slice(0, 250)); });
  await p.goto(`http://localhost:8766/index.html?q=${q}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__game || document.getElementById('errBox'), null, { timeout: 180000 }).catch(() => {});
  await p.waitForTimeout(15000);
  const box = await p.evaluate(() => document.getElementById('errBox')?.textContent || 'none');
  const fps = await p.evaluate(() => window.__perf && window.__perf.fps);
  console.log(q, 'errBox:', box, 'fps', fps, '\n ', errs.slice(0, 6).join('\n  ') || 'no errors');
  await p.close();
}
await b.close();

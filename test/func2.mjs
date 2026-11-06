import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let fails = 0; const check = (n, ok, i = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n, i); if (!ok) fails++; };
async function run(label, viewport, touch) {
  const ctx = await b.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8767/index.html?q=low&post=0&manual=1');
  await p.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 240000 });
  await p.evaluate(() => window.__game.renderOnce());
  const G = (f, a) => p.evaluate(f, a);
  const T = (n = 10) => G((k) => window.__game.tick(1 / 30, k), n);
  const wait = async (fn, arg, n = 60) => { for (let i = 0; i < n; i++) { if (await G(fn, arg)) return true; await T(3); } return false; };
  check(`${label} menu`, await G(() => !document.getElementById('menu').classList.contains('hidden')));
  await p.click('#btnTrail', { timeout: 60000 });
  check(`${label} countdown`, (await G(() => window.__game.S.mode)) === 'countdown');
  await G(() => { window.__game.S.countdown = 0.001; });
  await wait(() => window.__game.S.mode === 'play');
  if (!touch) {
    await p.keyboard.down('KeyW'); await wait(() => window.__game.phys.speed > 0.5); await p.keyboard.up('KeyW');
    check(`${label} W drives`, (await G(() => window.__game.phys.speed)) > 0.5);
    for (const [k, test] of [['KeyF', 'g.phys.fourWD === false'], ['KeyL', 'g.phys.lowRange === true'], ['KeyC', 'g.S.camMode === 1'], ['KeyN', 'g.S.night === true']]) {
      await p.keyboard.press(k);
      check(`${label} ${k}`, await wait((t) => { const g = window.__game; return eval(t); }, test));
    }
    await p.keyboard.press('KeyN');
  } else {
    check(`${label} touch UI visible`, await G(() => getComputedStyle(document.getElementById('touchCtl')).display !== 'none'));
    const gas = await (await p.$('[data-touch="gas"]')).boundingBox();
    await p.mouse.move(gas.x + gas.width / 2, gas.y + gas.height / 2); await p.mouse.down();
    await wait(() => window.__game.phys.speed > 0.5);
    await p.mouse.up();
    check(`${label} gas pedal drives`, (await G(() => window.__game.phys.speed)) > 0.5);
    const wb = await (await p.$('#wheel')).boundingBox();
    const cx = wb.x + wb.width / 2, cy = wb.y + wb.height / 2;
    await p.mouse.move(cx, wb.y + 10); await p.mouse.down();
    for (let i = 1; i <= 8; i++) { const a = -Math.PI / 2 + i * 0.15; await p.mouse.move(cx + Math.cos(a) * wb.width * 0.45, cy + Math.sin(a) * wb.height * 0.45); }
    const st = await G(() => window.__game.input.touch.wheel);
    await p.mouse.up();
    check(`${label} wheel drag steers right`, st > 0.3, st.toFixed(2));
    await p.click('#btn4wd'); check(`${label} 4WD button`, await wait(() => !window.__game.phys.fourWD));
  }
  // recover
  await G(() => { const g = window.__game; g.phys.quat.set(0, 0, 1, 0); g.phys.pos.y += 1.5; });
  await p.click('[data-action="reset"]');
  check(`${label} recover`, await wait(() => window.__game.phys.up.y > 0.8));
  await p.click('#pauseBtn'); check(`${label} pause`, await wait(() => window.__game.S.mode === 'pause'));
  await p.click('#btnResume'); await T(2);
  await G(() => { const g = window.__game; g.S.next = g.T.cpS.length; g.teleportCp(0); g.phys.pos.x += 0; g.advance(1.5, { throttle: 1 }); });
  await T(5); await p.waitForTimeout(1500);
  check(`${label} finish screen`, await wait(() => !document.getElementById('finish').classList.contains('hidden')));
  await G(() => window.__game.renderOnce()); await p.screenshot({ path: `/tmp/v2-func-${label}.png`, timeout: 120000 });
  check(`${label} no errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
await run('desktop', { width: 640, height: 360 }, false);
await run('phone', { width: 740, height: 360 }, true);
await b.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);

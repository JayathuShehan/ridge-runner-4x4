// Browser smoke test + screenshots via headless Chrome (SwiftShader WebGL)
import { chromium } from 'playwright';
import path from 'path';

const url = 'file://' + path.resolve('dist/index.html');
const shots = process.argv[2] || '/tmp/shots';
const fs = await import('fs'); fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
const check = (n, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n, info); if (!ok) fails++; };

async function run(viewport, label, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/${label}-menu.png` });
  const G = (fn, arg) => page.evaluate(fn, arg);
  check(`${label}: menu visible`, await G(() => !document.getElementById('menu').classList.contains('hidden')));
  // start trail via click (also tests buttons)
  await page.click('#btnTrail');
  await page.waitForTimeout(200);
  check(`${label}: countdown`, (await G(() => window.__game.info().mode)) === 'countdown');
  await page.waitForTimeout(1500);
  await G(() => { window.__game.S.countdown = 0.01; });
  await page.waitForFunction(() => window.__game.info().mode === 'play', null, { timeout: 60000 });
  await G(() => window.__game.advance(4, { throttle: 1 }));
  await page.waitForTimeout(600);
  const i1 = await G(() => window.__game.info());
  check(`${label}: truck drives in browser`, i1.speed > 2, JSON.stringify({ speed: i1.speed.toFixed(1), fps: i1.fps.toFixed(1), calls: i1.calls, tris: i1.tris }));
  await page.screenshot({ path: `${shots}/${label}-driving.png` });
  // keyboard actions
  await G(() => window.__game.setInput(null));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(300);
  check(`${label}: F toggles 4WD`, (await G(() => window.__game.phys.fourWD)) === false);
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(300);
  check(`${label}: L toggles low range`, (await G(() => window.__game.phys.lowRange)) === true);
  await page.keyboard.press('KeyF'); await page.keyboard.press('KeyL');
  // keyboard throttle
  await G(() => window.__game.advance(3, { brake: 1 }));
  const v0 = await G(() => window.__game.info().speed);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
  const v1 = await G(() => window.__game.info().speed);
  await page.keyboard.up('KeyW');
  check(`${label}: W key drives`, v1 > v0 + 0.05, `${v0.toFixed(2)} -> ${v1.toFixed(2)}`);
  // scenic screenshots at features
  // drive the real trail with the autopilot and grab screenshots at the features
  const feats = [['mud', 2, 9.5], ['summit', 4, 7], ['river', 6, 8.5], ['rocks', 7, 12], ['jumps', 10, 7.6], ['bog', 11, 9]];
  for (const [name, fromCp, secs] of feats) {
    await G(([c, sec]) => { const g = window.__game; g.teleportCp(c); g.S.next = c + 1; g.botDrive(sec); }, [fromCp, secs]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${shots}/${label}-${name}.png` });
  }
  // recovery
  await G(() => { const g = window.__game; g.setInput(null); g.phys.quat.setFromAxisAngle({ x: 0, y: 0, z: 1, isVector3: true }, Math.PI); g.phys.pos.y += 2; });
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(1500);
  check(`${label}: R recovers upright`, (await G(() => window.__game.phys.up.y)) > 0.8);
  // night
  await page.keyboard.press('KeyN');
  await G(() => { const g = window.__game; g.teleportCp(1); g.S.next = 2; g.botDrive(5); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/${label}-night.png` });
  await page.keyboard.press('KeyN');
  // camera modes
  await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/${label}-hoodcam.png` });
  await page.keyboard.press('KeyC');
  // pause
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(`${label}: Esc pauses`, (await G(() => window.__game.info().mode)) === 'pause');
  await page.screenshot({ path: `${shots}/${label}-pause.png` });
  await page.click('#btnResume'); await page.waitForTimeout(200);
  check(`${label}: resume works`, (await G(() => window.__game.info().mode)) === 'play');
  // finish flow: jump to last checkpoint and drive through finish
  await G(() => { const g = window.__game; g.S.next = g.T.cpS.length; g.teleportCp(0); g.phys.pos.x -= 0; });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__game.info().mode === 'finish', null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1800);
  check(`${label}: finish screen`, await G(() => !document.getElementById('finish').classList.contains('hidden')));
  await page.screenshot({ path: `${shots}/${label}-finish.png` });
  if (touch) {
    await page.click('#btnAgain');
    await page.waitForTimeout(500);
    await G(() => { window.__game.S.countdown = 0.01; });
    await page.waitForFunction(() => window.__game.info().mode === 'play', null, { timeout: 60000 });
    await G(() => window.__game.setInput(null));
    check(`${label}: touch controls visible`, await G(() => !document.getElementById('touch').classList.contains('hidden')));
    const gas = await page.$('[data-touch="gas"]');
    const b = await gas.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(3000);
    check(`${label}: touch gas drives`, (await G(() => window.__game.info().speed)) > 0.05);
    await page.screenshot({ path: `${shots}/${label}-touchdrive.png` });
    await page.mouse.up();
  }
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 5).join(' | '));
  check(`${label}: no NaN resets`, !(await G(() => window.__game.phys.nanReset)));
  await ctx.close();
}
await run({ width: 1280, height: 720 }, 'desktop');
await run({ width: 844, height: 390 }, 'mobile', true);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL BROWSER TESTS PASSED');
process.exit(fails ? 1 : 0);

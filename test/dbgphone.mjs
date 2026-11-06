import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.stack));
await p.goto('http://localhost:8765/dist/index.html?q=low&post=0&manual=1');
await p.waitForFunction(() => window.__game, null, { timeout: 240000 });
await p.evaluate(() => { const g = window.__game; g.start('trail'); g.S.countdown = 0.001; g.tick(1/30, 3); });
await p.click('#btn4wd');
try { await p.evaluate(() => window.__game.tick(1 / 30, 3)); console.log('ok', await p.evaluate(() => window.__game.phys.fourWD)); } catch (e) { console.log(e.message); }
await b.close();

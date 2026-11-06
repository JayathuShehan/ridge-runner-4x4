import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('file:///home/claude/game/dist/index.html');
await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
for (let i = 0; i < 4; i++) { await page.waitForTimeout(2000); console.log(JSON.stringify(await page.evaluate(() => window.__game.info()))); }
await page.click('#btnTrail');
for (let i = 0; i < 2; i++) { await page.waitForTimeout(2000); console.log(JSON.stringify(await page.evaluate(() => ({...window.__game.info(), cd: window.__game.S.countdown})))); }
await browser.close();

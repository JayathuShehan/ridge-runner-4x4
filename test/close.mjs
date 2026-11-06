import { chromium } from '/home/claude/v2/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 500 } });
await p.goto('http://localhost:8765/viewer/index.html');
await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
await p.evaluate(() => { window.setView(Math.PI / 2 + 0.25, 0.12, 3.2); });
await p.screenshot({ path: '/tmp/arch.png' });
await b.close();

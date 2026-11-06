import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:8765/viewer/trees.html');
await p.waitForFunction(() => window.result, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.result), null, 0));
await b.close();

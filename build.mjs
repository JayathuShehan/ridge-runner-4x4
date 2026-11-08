import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
const stubTextures = {
  name: 'ez-textures-stub',
  setup(b) {
    b.onResolve({ filter: /\/textures$|\.\/textures\.js$/ }, (args) => {
      if (args.importer.includes('ez-tree')) return { path: path.resolve('src/ezStub.js') };
    });
  },
};
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, minify: process.env.NOMIN ? false : true, format: 'iife', outfile: 'docs/game.js', target: 'es2020', legalComments: 'none', plugins: [stubTextures], logLevel: 'warning', metafile: true });
await esbuild.build({ entryPoints: ['src/engine/engineWorklet.js'], bundle: true, minify: true, format: 'iife', outfile: 'docs/engine-worklet.js', target: 'es2020', legalComments: 'none', logLevel: 'warning' });
fs.copyFileSync('src/index.html', 'docs/index.html');
fs.mkdirSync('docs/assets/ez', { recursive: true });
for (const f of fs.readdirSync('assets')) if (fs.statSync('assets/' + f).isFile() && !f.endsWith('.hdr')) fs.copyFileSync('assets/' + f, 'docs/assets/' + f);
for (const f of fs.readdirSync('assets/ez')) fs.copyFileSync('assets/ez/' + f, 'docs/assets/ez/' + f);
// realistic vehicles (converted glTF: json + bin + webp) and their garage thumbnails
for (const d of ['vehicles', 'thumbs']) { fs.mkdirSync('docs/assets/' + d, { recursive: true }); for (const f of fs.readdirSync('assets/' + d)) fs.copyFileSync(`assets/${d}/${f}`, `docs/assets/${d}/${f}`); }
const sz = (p) => fs.statSync(p).size;
let total = 0; const walk = d => fs.readdirSync(d).forEach(f => { const p = d + '/' + f; fs.statSync(p).isDirectory() ? walk(p) : (total += sz(p)); });
walk('docs');
console.log('game.js', (sz('docs/game.js') / 1024).toFixed(0), 'KB; docs total', (total / 1048576).toFixed(1), 'MB');

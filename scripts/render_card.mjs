// Render public/card/index.html to PNG: public/card/latest.png and public/card/YYYY-MM-DD.png.
// Run from the repo root after build_static.py:  node scripts/render_card.mjs
// Needs Playwright with Chromium (NODE_PATH=$(npm root -g) if installed globally).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import { readFile, copyFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const PUB = resolve('public');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const body = await readFile(join(PUB, p));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/card/`);
await page.evaluate(() => document.fonts.ready);
const date = (await page.title()).replace('Rate card ', '').trim();
await page.locator('.card').screenshot({ path: join(PUB, 'card', 'latest.png') });
await copyFile(join(PUB, 'card', 'latest.png'), join(PUB, 'card', `${date}.png`));
await browser.close();
server.close();
console.log(`Card rendered: public/card/latest.png and public/card/${date}.png`);

// Renders public/og-image.png (1200×630) from an HTML card with Playwright: `npm run og-image`.
// Playwright is not a project dependency. The script uses an installed copy; set PLAYWRIGHT_MODULE (and
// CHROMIUM_PATH if needed) to point at a specific install.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { site } from '../src/lib/site.mjs';

const require = createRequire(import.meta.url);
const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean);
let chromium;
for (const name of candidates) { try { ({ chromium } = require(name)); break; } catch {} }
if (!chromium) throw new Error('Playwright not found. Install it (npx playwright install chromium) or set PLAYWRIGHT_MODULE.');
const executablePath = process.env.CHROMIUM_PATH;

const icon = fs.readFileSync(new URL('../public/favicon.svg', import.meta.url)).toString('base64');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const csv = 'id,name,zip,total\n1,"Smith, Ann",02134,129.99\n2,Bruno Díaz,28013,54.5';
const json = '[\n  {\n    "id": 1,\n    "name": "Smith, Ann",\n    "zip": "02134",\n    "total": 129.99\n  },\n  …';
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=block" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:#0d1412;color:#e2ebe6;font-family:'IBM Plex Sans',sans-serif;display:grid;grid-template-columns:520px 1fr}
  .left{padding:58px 48px 50px 60px;display:flex;flex-direction:column;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:16px;font-weight:600;font-size:30px}
  h1{font-weight:600;font-size:54px;line-height:1.12;letter-spacing:-.01em}
  h1 em{font-style:normal;color:#5fd4a8}
  .formats{font:500 22px/1.5 'IBM Plex Mono',monospace;color:#a2b3ac;margin-top:22px}
  .url{font:400 22px 'IBM Plex Mono',monospace;color:#a2b3ac}
  .right{padding:56px 56px 56px 0;display:flex;flex-direction:column;gap:18px;justify-content:center}
  .pane{background:#141d1a;border:1px solid #2b3934;border-radius:14px;overflow:hidden}
  .head{font:500 16px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:#a2b3ac;padding:12px 18px;border-bottom:1px solid #2b3934;display:flex;justify-content:space-between}
  .head b{color:#5fd4a8;font-weight:500}
  pre{font:400 20px/1.5 'IBM Plex Mono',monospace;padding:14px 18px;color:#e2ebe6;white-space:pre}
  .k{color:#86e3bf}
</style></head><body>
<div class="left">
  <div class="brand"><img src="data:image/svg+xml;base64,${icon}" width="56" height="56" alt="">${site.name}</div>
  <div><h1>Convert data files <em>in your browser</em></h1><p class="formats">CSV · TSV · JSON · YAML<br>XML · TOML · Excel</p></div>
  <p class="url">${new URL(site.url).hostname} · nothing uploaded</p>
</div>
<div class="right">
  <div class="pane"><div class="head"><span>CSV INPUT</span><b>2 rows · comma</b></div><pre>${esc(csv)}</pre></div>
  <div class="pane"><div class="head"><span>JSON OUTPUT</span><b>✓ converted</b></div><pre>${esc(json).replace(/"(\w+)":/g, '<span class="k">"$1"</span>:')}</pre></div>
</div>
</body></html>`;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' }).catch(() => page.setContent(html));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og-image.png', import.meta.url).pathname });
await browser.close();
console.log('Wrote public/og-image.png (1200×630).');

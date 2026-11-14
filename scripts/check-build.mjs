// Post-build checks on dist/: run `npm run build && npm run check`.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { site } from '../src/lib/site.mjs';
import { PAIRS } from '../src/lib/pairs.mjs';
import { GUIDES } from '../src/lib/guides.mjs';
import { EDITORS } from '../src/lib/tools.mjs';

const root = path.resolve('dist');
const pages = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html')).map(f => f.split(path.sep).join('/'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) =>
  code[0] === '#'
    ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    : ENTITIES[code.toLowerCase()] ?? match);
// The URL a built file is served at: index.html is "/", json-editor.html is "/json-editor".
const urlOf = file => (file === 'index.html' ? '/' : `/${file.replace(/\.html$/, '')}`);
const titles = new Map();
const h1s = new Map();
let links = 0;
let structured = 0;

for (const file of pages) {
  const html = read(file);
  const h1 = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/g)];
  assert.equal(h1.length, 1, `${file}: exactly one H1`);
  const h1Text = decode(h1[0][0].replace(/<[^>]+>/g, '').trim());
  assert.ok(!h1s.has(h1Text), `${file}: H1 "${h1Text}" also used on ${h1s.get(h1Text)}`);
  h1s.set(h1Text, file);

  const head = html.split('</head>')[0];
  const allTitles = [...head.matchAll(/<title>(.*?)<\/title>/gs)];
  assert.equal(allTitles.length, 1, `${file}: exactly one title`);
  const title = decode(allTitles[0][1]);
  assert.ok(!titles.has(title), `${file}: title "${title}" also used on ${titles.get(title)}`);
  titles.set(title, file);
  assert.ok(title.length >= 15 && title.length <= 60, `${file}: title is ${title.length} characters: ${title}`);
  const descriptions = [...html.matchAll(/<meta name="description" content="([^"]*)"/g)];
  assert.equal(descriptions.length, 1, `${file}: exactly one meta description`);
  const description = decode(descriptions[0][1]);
  assert.ok(description.length >= 120 && description.length <= 155, `${file}: description is ${description.length} characters: ${description}`);

  const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)];
  assert.equal(canonicals.length, 1, `${file}: one canonical link`);
  if (file !== '404.html') assert.equal(canonicals[0][1], site.url + (urlOf(file) === '/' ? '/' : urlOf(file)), `${file}: canonical is the page's own no-slash URL`);
  assert.match(html, /<meta property="og:image" content="https:\/\/convertdataformats\.com\/og-image\.png"/, `${file}: og:image`);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/, `${file}: twitter card`);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, `${file}: duplicate IDs`);
  const types = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    const data = JSON.parse(m[1]);
    assert.equal(data['@context'], 'https://schema.org', `${file}: JSON-LD context`);
    types.push(data['@type']);
    structured++;
  }
  if (file !== 'index.html' && file !== '404.html') assert.ok(types.includes('BreadcrumbList'), `${file}: BreadcrumbList`);

  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    const target = decodeURIComponent(m[1]);
    if (target.startsWith('//')) continue;
    assert.ok(target === '/' || !target.endsWith('/'), `${file}: internal link with a trailing slash: ${target}`);
    const asFile = target === '/' ? 'index.html' : /\.[a-z0-9]+$/i.test(target) ? target.slice(1) : `${target.slice(1)}.html`;
    assert.ok(fs.existsSync(path.join(root, asFile)), `${file}: broken link ${target}`);
    links++;
  }
  for (const m of html.matchAll(/href="(https:\/\/convertdataformats\.com[^"]*)"/g)) {
    const p = new URL(m[1]).pathname;
    assert.ok(p === '/' || !p.endsWith('/'), `${file}: absolute link with a trailing slash: ${m[1]}`);
  }
  const text = html.replace(/<script[\s\S]*?<\/script>/g, '');
  // A value that failed to render shows up as an element whose whole text is NaN or undefined.
  assert.ok(!/>\s*(?:NaN|undefined)\s*<|\[object Object\]|="undefined"/.test(text), `${file}: NaN, undefined or [object Object] in rendered text`);
  assert.ok(!/—/.test(text.replace(/<pre[\s\S]*?<\/pre>|<textarea[\s\S]*?<\/textarea>/g, '')), `${file}: em dash in page copy`);
  // No ads: no ad slots, no ad networks.
  assert.ok(!/class="ad-|adsbygoogle|googlesyndication|doubleclick|adsterra|data-ad-/i.test(html), `${file}: ad markup`);
  assert.equal(html.includes(`googletagmanager.com/gtag/js?id=${site.analyticsId}`), Boolean(site.analyticsId), `${file}: Google tag`);
  assert.ok(html.includes("gtag('consent', 'default'"), `${file}: consent defaults`);
  assert.ok(html.includes('https://heicconverter.net'), `${file}: HEIC Converter link in the footer`);
}

// The five URLs of the old site still exist, spelled without a trailing slash.
for (const legacy of ['/', '/json-editor', '/xml-editor', '/yaml-editor', '/converters']) {
  assert.ok(pages.includes(legacy === '/' ? 'index.html' : `${legacy.slice(1)}.html`), `legacy URL ${legacy} exists`);
}

// Every conversion page shows its converted sample in the HTML, and has the structured data the brief asks for.
for (const pair of PAIRS) {
  const html = read(`${pair.slug}.html`);
  assert.match(html, /"@type":"WebApplication"/, `${pair.slug}: WebApplication JSON-LD`);
  assert.match(html, /"applicationCategory":"DeveloperApplication"/, `${pair.slug}: DeveloperApplication`);
  assert.match(html, /"@type":"FAQPage"/, `${pair.slug}: FAQPage JSON-LD`);
  if (pair.to === 'xlsx') assert.match(html, /data-out-table[^>]*>\s*<table>/, `${pair.slug}: sample sheet rendered`);
  else assert.match(html, /<pre data-output[^>]*><code>[^<]{20,}/, `${pair.slug}: converted sample in the HTML`);
  assert.ok(html.includes(`href="/${pair.reverseSlug}"`), `${pair.slug}: links to the reverse converter`);
  assert.ok(html.includes(`href="/formats/${pair.from}"`) && html.includes(`href="/formats/${pair.to}"`), `${pair.slug}: links to both format guides`);
}

// Conversion pages must not be boilerplate: compare the sentences of their paragraphs and list items.
const sentencesOf = html => {
  const main = (html.split('<div class="prose content">')[1] ?? '').split('</main>')[0];
  const blocks = [...main.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/g)].map(m => decode(m[2].replace(/<[^>]+>/g, '')));
  return new Set(blocks.join(' ').split(/(?<=[.!?])\s+/).map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).filter(s => s.length > 12));
};
const sets = PAIRS.map(pair => [pair.slug, sentencesOf(read(`${pair.slug}.html`))]);
let worst = { ratio: 0 };
for (let i = 0; i < sets.length; i++) {
  for (let j = i + 1; j < sets.length; j++) {
    const shared = [...sets[i][1]].filter(s => sets[j][1].has(s)).length;
    const ratio = shared / Math.min(sets[i][1].size, sets[j][1].size);
    if (ratio > worst.ratio) worst = { ratio, a: sets[i][0], b: sets[j][0] };
    assert.ok(ratio <= 0.3, `${sets[i][0]} and ${sets[j][0]} share ${Math.round(ratio * 100)}% of their sentences`);
  }
}

// The sitemap lists exactly the indexable pages, with no-slash URLs.
assert.match(read('404.html'), /<meta name="robots" content="noindex"/, '404: noindex');
const sitemap = fs.readFileSync(path.join(root, 'sitemap-0.xml'), 'utf8');
const listed = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
const indexable = pages.filter(f => !/<meta name="robots" content="noindex"/.test(read(f))).map(f => site.url + (urlOf(f) === '/' ? '/' : urlOf(f)));
assert.deepEqual([...listed].sort(), [...indexable].sort(), 'the sitemap lists exactly the indexable pages');
for (const url of listed) assert.ok(url === `${site.url}/` || !url.endsWith('/'), `sitemap URL with a trailing slash: ${url}`);
const expected = ['/', '/converters', '/formats', '/about', '/privacy', ...PAIRS.map(p => `/${p.slug}`), ...EDITORS.map(e => `/${e.slug}`), ...GUIDES.map(g => `/formats/${g.id}`)];
assert.deepEqual([...listed].sort(), expected.map(p => site.url + p).sort(), 'the sitemap has every page the site should have');

const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
assert.ok(robots.includes(`Sitemap: ${site.url}/sitemap-index.xml`), 'robots.txt names the sitemap');
const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy', '/_astro/*', 'immutable']) assert.ok(headers.includes(h), `_headers: ${h}`);
for (const file of ['robots.txt', 'llms.txt', 'favicon.svg', 'og-image.png', '_headers', 'samples/orders.xlsx']) assert.ok(fs.existsSync(path.join(root, file)), `dist/${file}`);
const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8');
for (const url of listed.filter(u => u !== `${site.url}/`)) assert.ok(llms.includes(`](${url})`), `llms.txt lists ${url}: run npm run build && npm run llms`);

console.log(`Verified ${pages.length} pages: one title, description, canonical and H1 each; lengths; ${structured} JSON-LD blocks; ${links} internal links, none with a trailing slash; the five legacy URLs; samples rendered; sitemap (${listed.length} URLs) equals the indexable pages; no ads. Most similar conversion pages: ${worst.a} and ${worst.b}, ${Math.round(worst.ratio * 100)}% of sentences shared.`);

// Writes public/llms.txt, the plain-text guide to this site for AI assistants (https://llmstxt.org).
// Every line comes from a built page: its <title> and meta description, for each URL in the sitemap.
// Run it after changing titles or descriptions, or adding a page:
//
//   npm run build && npm run llms && npm run build
//
// tests/llms.test.mjs fails if a converter, editor or guide is missing from the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, moreTools } from '../src/lib/site.mjs';
import { PAIRS } from '../src/lib/pairs.mjs';

const INTRO = `Free tools to convert, view, format and validate CSV, TSV, JSON, YAML, XML, TOML and Excel (.xlsx) files: ${PAIRS.length} converters, a JSON editor with JSON Schema validation, XML and YAML editors, a CSV viewer and format guides. Everything runs in the browser: files are never uploaded. No accounts and no ads.`;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const sitemap = path.join(dist, 'sitemap-0.xml');
if (!fs.existsSync(sitemap)) throw new Error('Run `npm run build` first: dist/sitemap-0.xml is missing.');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) =>
  code[0] === '#'
    ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    : ENTITIES[code.toLowerCase()] ?? match);
const brand = ` | ${site.name}`;

const urls = [...fs.readFileSync(sitemap, 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
const pages = urls.map(url => {
  const route = new URL(url).pathname;
  const file = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
  const html = fs.readFileSync(path.join(dist, file), 'utf8');
  const full = decode(html.match(/<title>([\s\S]*?)<\/title>/)[1]).trim();
  const title = full.endsWith(brand) ? full.slice(0, -brand.length) : full;
  const description = decode(html.match(/<meta name="description" content="([\s\S]*?)"/)[1]).trim();
  return { url, route, title, description };
});

const pairSlugs = new Set(PAIRS.map(p => `/${p.slug}`));
function section(route) {
  if (route === '/') return null;
  if (route === '/converters' || pairSlugs.has(route)) return 'Converters';
  if (/^\/(json-editor|xml-editor|yaml-editor|csv-viewer)$/.test(route)) return 'Editors and viewers';
  if (route.startsWith('/formats')) return 'Format guides';
  return 'About';
}

const order = ['Converters', 'Editors and viewers', 'Format guides', 'About'];
const hubFirst = (a, b) => a.route.split('/').length - b.route.split('/').length || (a.route === '/converters' ? -1 : b.route === '/converters' ? 1 : a.route.localeCompare(b.route));
const lines = [`# ${site.name}`, '', `> ${INTRO}`, '', `- [${pages.find(p => p.route === '/').title}](${site.url}/): ${pages.find(p => p.route === '/').description}`, ''];
for (const heading of order) {
  const group = pages.filter(p => section(p.route) === heading).sort(hubFirst);
  if (!group.length) continue;
  lines.push(`## ${heading}`, '');
  for (const p of group) lines.push(`- [${p.title}](${p.url}): ${p.description}`);
  lines.push('');
}
lines.push('## Optional', '', ...moreTools.map(t => `- [${t.name}](${t.url}/): ${t.about[0].toUpperCase()}${t.about.slice(1)}.`), '');

fs.writeFileSync(path.join(root, 'public', 'llms.txt'), lines.join('\n'));
console.log(`Wrote public/llms.txt: ${pages.length} pages from the sitemap.`);

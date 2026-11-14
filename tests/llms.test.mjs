// public/llms.txt is generated from the built pages by `npm run build && npm run llms`; this test catches a
// page that was added without regenerating it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { site } from '../src/lib/site.mjs';
import { PAIRS } from '../src/lib/pairs.mjs';
import { GUIDES } from '../src/lib/guides.mjs';
import { EDITORS } from '../src/lib/tools.mjs';

const text = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');

test('llms.txt names the site and lists every converter, editor and guide', () => {
  assert.ok(text.startsWith(`# ${site.name}\n\n> `), 'starts with the site name and a summary');
  assert.ok(text.includes('never uploaded'), 'says files are never uploaded');
  for (const href of ['/converters', '/formats', ...PAIRS.map(p => `/${p.slug}`), ...EDITORS.map(e => `/${e.slug}`), ...GUIDES.map(g => `/formats/${g.id}`)]) {
    assert.ok(text.includes(`](${site.url}${href}): `), `${href} is missing: run npm run build && npm run llms`);
  }
});

test('llms.txt uses no-slash URLs and gives every line a description', () => {
  for (const [, url] of text.matchAll(/\]\((https:\/\/convertdataformats\.com[^)]*)\)/g)) {
    const p = new URL(url).pathname;
    assert.ok(p === '/' || !p.endsWith('/'), url);
  }
  for (const line of text.split('\n').filter(l => l.startsWith('- ['))) assert.ok(/\): \S.{30,}$/.test(line), `no description: ${line.slice(0, 80)}`);
});

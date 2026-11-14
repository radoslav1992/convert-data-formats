// The conversion pages: complete, within search-result lengths, linked, and each one written for its own pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS, GROUPS, pairBySlug } from '../src/lib/pairs.mjs';
import { GUIDES } from '../src/lib/guides.mjs';
import { OPTION_DEFS, optionsFor } from '../src/lib/options.mjs';
import { site } from '../src/lib/site.mjs';

const SLUGS = ['csv-to-json', 'json-to-csv', 'json-to-yaml', 'yaml-to-json', 'json-to-xml', 'xml-to-json', 'xml-to-csv', 'csv-to-xml', 'excel-to-csv', 'csv-to-excel', 'excel-to-json', 'json-to-excel', 'json-to-toml', 'toml-to-json', 'tsv-to-csv', 'csv-to-tsv', 'yaml-to-xml', 'xml-to-yaml'];

/** The sentences of a page's own paragraphs: lede, introductions, explanations, notes and FAQ answers. */
export function sentences(pair) {
  const texts = [pair.lede, pair.rulesIntro, pair.example.text, ...pair.optionDocs.map(d => d.text), ...pair.errors.map(e => e.text), ...pair.watch, ...pair.faq.map(([, a]) => a)];
  return new Set(texts.join(' ').split(/(?<=[.!?])\s+/).map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).filter(s => s.length > 12));
}

test('every conversion from the brief has a page, and only those', () => {
  assert.deepEqual(PAIRS.map(p => p.slug).sort(), [...SLUGS].sort());
});

test('every pair is in exactly one group', () => {
  const grouped = GROUPS.flatMap(g => g.pairs.map(p => p.slug));
  assert.deepEqual([...grouped].sort(), [...SLUGS].sort());
});

for (const pair of PAIRS) {
  test(`${pair.slug}: title, description, H1 and lede`, () => {
    assert.ok(pair.title.length <= 60, `title is ${pair.title.length} characters: ${pair.title}`);
    assert.ok(pair.description.length >= 120 && pair.description.length <= 155, `description is ${pair.description.length} characters`);
    assert.equal(pair.h1, `${pair.name} Converter`);
    assert.ok(pair.lede.split(/(?<=\.)\s/).length === 1, 'the lede is one sentence');
    assert.ok(!/—/.test(JSON.stringify(pair)), 'no em dashes in page copy');
  });

  test(`${pair.slug}: rules, example, options, errors, limits, FAQ and links`, () => {
    assert.ok(pair.rules.length >= 6, 'a table of mapping rules');
    assert.ok(pair.example.input || pair.example.grid, 'a worked example');
    for (const name of pair.options) assert.ok(OPTION_DEFS[name], `${name} is a known option`);
    assert.deepEqual(pair.options, optionsFor(pair.from, pair.to));
    assert.deepEqual(pair.optionDocs.map(d => d.option).sort(), [...pair.options].sort(), 'every option is explained');
    for (const doc of pair.optionDocs) assert.ok(doc.variants.length >= 2 && doc.text.length > 60, `${doc.option}: mini example`);
    assert.ok(pair.errors.length >= 2, 'common errors');
    assert.ok(pair.watch.length >= 3, 'what is lost');
    assert.ok(pair.faq.length >= 6 && pair.faq.length <= 8, `6 to 8 FAQ entries, not ${pair.faq.length}`);
    assert.ok(pairBySlug(pair.reverseSlug), 'the reverse conversion has a page');
    for (const slug of pair.related) assert.ok(pairBySlug(slug) && slug !== pair.slug && slug !== pair.reverseSlug, `related: ${slug}`);
    for (const f of [pair.from, pair.to]) assert.ok(GUIDES.some(g => g.id === f), `guide for ${f}`);
    assert.ok(pair.samples.length >= 1);
  });
}

test('no two conversion pages share more than 30% of their sentences', () => {
  const sets = PAIRS.map(pair => [pair.slug, sentences(pair)]);
  let worst = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const [a, A] = sets[i];
      const [b, B] = sets[j];
      const shared = [...A].filter(s => B.has(s)).length;
      const ratio = shared / Math.min(A.size, B.size);
      worst = Math.max(worst, ratio);
      assert.ok(ratio <= 0.3, `${a} and ${b} share ${Math.round(ratio * 100)}% of their sentences`);
    }
  }
  assert.ok(worst < 0.3);
});

test('titles are unique across converters and guides', () => {
  const titles = [...PAIRS.map(p => p.title), ...GUIDES.map(g => g.title), site.defaultTitle];
  assert.equal(new Set(titles).size, titles.length);
});

test('format guides are complete', () => {
  assert.deepEqual(GUIDES.map(g => g.id), ['csv', 'tsv', 'json', 'yaml', 'xml', 'toml', 'xlsx']);
  for (const g of GUIDES) {
    assert.ok(g.title.length <= 60, `${g.id} title is ${g.title.length}`);
    assert.ok(g.description.length >= 120 && g.description.length <= 155, `${g.id} description is ${g.description.length}`);
    for (const field of ['standard', 'mediaType', 'lede', 'example', 'exampleNote']) assert.ok(g[field], `${g.id}.${field}`);
    assert.ok(g.syntax.length >= 3 && g.types.length >= 3 && g.pitfalls.length >= 3 && g.whenToUse.length >= 1, g.id);
    assert.ok(PAIRS.some(p => p.from === g.id || p.to === g.id), `${g.id} has converters`);
    assert.ok(!/—/.test(JSON.stringify(g)), `${g.id}: no em dashes`);
  }
});

test('the standards cited are the ones the brief names', () => {
  const text = JSON.stringify(GUIDES);
  for (const cite of ['RFC 4180', 'RFC 8259', 'ECMA-404', 'YAML 1.2.2', 'XML 1.0 (Fifth Edition)', 'TOML v1.0.0', 'ECMA-376', 'ISO/IEC 29500']) assert.ok(text.includes(cite), cite);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, serializeYaml, formatYaml } from '../src/lib/convert/yaml.mjs';

test('YAML 1.2: no, on, yes and off stay strings (the Norway problem)', () => {
  assert.deepEqual(parseYaml('country: no\nflag: on\nok: yes\nlight: off').value, { country: 'no', flag: 'on', ok: 'yes', light: 'off' });
});

test('true, false, null, ~ and numbers are typed', () => {
  assert.deepEqual(parseYaml('a: true\nb: false\nc: null\nd: ~\ne: 12\nf: 1.5\ng:').value, { a: true, b: false, c: null, d: null, e: 12, f: 1.5, g: null });
});

test('anchors, aliases and merge keys are resolved', () => {
  const { value } = parseYaml('base: &b {x: 1}\ncopy: *b\nmore:\n  <<: *b\n  y: 2');
  assert.deepEqual(value, { base: { x: 1 }, copy: { x: 1 }, more: { x: 1, y: 2 } });
});

test('an alias bomb is refused', () => {
  const bomb = 'a: &a [x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: [*e,*e,*e,*e,*e,*e,*e,*e,*e]';
  assert.throws(() => parseYaml(bomb), e => e.code === 'aliases');
});

test('several documents become an array, or only the first is used', () => {
  assert.deepEqual(parseYaml('a: 1\n---\nb: 2').value, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(parseYaml('a: 1\n---\nb: 2', { multiDoc: 'first' }).value, { a: 1 });
  assert.equal(parseYaml('a: 1\n---\nb: 2').meta.documents, 2);
});

test('block scalars keep their line breaks', () => {
  assert.deepEqual(parseYaml('text: |\n  one\n  two\nfold: >\n  one\n  two\n').value, { text: 'one\ntwo\n', fold: 'one two\n' });
});

test('JSON is valid YAML', () => assert.deepEqual(parseYaml('{"a": [1, "x", null]}').value, { a: [1, 'x', null] }));

test('errors carry a line and column', () => {
  assert.throws(() => parseYaml('a: 1\nb: [1, 2\nc: 3\n'), e => e.line === 3 && e.column === 1);
  assert.throws(() => parseYaml('a: 1\na: 2'), e => e.line === 2 && /appear only once/.test(e.message));
  assert.throws(() => parseYaml('a:\n\t- 1'), e => e.line === 2);
  assert.throws(() => parseYaml('list:\n  - a\n - b'), e => e.line === 3);
});

test('a document with only comments is an error', () => assert.throws(() => parseYaml('# nothing here\n'), e => e.code === 'empty'));
test('empty input is an error', () => assert.throws(() => parseYaml(''), e => e.code === 'empty'));

test('serialize: strings YAML 1.1 reads as booleans are quoted', () => {
  assert.equal(serializeYaml({ country: 'no', ok: 'Yes', name: 'Ann' }).text, 'country: "no"\nok: "Yes"\nname: Ann\n');
  assert.equal(serializeYaml({ country: 'no' }, { quoteYaml11: false }).text, 'country: no\n');
});

test('serialize: strings that look like numbers or null are quoted', () => {
  assert.equal(serializeYaml({ zip: '007', n: 'null', e: '' }).text, 'zip: "007"\n"n": "null"\ne: ""\n');
});

test('serialize: 4-space indent and block lists', () => {
  assert.equal(serializeYaml({ a: { b: [1, 2] } }, { indent: 4 }).text, 'a:\n    b:\n        - 1\n        - 2\n');
});

test('serialize: multi-line strings use a block scalar', () => {
  assert.equal(serializeYaml({ t: 'one\ntwo\n' }).text, 't: |\n  one\n  two\n');
});

test('round trip JSON → YAML → JSON keeps every value', () => {
  const v = { s: 'no', n: 1.5, b: true, z: null, list: [1, 'two', { three: 3 }], nested: { 'key with space': 'x: y', unicode: 'Zoë 😀' }, empty: [] };
  assert.deepEqual(parseYaml(serializeYaml(v).text).value, v);
});

test('format keeps comments', () => {
  assert.equal(formatYaml('# top\na:   1   # one\nb:\n    - x\n'), '# top\na: 1 # one\nb:\n  - x\n');
});

test('format keeps several documents', () => {
  assert.equal(formatYaml('a: 1\n---\nb: 2\n'), 'a: 1\n---\nb: 2\n');
});

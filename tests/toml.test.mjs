import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToml, serializeToml, findNull } from '../src/lib/convert/toml.mjs';

test('tables, arrays of tables and inline tables', () => {
  const { value } = parseToml('title = "x"\n[owner]\nname = "Tom"\n[[items]]\na = 1\n[[items]]\na = 2\npoint = { x = 1, y = 2 }');
  assert.deepEqual(value, { title: 'x', owner: { name: 'Tom' }, items: [{ a: 1 }, { a: 2, point: { x: 1, y: 2 } }] });
});

test('dates keep their TOML form as ISO 8601 text', () => {
  const { value } = parseToml('ld = 1979-05-27\nodt = 1979-05-27T07:32:00Z\nldt = 1979-05-27T07:32:00\nlt = 07:32:00');
  assert.deepEqual(value, { ld: '1979-05-27', odt: '1979-05-27T07:32:00.000Z', ldt: '1979-05-27T07:32:00.000', lt: '07:32:00.000' });
});

test('integers beyond 2^53 are kept exactly as BigInt', () => {
  assert.equal(parseToml('big = 9007199254740993').value.big, 9007199254740993n);
});

test('errors carry a line and column', () => {
  assert.throws(() => parseToml('a = 1\na = 2'), e => e.line === 2 && /redefine/.test(e.message));
  assert.throws(() => parseToml('[x]\nb = "open'), e => e.line === 2 && /unfinished string/i.test(e.message));
  assert.throws(() => parseToml('a = 1 b = 2'), e => e.line === 1 && e.column === 7);
  assert.throws(() => parseToml('a = '), e => e.line === 1);
});

test('empty input is an error', () => assert.throws(() => parseToml(''), e => e.code === 'empty'));

test('null has no TOML form: a clear error with the path', () => {
  assert.throws(() => serializeToml({ server: { port: null } }), e => e.code === 'toml-null' && /server\.port is null/.test(e.message));
});

test('null keys can be left out instead', () => {
  const out = serializeToml({ a: 1, b: null, c: [1, null] }, { nulls: 'omit' });
  assert.equal(out.text, 'a = 1\nc = [ 1 ]\n');
  assert.equal(out.warnings.length, 1);
});

test('a top-level array is an error that says what to do, or is wrapped', () => {
  assert.throws(() => serializeToml([1, 2]), e => e.code === 'toml-array' && /Wrap the array/.test(e.message));
  assert.equal(serializeToml([{ a: 1 }], { topArray: 'wrap' }).text, '[[items]]\na = 1\n');
});

test('a single value is an error', () => assert.throws(() => serializeToml('x'), e => e.code === 'toml-scalar'));

test('findNull reports the first null path', () => {
  assert.equal(findNull({ a: [1, { b: null }] }), 'a[1].b');
  assert.equal(findNull({ 'my key': null }), '"my key"');
  assert.equal(findNull({ a: 1 }), undefined);
});

test('round trip JSON → TOML → JSON', () => {
  const v = { title: 'Example', version: 3, ratio: 0.5, enabled: true, tags: ['a', 'b'], server: { host: 'localhost', ports: [80, 443] }, users: [{ name: 'Ann' }, { name: 'Bob' }] };
  assert.deepEqual(parseToml(serializeToml(v).text).value, v);
});

test('strings with quotes, backslashes and line breaks survive', () => {
  const v = { s: 'say "hi"\\ \n tab\t' };
  assert.deepEqual(parseToml(serializeToml(v).text).value, v);
});

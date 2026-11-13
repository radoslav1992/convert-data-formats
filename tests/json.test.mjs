import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, serializeJson, scanJson, sortKeys } from '../src/lib/convert/json.mjs';
import { ConvertError } from '../src/lib/convert/errors.mjs';

const fails = (text, line, column, pattern) => {
  assert.throws(() => parseJson(text), error => {
    assert.ok(error instanceof ConvertError, 'ConvertError');
    assert.equal(error.line, line, `line for ${JSON.stringify(text)}: ${error.message}`);
    assert.equal(error.column, column, `column for ${JSON.stringify(text)}: ${error.message}`);
    assert.match(error.message, pattern);
    return true;
  });
};

test('parses objects, arrays and scalars', () => {
  assert.deepEqual(parseJson('{"a": [1, 2.5, "x", true, null]}').value, { a: [1, 2.5, 'x', true, null] });
  assert.equal(parseJson('"text"').value, 'text');
  assert.equal(parseJson('  42 ').value, 42);
});

test('strips a UTF-8 BOM', () => assert.deepEqual(parseJson('﻿{"a":1}').value, { a: 1 }));
test('keeps unicode and escapes', () => assert.deepEqual(parseJson('{"name":"Zoë 😀","esc":"\\u00e9\\n"}').value, { name: 'Zoë 😀', esc: 'é\n' }));

test('empty input is an error of its own kind', () => {
  assert.throws(() => parseJson('   \n'), e => e.code === 'empty');
  assert.throws(() => parseJson(''), e => e.code === 'empty');
});

const ERRORS = [
  ['{"a": 1,}', 1, 9, /Trailing commas/],
  ['[1, 2,]', 1, 7, /Trailing commas/],
  ['{\n  "a": 1\n  "b": 2\n}', 3, 3, /Expected "," or "}"/],
  ["{'a': 1}", 1, 2, /double quotes/],
  ['{"a": \'x\'}', 1, 7, /double quotes/],
  ['{a: 1}', 1, 2, /property name in double quotes/],
  ['{"a": 1} // note', 1, 10, /Comments are not allowed/],
  ['{"a": 01}', 1, 7, /leading zeros/],
  ['{"a": NaN}', 1, 7, /NaN is not allowed/],
  ['{"a": True}', 1, 7, /lowercase true/],
  ['{"a": "line\nbreak"}', 1, 12, /raw line break/],
  ['{"a": "x\\q"}', 1, 9, /not a valid escape/],
  ['{"a": 1', 1, 8, /ends inside an object/],
  ['[1, 2', 1, 6, /ends inside an array/],
  ['{"a" 1}', 1, 6, /Expected ":"/],
  ['{"a": 1}\n{"b": 2}', 2, 1, /after the end of the JSON value/],
  ['{"a": "unterminated}', 1, 7, /never closed/],
  ['{"a": 1.}', 1, 9, /decimal point/],
  ['{"a": -}', 1, 7, /minus sign/],
  ['{"a": undefined}', 1, 7, /lowercase true, false and null/],
  ['{"a": hello}', 1, 7, /Unexpected word "hello"/],
  ['{"a": "\\u12"}', 1, 8, /four hexadecimal digits/],
];
for (const [text, line, column, pattern] of ERRORS) {
  test(`error position: ${JSON.stringify(text)}`, () => fails(text, line, column, pattern));
}

test('warns about duplicate keys and numbers beyond 2^53', () => {
  const { warnings } = parseJson('{"a": 1, "a": 2, "big": 12345678901234567890}');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Line 1, column 10: The key "a" appears twice/);
  assert.match(warnings[1], /larger than 2\^53/);
});

test('scanJson records JSON Pointer positions', () => {
  const text = '{\n  "a": [10, {"b": true}]\n}';
  const { paths, error } = scanJson(text, { paths: true });
  assert.equal(error, undefined);
  assert.equal(text.slice(paths.get('/a/1/b')), 'true}]\n}');
  assert.equal(text.slice(paths.get('/a/0'), paths.get('/a/0') + 2), '10');
});

test('serializes with 2, 4, tab and no indent', () => {
  const v = { a: [1] };
  assert.equal(serializeJson(v).text, '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(serializeJson(v, { indent: '4' }).text, '{\n    "a": [\n        1\n    ]\n}');
  assert.equal(serializeJson(v, { indent: 'tab' }).text, '{\n\t"a": [\n\t\t1\n\t]\n}');
  assert.equal(serializeJson(v, { indent: '0' }).text, '{"a":[1]}');
});

test('sorts keys recursively, keeping array order', () => {
  assert.deepEqual(Object.keys(sortKeys({ b: 1, a: { d: 1, c: 2 } })), ['a', 'b']);
  assert.deepEqual(Object.keys(sortKeys({ a: { d: 1, c: 2 } }).a), ['c', 'd']);
  assert.deepEqual(sortKeys([3, 1, 2]), [3, 1, 2]);
  assert.equal(serializeJson({ b: 1, a: 2 }, { sortKeys: true, indent: '0' }).text, '{"a":2,"b":1}');
});

test('writes BigInt as digits and non-finite numbers as strings', () => {
  assert.equal(serializeJson({ n: 9007199254740993n }, { indent: '0' }).text, '{"n":9007199254740993}');
  const out = serializeJson({ x: Infinity, y: NaN }, { indent: '0' });
  assert.equal(out.text, '{"x":"inf","y":"nan"}');
  assert.equal(out.warnings.length, 2);
});

test('round trip keeps every value', () => {
  const v = { s: 'é "q" \\ \n', n: -1.25e-7, b: false, z: null, a: [[], {}], u: '😀' };
  assert.deepEqual(parseJson(serializeJson(v).text).value, v);
});

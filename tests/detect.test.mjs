import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/lib/convert/detect.mjs';

const CASES = [
  ['{"a": 1}', 'json'], ['[1, 2, 3]', 'json'], ['  \n[{"a":1}]', 'json'], ['{"a": 1,}', 'json'],
  ['<?xml version="1.0"?><a/>', 'xml'], ['<root><x>1</x></root>', 'xml'],
  ['name: Ann\nage: 30', 'yaml'], ['- a\n- b', 'yaml'], ['---\na: 1', 'yaml'], ['# config\nport: 80', 'yaml'],
  ['title = "x"\n[owner]\nname = "y"', 'toml'], ['[server]\nport = 8080', 'toml'], ['[[items]]\na = 1', 'toml'],
  ['a,b,c\n1,2,3\n4,5,6', 'csv'], ['a;b\n1;2', 'csv'], ['a|b\n1|2', 'csv'], ['a\tb\n1\t2', 'tsv'],
  ['"name","note"\n"Ann","x, y"', 'csv'],
];
for (const [text, format] of CASES) {
  test(`detects ${format}: ${JSON.stringify(text.slice(0, 30))}`, () => assert.equal(detect(text)?.format, format));
}

test('xlsx by its ZIP signature', () => assert.equal(detect(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])).format, 'xlsx'));
test('the file name wins for text files', () => assert.equal(detect('a: 1', { fileName: 'x.csv' }).format, 'csv'));
test('empty text is not detected', () => assert.equal(detect('  \n'), null));
test('a single word is not detected', () => assert.equal(detect('hello'), null));

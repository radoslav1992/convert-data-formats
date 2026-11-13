import test from 'node:test';
import assert from 'node:assert/strict';
import { inferValue, inferReason } from '../src/lib/convert/infer.mjs';

// [text, expected value]: a value converts only if writing it back gives the same text.
const CASES = [
  ['42', 42], ['-3.5', -3.5], ['0', 0], ['0.25', 0.25], ['true', true], ['false', false], ['null', null],
  ['007', '007'], ['1.50', '1.50'], ['1e5', '1e5'], ['+44 20 7946 0958', '+44 20 7946 0958'], ['+5', '+5'],
  ['12345678901234567890', '12345678901234567890'], ['9007199254740993', '9007199254740993'], ['9007199254740991', 9007199254740991],
  ['TRUE', 'TRUE'], ['True', 'True'], ['NULL', 'NULL'], ['', ''], [' 42', ' 42'], ['42 ', '42 '], ['-0', '-0'],
  ['Infinity', 'Infinity'], ['NaN', 'NaN'], ['0x1F', '0x1F'], ['1,000', '1,000'], ['.5', '.5'], ['5.', '5.'],
  ['2024-03-15', '2024-03-15'], ['1.0', '1.0'],
];

for (const [text, expected] of CASES) {
  test(`infer ${JSON.stringify(text)} → ${JSON.stringify(expected)}`, () => {
    assert.deepEqual(inferValue(text), expected);
  });
}

test('inferReason explains why a value stays text', () => {
  assert.match(inferReason('007'), /leading zero/);
  assert.match(inferReason('12345678901234567890'), /2\^53/);
  assert.match(inferReason('1e5'), /100000/);
  assert.match(inferReason('+44'), /plus sign/);
  assert.match(inferReason('1.50'), /trailing zero/);
  assert.match(inferReason('42'), /becomes 42/);
});

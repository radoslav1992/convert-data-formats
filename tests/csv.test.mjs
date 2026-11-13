import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseRows, serializeCsv } from '../src/lib/convert/csv.mjs';
import { toTable, flattenRecord, nestRecord, uniqueHeaders, recordsOf } from '../src/lib/convert/table.mjs';

test('RFC 4180: quoted fields with commas, doubled quotes and line breaks', () => {
  const { value } = parseCsv('name,note\n"Smith, Ann","She said ""hi""\nthen left"\n', { inferTypes: false });
  assert.deepEqual(value, [{ name: 'Smith, Ann', note: 'She said "hi"\nthen left' }]);
});

test('strips a UTF-8 BOM and reports it', () => {
  const { value, meta } = parseCsv('\ufeffid,name\n1,Zoë\n');
  assert.deepEqual(value, [{ id: 1, name: 'Zoë' }]);
  assert.equal(meta.bom, true);
});

for (const [name, text, delimiter] of [
  ['comma', 'a,b\n1,2\n3,4', ','], ['semicolon', 'a;b\n1,5;2\n3;4', ';'], ['tab', 'a\tb\n1\t2\n3\t4', '\t'], ['pipe', 'a|b\n1|2\n3|4', '|'],
]) {
  test(`detects the ${name} delimiter`, () => assert.equal(parseCsv(text).meta.delimiter, delimiter));
}

test('a semicolon file keeps decimal commas as text', () => {
  assert.deepEqual(parseCsv('price;qty\n1,5;2').value, [{ price: '1,5', qty: 2 }]);
});

test('CRLF and LF line endings give the same rows', () => {
  const lf = parseCsv('a,b\n1,2\n3,4\n').value;
  const crlf = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(crlf.value, lf);
  assert.equal(crlf.meta.lineBreak, 'CRLF');
});

test('blank lines are skipped', () => assert.equal(parseCsv('a,b\n1,2\n\n\n3,4\n\n').value.length, 2));

test('duplicate and empty headers become unique, with a note', () => {
  const { value, warnings } = parseCsv('id,name,name,\n1,a,b,c');
  assert.deepEqual(Object.keys(value[0]), ['id', 'name', 'name_2', 'column_4']);
  assert.equal(warnings.filter(w => /renamed|no header/.test(w)).length, 2);
});

test('ragged rows are reported and padded', () => {
  const { value, warnings, meta } = parseCsv('a,b,c\n1,2\n1,2,3,4');
  assert.equal(meta.ragged, 2);
  assert.deepEqual(value[0], { a: 1, b: 2, c: '' });
  assert.deepEqual(value[1], { a: 1, b: 2, c: 3, field_4: 4 });
  assert.match(warnings.at(-1), /2 rows do not have 3 fields.*row 2 has 2, row 3 has 4/);
});

test('type inference keeps leading zeros, long digits and exponents as text', () => {
  const { value } = parseCsv('zip,id,e,phone,n,b\n007,12345678901234567890,1e5,+4420,12,true');
  assert.deepEqual(value[0], { zip: '007', id: '12345678901234567890', e: '1e5', phone: '+4420', n: 12, b: true });
});

test('type inference can be switched off', () => {
  assert.deepEqual(parseCsv('n,b\n12,true', { inferTypes: false }).value, [{ n: '12', b: 'true' }]);
});

test('empty cells can become null', () => {
  assert.deepEqual(parseCsv('a,b\n1,', { emptyAsNull: true }).value, [{ a: 1, b: null }]);
  assert.deepEqual(parseCsv('a,b\n1,').value, [{ a: 1, b: '' }]);
});

test('without a header row the result is an array of arrays', () => {
  assert.deepEqual(parseCsv('1,2\n3,4', { header: false }).value, [[1, 2], [3, 4]]);
});

test('dot-path headers can be nested', () => {
  assert.deepEqual(parseCsv('id,address.city,address.zip\n1,Oslo,0150', { nest: true }).value, [{ id: 1, address: { city: 'Oslo', zip: '0150' } }]);
});

test('an unclosed quote is an error with the position of the opening quote', () => {
  assert.throws(() => parseCsv('a,b\n1,"open\n2,3'), e => e.line === 2 && e.column === 3 && /never closed/.test(e.message));
});

test('a stray quote inside a quoted field is a warning, not an error', () => {
  const { warnings } = parseCsv('a,b\n"x"y",2');
  assert.ok(warnings.some(w => /not doubled/.test(w)));
});

test('empty input is an error', () => assert.throws(() => parseCsv(' \n '), e => e.code === 'empty'));

test('unicode survives a round trip', () => {
  const rows = [{ name: 'Zoë', city: 'Kraków', emoji: '😀', cjk: '東京' }];
  assert.deepEqual(parseCsv(serializeCsv(rows).text).value, rows);
});

test('flattening: union of keys in first-seen order, nested objects as dot paths', () => {
  const t = toTable([{ id: 1, address: { city: 'Oslo' } }, { id: 2, email: 'x@y.z', address: { city: 'Rome', zip: '00100' } }]);
  assert.deepEqual(t.columns, ['id', 'address.city', 'email', 'address.zip']);
  assert.deepEqual(t.rows[0], [1, 'Oslo', null, null]);
});

test('arrays are joined or written as JSON', () => {
  assert.equal(flattenRecord({ tags: ['a', 'b'] }).get('tags'), 'a; b');
  assert.equal(flattenRecord({ tags: ['a', 'b'] }, { separator: '|' }).get('tags'), 'a|b');
  assert.equal(flattenRecord({ tags: ['a', 'b'] }, { arrays: 'json' }).get('tags'), '["a","b"]');
  assert.equal(flattenRecord({ items: [{ sku: 1 }] }).get('items'), '[{"sku":1}]');
});

test('a single object is one row; a wrapper object uses its array', () => {
  assert.equal(recordsOf({ a: 1 }).records.length, 1);
  assert.equal(recordsOf({ users: [{ a: 1 }, { a: 2 }] }).records.length, 2);
});

test('serialize: quoting follows RFC 4180, CRLF by default, LF on request', () => {
  const rows = [{ a: 'x,y', b: 'say "hi"', c: 'two\nlines' }];
  assert.equal(serializeCsv(rows).text, 'a,b,c\r\n"x,y","say ""hi""","two\nlines"\r\n');
  assert.equal(serializeCsv([{ a: 1 }], { lineEnding: 'lf' }).text, 'a\n1\n');
});

test('serialize: BOM, semicolon delimiter, null as empty, booleans as words', () => {
  const text = serializeCsv([{ a: null, b: true, c: 1.5 }], { bom: true, delimiter: 'semicolon', lineEnding: 'lf' }).text;
  assert.equal(text, '\ufeffa;b;c\n;true;1.5\n');
});

test('TSV: fields with tabs are quoted, or the tabs replaced', () => {
  assert.equal(serializeCsv([{ a: 'x\ty' }], { format: 'tsv', lineEnding: 'lf' }).text, 'a\n"x\ty"\n');
  const replaced = serializeCsv([{ a: 'x\ty\nz' }], { format: 'tsv', tsvMode: 'replace', lineEnding: 'lf' });
  assert.equal(replaced.text, 'a\nx y z\n');
  assert.equal(replaced.warnings.length, 1);
});

test('parseRows returns strings only', () => {
  assert.deepEqual(parseRows('a,b\n007,1').rows, [['a', 'b'], ['007', '1']]);
});

test('uniqueHeaders numbers repeats from 2', () => {
  assert.deepEqual(uniqueHeaders(['x', 'x', 'x']).headers, ['x', 'x_2', 'x_3']);
});

test('nestRecord leaves conflicting paths flat', () => {
  assert.deepEqual(nestRecord({ a: 1, 'a.b': 2 }), { a: 1, 'a.b': 2 });
});

test('handles a 10 MB CSV', () => {
  const line = '1,"Smith, Ann",ann@example.com,2024-03-15,129.99,true\n';
  const text = 'id,name,email,date,amount,active\n' + line.repeat(Math.ceil(10_000_000 / line.length));
  const start = performance.now();
  const { value, meta } = parseCsv(text);
  assert.equal(meta.rows, value.length);
  assert.ok(value.length > 180_000);
  assert.ok(performance.now() - start < 20_000);
});

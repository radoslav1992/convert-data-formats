import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseXlsx, serializeXlsx, readWorkbook, isoDate, cellValue, sheetName } from '../src/lib/convert/xlsx.mjs';
import { convert } from '../src/lib/convert/index.mjs';

test('write then read: numbers, booleans, text with leading zeros, empty cells', async () => {
  const { bytes } = await serializeXlsx([{ name: 'Ann', zip: '007', n: 7, ok: true, note: null }, { name: 'Bob', zip: '12345', n: 1.5, ok: false, note: 'x' }]);
  const { value, meta } = await parseXlsx(bytes);
  assert.deepEqual(value, [{ name: 'Ann', zip: '007', n: 7, ok: true, note: null }, { name: 'Bob', zip: '12345', n: 1.5, ok: false, note: 'x' }]);
  assert.equal(meta.rows, 2);
  assert.deepEqual(meta.sheets, ['Sheet1']);
});

test('round trip JSON → xlsx → JSON', async () => {
  const json = '[{"id":1,"city":"Zoë’s Kraków","tags":"a; b"},{"id":2,"city":"東京","tags":""}]';
  const xlsx = await convert('json', 'xlsx', json);
  const back = await convert('xlsx', 'json', xlsx.bytes, { indent: '0' });
  assert.equal(back.text, '[{"id":1,"city":"Zoë’s Kraków","tags":"a; b"},{"id":2,"city":"東京","tags":null}]');
});

test('dates are ISO 8601', () => {
  assert.equal(isoDate(new Date(Date.UTC(2024, 2, 15))), '2024-03-15');
  assert.equal(isoDate(new Date(Date.UTC(2024, 2, 15, 13, 45))), '2024-03-15T13:45:00');
  assert.equal(cellValue(0.1 + 0.2), 0.3);
});

test('sheet names are cleaned to Excel rules', () => {
  assert.equal(sheetName('a/b:c?'), 'a b c');
  assert.equal(sheetName('x'.repeat(40)).length, 31);
  assert.equal(sheetName(''), 'Sheet1');
});

// A minimal workbook written by hand: two sheets, a formula with its cached value, a date cell and a
// shared string, the way Excel stores them.
function handMadeWorkbook() {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5"><si><t>item</t></si><si><t>qty</t></si><si><t>total</t></si><si><t>date</t></si><si><t>Pens</t></si></sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>3</v></c><c r="C2"><f>B2*1.5</f><v>4.5</v></c><c r="D2" s="1"><v>45366</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>note</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

test('formula cells give their cached value; date cells give ISO dates', async () => {
  const { value } = await parseXlsx(handMadeWorkbook());
  assert.deepEqual(value, [{ item: 'Pens', qty: 3, total: 4.5, date: '2024-03-15' }]);
});

test('choose the sheet by name; several sheets are reported', async () => {
  const bytes = handMadeWorkbook();
  const sheets = await readWorkbook(bytes);
  assert.deepEqual(sheets.map(s => s.name), ['Orders', 'Notes']);
  const second = await parseXlsx(bytes, { sheet: 'Notes' });
  assert.deepEqual(second.value, [{ note: 'hello' }]);
  assert.ok(second.warnings.some(w => /2 sheets/.test(w)));
  await assert.rejects(parseXlsx(bytes, { sheet: 'Nope' }), e => e.code === 'xlsx-sheet' && /Orders, Notes/.test(e.message));
});

test('an .xls file and a non-zip file get clear errors', async () => {
  await assert.rejects(parseXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), e => e.code === 'xls');
  await assert.rejects(parseXlsx(new TextEncoder().encode('a,b\n1,2')), e => e.code === 'xlsx-invalid');
});

test('excel to csv copies the grid cell for cell', async () => {
  const out = await convert('xlsx', 'csv', handMadeWorkbook(), { lineEnding: 'lf' });
  assert.equal(out.text, 'item,qty,total,date\nPens,3,4.5,2024-03-15\n');
});

test('csv to excel keeps leading zeros as text and numbers as numbers', async () => {
  const out = await convert('csv', 'xlsx', 'zip,n\n007,12\n');
  const back = await readWorkbook(out.bytes);
  assert.deepEqual(back[0].data, [['zip', 'n'], ['007', 12]]);
});

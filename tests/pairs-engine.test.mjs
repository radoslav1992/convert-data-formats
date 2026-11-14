import test from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/lib/convert/index.mjs';

test('xml to csv: a child that repeats in some records is a list in all of them', async () => {
  const xml = '<orders><order no="1"><line><sku>A</sku></line><line><sku>B</sku></line></order><order no="2"><line><sku>C</sku></line></order></orders>';
  const out = await convert('xml', 'csv', xml, { recordName: 'order', lineEnding: 'lf' });
  assert.equal(out.text, '@no,line\n1,"[{""sku"":""A""},{""sku"":""B""}]"\n2,"[{""sku"":""C""}]"\n');
});

test('xml to csv: records are gathered across parents', async () => {
  const xml = '<orders><order><line><sku>A</sku></line><line><sku>B</sku></line></order><order><line><sku>C</sku></line></order></orders>';
  const out = await convert('xml', 'csv', xml, { lineEnding: 'lf' });
  assert.equal(out.text, 'sku\nA\nB\nC\n');
});

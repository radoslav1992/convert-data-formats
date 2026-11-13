import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, serializeXml, checkXml, findRecords, formatXml, minifyXml, xmlName } from '../src/lib/convert/xml.mjs';

test('attributes get "@", repeated elements become arrays, entities are decoded', () => {
  const { value } = parseXml('<library name="City &amp; Co"><book id="1"><title>A &lt;b&gt;</title></book><book id="2"><title>B</title></book></library>');
  assert.deepEqual(value, { library: { '@name': 'City & Co', book: [{ '@id': 1, title: 'A <b>' }, { '@id': 2, title: 'B' }] } });
});

test('text next to attributes goes under #text', () => {
  assert.deepEqual(parseXml('<price currency="EUR">9.50</price>').value, { price: { '@currency': 'EUR', '#text': '9.50' } });
});

test('CDATA is read as text', () => assert.deepEqual(parseXml('<a><![CDATA[x < y & z]]></a>').value, { a: 'x < y & z' }));
test('numeric character references are decoded', () => assert.deepEqual(parseXml('<a>&#233;&#x1F600;</a>').value, { a: 'é😀' }));
test('an empty element is an empty string', () => assert.deepEqual(parseXml('<a><b/></a>').value, { a: { b: '' } }));
test('the declaration and comments are not data', () => {
  const r = parseXml('<?xml version="1.0"?><!-- note --><a>1</a>');
  assert.deepEqual(r.value, { a: 1 });
  assert.ok(r.warnings.some(w => /Comments/.test(w)));
});

test('type inference follows the round-trip rule and can be switched off', () => {
  assert.deepEqual(parseXml('<r><a>12</a><b>007</b><c>true</c></r>').value, { r: { a: 12, b: '007', c: true } });
  assert.deepEqual(parseXml('<r><a>12</a></r>', { inferTypes: false }).value, { r: { a: '12' } });
});

test('a different attribute prefix', () => assert.deepEqual(parseXml('<a id="1"/>', { attrPrefix: '_' }).value, { a: { _id: 1 } }));

test('DOCTYPE entity declarations are rejected, never expanded', () => {
  assert.throws(() => parseXml('<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>'), e => e.code === 'doctype' && e.line === 1);
});

const BROKEN = [
  ['<a>\n  <b>\n</a>', 3, /<b> \(opened at line 2, column 3\) must be closed first/],
  ['<a></b>', 1, /<\/b> closes a tag that was never opened|must be closed first/],
  ['<a x="1" x="2"/>', 1, /appears twice/],
  ['<a>\n  Fish & chips\n</a>', 2, /bare "&"/],
  ['<a/><b/>', 1, /exactly one root element|more than one top-level/],
  ['<a>&nbsp;</a>', 1, /bare "&"/],
  ['<a><b></a></b>', 1, /must be closed first/],
  ['<a', 1, /./],
];
for (const [text, line, pattern] of BROKEN) {
  test(`not well-formed: ${JSON.stringify(text)}`, () => {
    const error = checkXml(text);
    assert.ok(error, 'reports an error');
    assert.equal(error.line, line, error.message);
    assert.match(error.message, pattern);
  });
}

test('well-formed XML passes the check', () => {
  assert.equal(checkXml('<?xml version="1.0"?>\n<a b="x &amp; y"><!-- & --><![CDATA[&]]></a>'), null);
});

test('serialize escapes & < > " \' in text and attributes', () => {
  const { text } = serializeXml({ root: { '@q': `a"b'c<d>&`, t: `5 < 6 & "x" 'y' > 4` } });
  assert.ok(text.includes('q="a&quot;b&apos;c&lt;d&gt;&amp;"'));
  assert.ok(text.includes('<t>5 &lt; 6 &amp; &quot;x&quot; &apos;y&apos; &gt; 4</t>'));
});

test('serialize renames keys that are not XML names and says so', () => {
  const { text, warnings } = serializeXml({ data: { '1st place': 'a', 'e-mail': 'b', 'two words': 'c' } });
  assert.ok(text.includes('<_1st_place>a</_1st_place>'));
  assert.ok(text.includes('<e-mail>b</e-mail>'));
  assert.ok(text.includes('<two_words>c</two_words>'));
  assert.match(warnings[0], /2 keys are not valid XML names/);
});

test('xmlName', () => {
  assert.equal(xmlName('9lives'), '_9lives');
  assert.equal(xmlName('a b/c'), 'a_b_c');
  assert.equal(xmlName('Zoë'), 'Zoë');
  assert.equal(xmlName(''), '_');
});

test('serialize: a single top key is the root, otherwise <root>; top arrays use <item>', () => {
  assert.match(serializeXml({ note: { to: 'Ann' } }).text, /^<\?xml[^\n]*\n<note>\n  <to>Ann<\/to>\n<\/note>\n$/);
  assert.match(serializeXml({ a: 1, b: 2 }).text, /<root>\n  <a>1<\/a>\n  <b>2<\/b>\n<\/root>/);
  assert.match(serializeXml([1, 2], { rootName: 'list' }).text, /<list>\n  <item>1<\/item>\n  <item>2<\/item>\n<\/list>/);
  assert.match(serializeXml([[1, 2]], { itemName: 'v' }).text, /<v>\n    <v>1<\/v>/);
});

test('serialize: null and empty string become empty elements, no declaration on request, minified', () => {
  assert.equal(serializeXml({ r: { a: null, b: '' } }, { declaration: false, indent: '0' }).text, '<r><a/><b/></r>\n');
});

test('round trip JSON → XML → JSON where the mapping is lossless', () => {
  const v = { catalog: { '@version': 2, book: [{ '@id': 'b1', title: 'Dune', year: 1965 }, { '@id': 'b2', title: 'Emma', year: 1815 }] } };
  assert.deepEqual(parseXml(serializeXml(v).text).value, v);
});

test('findRecords picks the longest repeated element, or the one named', () => {
  const v = parseXml('<shop><info><tag>a</tag><tag>b</tag></info><orders><order><id>1</id></order><order><id>2</id></order><order><id>3</id></order></orders></shop>').value;
  assert.equal(findRecords(v).path, 'shop.orders.order');
  assert.equal(findRecords(v).records.length, 3);
  assert.equal(findRecords(v, 'tag').records.length, 2);
  assert.throws(() => findRecords(v, 'missing'), e => e.code === 'record');
});

test('findRecords with a single record', () => {
  const v = parseXml('<orders><order><id>1</id><total>5</total></order></orders>').value;
  assert.deepEqual(findRecords(v).records, [{ id: 1, total: 5 }]);
});

test('format indents and keeps comments, CDATA and mixed content', () => {
  const out = formatXml('<?xml version="1.0"?><a><!-- c --><b x="1"  y="2">t</b><c><![CDATA[<x>]]></c><p>Hello <b>you</b> there</p><e/></a>');
  assert.equal(out, '<?xml version="1.0"?>\n<a>\n  <!-- c -->\n  <b x="1" y="2">t</b>\n  <c><![CDATA[<x>]]></c>\n  <p>Hello <b>you</b> there</p>\n  <e/>\n</a>\n');
});

test('format keeps spaces inside attribute values', () => {
  assert.equal(formatXml('<a t="x   y"/>'), '<a t="x   y"/>\n');
});

test('minify removes whitespace between tags only', () => {
  assert.equal(minifyXml('<a>\n  <b> x </b>\n  <p>Hi <i>you</i></p>\n</a>'), '<a><b>x</b><p>Hi <i>you</i></p></a>');
});

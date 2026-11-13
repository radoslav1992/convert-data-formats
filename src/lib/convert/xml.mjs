// XML 1.0, read and written with fast-xml-parser. Attributes get an "@" prefix, the text of an element that
// also has attributes or children goes under "#text", and an element name that repeats becomes an array.
// Documents that declare entities in a DOCTYPE are rejected: entity expansion is never performed.
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';
import { ConvertError, lineColumn, emptyInput, stripBom } from './errors.mjs';
import { inferValue } from './infer.mjs';
import { isPlainObject } from './table.mjs';

const ENTITY_REF = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/;

/**
 * Checks that XML is well-formed. Returns null, or a ConvertError with line and column.
 * @param {string} text
 */
export function checkXml(text) {
  if (!text.trim()) return emptyInput('xml');
  const entity = /<!ENTITY/i.exec(text);
  if (entity) {
    const { line, column } = lineColumn(text, entity.index);
    return new ConvertError('This document declares entities in its DOCTYPE. Entity declarations are not processed here, for safety (they can expand to huge or private content). Remove the DOCTYPE, or replace each entity with its text.', { line, column, offset: entity.index, format: 'xml', code: 'doctype' });
  }
  const result = XMLValidator.validate(text, { allowBooleanAttributes: false, unpairedTags: [] });
  if (result !== true) {
    const { msg, line, col } = result.err;
    const offset = line ? offsetFor(text, line, col) : 0;
    return new ConvertError(plainMessage(msg), { line: line ?? undefined, column: col ?? undefined, offset, format: 'xml', code: 'syntax' });
  }
  const roots = rootProblem(text);
  if (roots) return roots;
  // fast-xml-parser's validator accepts "&" and undefined entities; XML 1.0 does not.
  const bad = findBadAmpersand(text);
  if (bad >= 0) {
    const { line, column } = lineColumn(text, bad);
    return new ConvertError('A bare "&" is not allowed in XML text or attribute values. Write it as &amp; (and < as &lt;).', { line, column, offset: bad, format: 'xml', code: 'syntax' });
  }
  return null;
}

// XML allows exactly one root element and no text outside it (the validator misses some cases).
function rootProblem(text) {
  let depth = 0;
  let roots = 0;
  let offset = 0;
  for (const token of tokenize(text)) {
    const at = offset;
    offset += token.raw.length;
    if (token.type === 'open' || token.type === 'empty') {
      if (depth === 0 && ++roots === 2) {
        const { line, column } = lineColumn(text, at);
        return new ConvertError('There is more than one top-level element. XML allows exactly one root element: wrap the others in one.', { line, column, offset: at, format: 'xml', code: 'syntax' });
      }
      if (token.type === 'open') depth++;
    } else if (token.type === 'close') depth--;
    else if (token.type === 'text' && depth === 0 && token.raw.trim()) {
      const skip = token.raw.length - token.raw.trimStart().length;
      const { line, column } = lineColumn(text, at + skip);
      return new ConvertError(roots ? 'There is text after the root element closes. Move it inside the root element or remove it.' : 'There is text before the root element. XML must start with a tag such as <root>.', { line, column, offset: at + skip, format: 'xml', code: 'syntax' });
    }
  }
  return null;
}

function offsetFor(text, line, col) {
  let offset = 0;
  for (let l = 1; l < line; l++) { const next = text.indexOf('\n', offset); if (next < 0) break; offset = next + 1; }
  return offset + Math.max((col ?? 1) - 1, 0);
}

function plainMessage(msg) {
  const m = String(msg).replace(/\s+/g, ' ').trim();
  if (m === 'Start tag expected.') return 'Expected an element: XML must start with a tag such as <root>.';
  if (/^Multiple possible root nodes found/.test(m)) return 'There is more than one top-level element. XML allows exactly one root element: wrap the others in one.';
  if (/^Extra text at the end/.test(m)) return 'There is text after the root element closes. Move it inside the root element or remove it.';
  const rules = [
    [/^Expected closing tag '(.+)' \(opened in line (\d+), col (\d+)\) instead of closing tag '(.+)'\.$/, (_, a, l, c, b) => `Found </${b}>, but <${a}> (opened at line ${l}, column ${c}) must be closed first. Add </${a}> or fix the tag name.`],
    [/^Closing tag '(.+)' has not been opened\.$/, (_, a) => `</${a}> closes a tag that was never opened.`],
    [/^Unclosed tag '(.+)'\.$/, (_, a) => `<${a}> is never closed. Add </${a}> at the right place.`],
    [/^char '&' is not expected\.$/, () => 'A bare "&" is not allowed in XML. Write it as &amp;.'],
    [/^char '(.)' is not expected\.$/, (_, ch) => `Unexpected "${ch}". Text must be inside the root element.`],
    [/^Attribute '(.+)' is repeated\.$/, (_, a) => `The attribute ${a} appears twice in the same tag. Each attribute can appear only once.`],
    [/^(?:Attribute|boolean attribute) '(.+)' (?:is without value|is not allowed)\.$/, (_, a) => `The attribute ${a} has no value. In XML every attribute needs one, as in ${a}="${a}".`],
    [/^Attribute '(.+)' has no space in starting\.$/, (_, a) => `The attribute ${a} needs a space before it.`],
    [/^Attribute '(.+)' is an invalid name\.$/, (_, a) => `"${a}" is not a valid attribute name.`],
    [/^Attributes for '(.+)' have open quote\.$/, (_, a) => `An attribute value in <${a}> is missing its closing quote.`],
    [/^Tag '(.+)' is an invalid name\.$/, (_, a) => `<${a}> is not a valid element name. Names start with a letter or an underscore and have no spaces.`],
    [/^Invalid space after '<'\.$/, () => 'There is a space after "<". Remove it, or write a literal "<" as &lt;.'],
    [/^Closing tag '(.+)' doesn't have proper closing\.$/, (_, a) => `</${a} is missing its closing ">".`],
    [/^Invalid '\[(.*)\]' found\.$/, (_, list) => `These tags are never closed: ${list.replace(/"/g, '').replace(/\s+/g, ' ').trim()}.`],
  ];
  for (const [re, fn] of rules) if (re.test(m)) return m.replace(re, fn);
  return m;
}

function findBadAmpersand(text) {
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const amp = text.indexOf('&', i);
    if (amp < 0) return -1;
    if (lt >= 0 && lt < amp) {
      // Skip markup where "&" is not an entity reference.
      if (text.startsWith('<!--', lt)) { i = end(text, '-->', lt); continue; }
      if (text.startsWith('<![CDATA[', lt)) { i = end(text, ']]>', lt); continue; }
      if (text.startsWith('<?', lt)) { i = end(text, '?>', lt); continue; }
      if (/^<!DOCTYPE/i.test(text.slice(lt, lt + 9))) { i = end(text, '>', lt); continue; }
      i = lt + 1;
      continue;
    }
    if (!ENTITY_REF.test(text.slice(amp, amp + 12))) return amp;
    i = amp + 1;
  }
  return -1;
}
const end = (text, token, from) => { const at = text.indexOf(token, from); return at < 0 ? text.length : at + token.length; };

/**
 * Parses XML into plain data.
 * @param {string} input
 * @param {{ attrPrefix?: string, inferTypes?: boolean }} [options]
 * @returns {{ value: unknown, warnings: string[] }}
 */
export function parseXml(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  const problem = checkXml(text);
  if (problem) throw problem;
  const prefix = options.attrPrefix ?? '@';
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: prefix,
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    trimValues: false,
    processEntities: true,
    // Only the five XML entities and numeric references can reach the parser (checkXml rejects any other
    // reference); this setting is what makes fast-xml-parser decode the numeric ones.
    htmlEntities: true,
    commentPropName: false,
  });
  const raw = parser.parse(text);
  const warnings = [];
  if (/<!--/.test(text)) warnings.push('Comments are not part of the data and are left out.');
  const infer = options.inferTypes !== false;
  const tidy = value => {
    if (Array.isArray(value)) return value.map(tidy);
    if (isPlainObject(value)) {
      const attrs = [];
      const rest = [];
      for (const [key, v] of Object.entries(value)) {
        if (key === '#text') {
          const t = String(v).trim();
          if (t) rest.push([key, infer ? inferValue(t) : t]);
        } else if (prefix && key.startsWith(prefix)) attrs.push([key, infer ? inferValue(String(v)) : String(v)]);
        else rest.push([key, tidy(v)]);
      }
      const entries = [...attrs, ...rest];
      // An element left with only its text (whitespace around it removed) is just that text.
      if (entries.length === 1 && entries[0][0] === '#text') return entries[0][1];
      if (entries.length === 0) return '';
      return Object.fromEntries(entries);
    }
    if (typeof value === 'string') {
      const t = value.trim();
      return infer ? inferValue(t) : t;
    }
    return value;
  };
  return { value: tidy(raw), warnings };
}

/** A valid XML name for a key: invalid characters become "_", and a name that cannot start a name gets "_" in front. */
export function xmlName(key) {
  let name = String(key).replace(/[^\p{L}\p{M}\p{N}_.\-:·]/gu, '_');
  if (!/^[\p{L}_:]/u.test(name)) name = `_${name}`;
  return name;
}

/**
 * Writes a value as XML.
 * @param {unknown} value
 * @param {{ rootName?: string, itemName?: string, attrPrefix?: string, declaration?: boolean, indent?: string|number }} [options]
 * @returns {{ text: string, warnings: string[] }}
 */
export function serializeXml(value, options = {}) {
  const prefix = options.attrPrefix ?? '@';
  const itemName = xmlName(options.itemName || 'item');
  const renamed = new Map();
  const name = key => {
    const out = xmlName(key);
    if (out !== key) renamed.set(key, out);
    return out;
  };
  let root = options.rootName ? name(options.rootName) : '';
  let content = value;
  if (!root) {
    const keys = isPlainObject(value) ? Object.keys(value) : [];
    if (keys.length === 1 && !keys[0].startsWith(prefix || '\u0000') && keys[0] !== '#text' && !Array.isArray(value[keys[0]])) {
      root = name(keys[0]);
      content = value[keys[0]];
    } else root = 'root';
  }
  const prepare = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(item => (Array.isArray(item) ? { [itemName]: prepare(item) } : prepare(item)));
    if (isPlainObject(v)) {
      const out = {};
      for (const [key, child] of Object.entries(v)) {
        let target;
        if (key === '#text') target = '#text';
        else if (prefix && key.startsWith(prefix) && (child === null || typeof child !== 'object')) target = prefix + name(key.slice(prefix.length));
        else target = name(prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key);
        let unique = target;
        for (let k = 2; Object.hasOwn(out, unique); k++) unique = `${target}_${k}`;
        if (unique !== target) renamed.set(key, unique);
        out[unique] = prepare(child);
      }
      return out;
    }
    return String(v);
  };
  let body = prepare(content);
  if (Array.isArray(body)) body = { [itemName]: body };
  const indent = String(options.indent ?? '2');
  const builder = new XMLBuilder({
    ignoreAttributes: !prefix,
    attributeNamePrefix: prefix,
    textNodeName: '#text',
    format: indent !== '0',
    indentBy: indent === 'tab' ? '\t' : ' '.repeat(Number(indent) || 2),
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
    processEntities: true,
  });
  let text = builder.build({ [root]: body }).replace(/\n$/, '');
  if (options.declaration !== false) text = `<?xml version="1.0" encoding="UTF-8"?>\n${text}`;
  const warnings = [];
  if (renamed.size) {
    const list = [...renamed].slice(0, 8).map(([from, to]) => `"${from}" → <${to}>`).join(', ');
    warnings.push(`${renamed.size} key${renamed.size === 1 ? ' is' : 's are'} not ${renamed.size === 1 ? 'a valid XML name' : 'valid XML names'} and ${renamed.size === 1 ? 'was' : 'were'} renamed: ${list}${renamed.size > 8 ? ', …' : ''}.`);
  }
  return { text: `${text}\n`, warnings };
}

/**
 * Finds the repeated record element for a table: the longest array of elements anywhere in the document
 * (the shallowest one on a tie), or the element named `name` when given.
 * @returns {{ records: unknown[], path: string }}
 */
export function findRecords(value, name = '') {
  const found = [];
  const walk = (v, path, depth) => {
    if (Array.isArray(v)) {
      found.push({ records: v, path, depth });
      v.forEach(item => walk(item, path, depth + 1));
      return;
    }
    if (isPlainObject(v)) for (const [key, child] of Object.entries(v)) {
      if (key.startsWith('@') || key === '#text') continue;
      if (!Array.isArray(child) && isPlainObject(child)) found.push({ records: [child], path: path ? `${path}.${key}` : key, depth: depth + 1, single: true });
      walk(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(value, '', 0);
  if (name) {
    const match = found.find(f => f.path.split('.').at(-1) === name);
    if (!match) throw new ConvertError(`There is no element named <${name}> to use as the record. Check the spelling (names are case-sensitive), or leave the field empty to find it automatically.`, { code: 'record', format: 'xml' });
    return { records: match.records, path: match.path };
  }
  const arrays = found.filter(f => !f.single && f.records.length > 1);
  if (arrays.length) {
    arrays.sort((a, b) => b.records.length - a.records.length || a.depth - b.depth);
    return { records: arrays[0].records, path: arrays[0].path };
  }
  // No element repeats: use the deepest element that still has child elements (one record).
  const singles = found.filter(f => f.single).sort((a, b) => b.depth - a.depth);
  const leafy = singles.find(f => Object.values(f.records[0]).some(v => v === null || typeof v !== 'object'));
  if (leafy) return { records: leafy.records, path: leafy.path };
  return { records: [value], path: '' };
}

// ---- Editor helpers: format and minify while keeping comments, CDATA and processing instructions. ----

/** Splits XML into tokens: tags, text, comments, CDATA, processing instructions and the DOCTYPE. */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const stop = next < 0 ? text.length : next;
      tokens.push({ type: 'text', raw: text.slice(i, stop) });
      i = stop;
      continue;
    }
    let type = 'tag';
    let close = '>';
    if (text.startsWith('<!--', i)) { type = 'comment'; close = '-->'; }
    else if (text.startsWith('<![CDATA[', i)) { type = 'cdata'; close = ']]>'; }
    else if (text.startsWith('<?', i)) { type = 'pi'; close = '?>'; }
    else if (text.startsWith('<!', i)) { type = 'doctype'; close = '>'; }
    let stop;
    if (type === 'tag') {
      // A ">" inside a quoted attribute value does not end the tag.
      let quote = '';
      stop = i + 1;
      for (; stop < text.length; stop++) {
        const c = text[stop];
        if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
      }
      stop++;
    } else if (type === 'doctype' && text.indexOf('[', i) >= 0 && text.indexOf('[', i) < text.indexOf('>', i)) {
      stop = end(text, ']>', i);
    } else stop = end(text, close, i);
    const raw = text.slice(i, stop);
    if (type === 'tag') {
      const kind = raw.startsWith('</') ? 'close' : raw.endsWith('/>') ? 'empty' : 'open';
      tokens.push({ type: kind, raw, name: /^<\/?([^\s/>]+)/.exec(raw)?.[1] ?? '' });
    } else tokens.push({ type, raw });
    i = stop;
  }
  return tokens;
}

function buildTree(tokens) {
  const root = { children: [] };
  const stack = [root];
  for (const token of tokens) {
    const parent = stack.at(-1);
    if (token.type === 'open') {
      const node = { ...token, children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (token.type === 'close') {
      if (stack.length > 1) stack.pop();
      parent.closeRaw = token.raw;
    } else parent.children.push(token);
  }
  return root;
}

const isBlank = node => node.type === 'text' && !node.raw.trim();
const isMixed = node => node.children.some(c => c.type === 'text' && c.raw.trim()) && node.children.some(c => c.type !== 'text' && c.type !== 'cdata');
const raw = node => (node.type === 'open' ? node.raw + node.children.map(raw).join('') + (node.closeRaw ?? '') : node.raw);
// Collapses whitespace between attributes; attribute values are left exactly as written.
function tidyTag(tag) {
  let out = '';
  let quote = '';
  for (let i = 0; i < tag.length; i++) {
    const c = tag[i];
    if (quote) { out += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (/\s/.test(c)) { if (!out.endsWith(' ')) out += ' '; continue; }
    out += c;
  }
  return out.replace(/ (\/?>)$/, '$1');
}

/** Re-indents well-formed XML. Text inside elements that mix text and child elements is left exactly as is. */
export function formatXml(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  const problem = checkXml(text);
  if (problem) throw problem;
  const unit = options.indent === 'tab' ? '\t' : ' '.repeat(Number(options.indent ?? 2) || 2);
  const lines = [];
  const print = (nodes, depth) => {
    for (const node of nodes) {
      if (isBlank(node)) continue;
      const pad = unit.repeat(depth);
      if (node.type === 'text') { lines.push(pad + node.raw.trim()); continue; }
      if (node.type !== 'open') { lines.push(pad + (node.type === 'empty' ? tidyTag(node.raw) : node.raw)); continue; }
      const open = tidyTag(node.raw);
      const kids = node.children.filter(c => !isBlank(c));
      if (!kids.length) { lines.push(pad + open + (node.closeRaw ?? '')); continue; }
      if (kids.every(c => c.type === 'text' || c.type === 'cdata') || isMixed(node)) {
        const inner = isMixed(node) ? node.children.map(raw).join('') : kids.map(c => (c.type === 'text' ? c.raw.trim() : c.raw)).join('');
        lines.push(pad + open + inner + (node.closeRaw ?? ''));
        continue;
      }
      lines.push(pad + open);
      print(node.children, depth + 1);
      lines.push(pad + (node.closeRaw ?? ''));
    }
  };
  print(buildTree(tokenize(text)).children, 0);
  return lines.join('\n') + '\n';
}

/** Removes the whitespace between tags (outside mixed content). Comments are kept unless `comments` is false. */
export function minifyXml(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  const problem = checkXml(text);
  if (problem) throw problem;
  const keepComments = options.comments !== false;
  const out = [];
  const print = nodes => {
    for (const node of nodes) {
      if (isBlank(node)) continue;
      if (node.type === 'comment' && !keepComments) continue;
      if (node.type === 'text') { out.push(node.raw.trim()); continue; }
      if (node.type !== 'open') { out.push(node.type === 'empty' ? tidyTag(node.raw) : node.raw); continue; }
      if (isMixed(node)) { out.push(raw(node)); continue; }
      out.push(tidyTag(node.raw));
      print(node.children);
      out.push(node.closeRaw ?? '');
    }
  };
  print(buildTree(tokenize(text)).children);
  return out.join('');
}

// YAML 1.2, read and written with the `yaml` package. Under YAML 1.2 only true and false are booleans, so
// `no`, `on` and `yes` stay strings (YAML 1.1 read them as booleans: "the Norway problem").
import { parseAllDocuments, Document, visit, Scalar, isMap, isSeq } from 'yaml';
import { ConvertError, emptyInput, stripBom } from './errors.mjs';

// Strings a YAML 1.1 reader (PyYAML, older libraries) would read as booleans.
export const YAML11_BOOLEANS = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;

function toError(error, text) {
  const pos = error.linePos?.[0];
  const message = String(error.message).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
  const hint = HINTS[error.code];
  return new ConvertError(hint ? `${message}. ${hint}` : message.endsWith('.') ? message : `${message}.`, { line: pos?.line, column: pos?.col, offset: error.pos?.[0], format: 'yaml', code: 'syntax' });
}

const HINTS = {
  TAB_AS_INDENT: 'YAML indentation must use spaces, not tabs.',
  BAD_INDENT: 'Check that items at the same level line up with the same number of spaces.',
  DUPLICATE_KEY: 'Each key can appear only once in a mapping.',
  MISSING_CHAR: 'A key needs a colon and a space before its value, as in "name: value".',
  MULTILINE_IMPLICIT_KEY: 'A key must fit on one line; check for a missing colon or a stray line.',
};

/**
 * Parses a YAML stream.
 * @param {string} input
 * @param {{ multiDoc?: 'array'|'first', merge?: boolean }} [options] multiDoc: what to do with several documents.
 * @returns {{ value: unknown, warnings: string[], meta: { documents: number } }}
 */
export function parseYaml(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  if (!text.trim()) throw emptyInput('yaml');
  const docs = parseAllDocuments(text, { merge: options.merge !== false, uniqueKeys: true, prettyErrors: true });
  // parseAllDocuments returns an EmptyStream (not an array) when the text holds only comments.
  const list = Array.isArray(docs) ? docs : [];
  for (const doc of list) if (doc.errors.length) throw toError(doc.errors[0], text);
  const warnings = [];
  for (const doc of list) for (const w of doc.warnings) {
    const pos = w.linePos?.[0];
    warnings.push(`${pos ? `Line ${pos.line}, column ${pos.col}: ` : ''}${String(w.message).split('\n')[0]}`);
  }
  let values;
  try {
    values = list.map(doc => doc.toJS({ maxAliasCount: 1000 }));
  } catch (error) {
    throw new ConvertError(String(error.message), { format: 'yaml', code: 'aliases' });
  }
  if (!values.length) throw new ConvertError('The YAML holds only comments or directives and no data.', { format: 'yaml', code: 'empty' });
  if (values.length === 1) return { value: values[0], warnings, meta: { documents: 1 } };
  if (options.multiDoc === 'first') {
    warnings.push(`The input has ${values.length} documents; only the first is used.`);
    return { value: values[0], warnings, meta: { documents: values.length } };
  }
  warnings.push(`The input has ${values.length} documents (separated by ---), so the result is an array with one item per document.`);
  return { value: values, warnings, meta: { documents: values.length } };
}

/**
 * Writes a value as YAML 1.2.
 * @param {unknown} value
 * @param {{ indent?: string|number, quoteYaml11?: boolean, multiDoc?: boolean }} [options]
 *   quoteYaml11: put quotes around strings such as "no" and "on" that YAML 1.1 readers would take as booleans.
 * @returns {{ text: string, warnings: string[] }}
 */
export function serializeYaml(value, options = {}) {
  const indent = Number(options.indent ?? 2) || 2;
  const quote = options.quoteYaml11 !== false;
  const make = v => {
    const doc = new Document(normalize(v), { version: '1.2' });
    if (quote) {
      visit(doc, {
        Scalar(key, node) { if (typeof node.value === 'string' && YAML11_BOOLEANS.test(node.value)) node.type = Scalar.QUOTE_DOUBLE; },
      });
    }
    return doc.toString({ indent, lineWidth: 0, minContentWidth: 0 });
  };
  if (options.multiDoc && Array.isArray(value)) return { text: value.map(make).join('---\n'), warnings: [] };
  return { text: make(value), warnings: [] };
}

// BigInt and Date values are written as YAML understands them; undefined has no YAML form.
function normalize(value) {
  if (typeof value === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : normalize(v)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = normalize(v);
    return out;
  }
  return value;
}

/** Formats YAML text (re-indents it) while keeping comments, document by document. */
export function formatYaml(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  if (!text.trim()) throw emptyInput('yaml');
  const docs = parseAllDocuments(text, { uniqueKeys: true });
  const list = Array.isArray(docs) ? docs : [];
  for (const doc of list) if (doc.errors.length) throw toError(doc.errors[0], text);
  const indent = Number(options.indent ?? 2) || 2;
  return list.map((doc, i) => {
    const out = doc.toString({ indent, lineWidth: 0 });
    return i === 0 || out.startsWith('---') ? out : `---\n${out}`;
  }).join('');
}

export { isMap, isSeq };

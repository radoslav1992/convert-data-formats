// JSON (RFC 8259 / ECMA-404). Parsing uses the browser's own JSON.parse; when it fails, a small scanner
// that follows the RFC 8259 grammar finds the first error and describes it with a line and column, the same
// way in every browser (their native messages differ, and some give no position at all).
// The scanner also reports what JSON.parse accepts silently: duplicate keys (the last one wins) and
// integers beyond 2^53 (they are rounded).
import { ConvertError, lineColumn, emptyInput, stripBom } from './errors.mjs';

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
const describe = ch => (ch === undefined ? 'the end of the input' : ch === '\n' ? 'a line break' : ch === '\t' ? 'a tab' : `"${ch}"`);

/**
 * Walks the text with the JSON grammar.
 * @param {string} text
 * @param {{ paths?: boolean, maxWarnings?: number }} [options] paths: record the offset of every value by JSON Pointer.
 * @returns {{ error?: { message: string, offset: number }, warnings: { message: string, offset: number }[], paths?: Map<string, number> }}
 */
export function scanJson(text, options = {}) {
  const warnings = [];
  const maxWarnings = options.maxWarnings ?? 20;
  const paths = options.paths ? new Map() : undefined;
  let i = 0;
  const n = text.length;
  const warn = (message, offset) => { if (warnings.length < maxWarnings) warnings.push({ message, offset }); };
  const fail = (message, offset = i) => { throw { message, offset }; };
  const skip = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (WS.has(c)) { i++; continue; }
      if (c === 0x2f && (text[i + 1] === '/' || text[i + 1] === '*')) fail('Comments are not allowed in JSON. Remove the comment.');
      break;
    }
  };
  const escapePointer = key => key.replace(/~/g, '~0').replace(/\//g, '~1');

  function string() {
    const start = i;
    i++; // opening quote
    let out = '';
    let chunk = i;
    while (true) {
      if (i >= n) fail('This string is never closed. Add the closing double quote.', start);
      const c = text.charCodeAt(i);
      if (c === 0x22) { out += text.slice(chunk, i); i++; return out; }
      if (c === 0x5c) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('A \\u escape needs exactly four hexadecimal digits, as in \\u00e9.', i);
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          out += e; i += 2;
        } else {
          fail(`"\\${e ?? ''}" is not a valid escape in a JSON string. Use \\\\ for a backslash.`, i);
        }
        chunk = i;
        continue;
      }
      if (c < 0x20) fail(c === 0x0a ? 'A string cannot contain a raw line break. Write it as \\n, or close the string with a double quote.' : 'A string cannot contain a raw control character such as a tab. Write it as an escape (\\t).', i);
      i++;
    }
  }

  function number() {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') {
      i++;
      if (/[0-9]/.test(text[i] ?? '')) fail('Numbers cannot have leading zeros in JSON. Remove the zero, or put the value in quotes to keep it as text.', start);
    } else if (/[1-9]/.test(text[i] ?? '')) {
      while (/[0-9]/.test(text[i] ?? '')) i++;
    } else {
      fail(text[start] === '-' ? 'A minus sign must be followed by a digit.' : `Unexpected ${describe(text[i])}.`, start);
    }
    let integer = true;
    if (text[i] === '.') {
      integer = false;
      i++;
      if (!/[0-9]/.test(text[i] ?? '')) fail('A decimal point must be followed by a digit.', i);
      while (/[0-9]/.test(text[i] ?? '')) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      integer = false;
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!/[0-9]/.test(text[i] ?? '')) fail('An exponent must have digits, as in 1e5.', i);
      while (/[0-9]/.test(text[i] ?? '')) i++;
    }
    const raw = text.slice(start, i);
    if (integer && raw.replace('-', '').length > 15 && !Number.isSafeInteger(Number(raw))) {
      warn(`${raw} is larger than 2^53, so JavaScript rounds it to ${String(Number(raw))}. Put it in quotes to keep every digit.`, start);
    }
  }

  function value(path, depth) {
    if (depth > 5000) fail('The data is nested too deeply (more than 5,000 levels).');
    skip();
    if (paths) paths.set(path, i);
    const ch = text[i];
    if (ch === '{') {
      i++;
      skip();
      const seen = new Set();
      if (text[i] === '}') { i++; return; }
      while (true) {
        skip();
        if (text[i] === '}') fail('Trailing commas are not allowed in JSON. Remove the comma before "}".', i);
        if (text[i] === "'") fail('Property names need double quotes in JSON, not single quotes.');
        if (text[i] !== '"') fail(i >= n ? 'The input ends inside an object. Add the missing "}".' : `Expected a property name in double quotes, found ${describe(text[i])}.`);
        const keyStart = i;
        const key = string();
        if (seen.has(key)) warn(`The key "${key}" appears twice in the same object. JSON.parse keeps only the last value.`, keyStart);
        seen.add(key);
        skip();
        if (text[i] !== ':') fail(`Expected ":" after the property name "${key}", found ${describe(text[i])}.`);
        i++;
        value(`${path}/${escapePointer(key)}`, depth + 1);
        skip();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail(i >= n ? 'The input ends inside an object. Add the missing "}".' : `Expected "," or "}" after a property value, found ${describe(text[i])}.`);
      }
    }
    if (ch === '[') {
      i++;
      skip();
      if (text[i] === ']') { i++; return; }
      let index = 0;
      while (true) {
        skip();
        if (text[i] === ']') fail('Trailing commas are not allowed in JSON. Remove the comma before "]".', i);
        value(`${path}/${index++}`, depth + 1);
        skip();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail(i >= n ? 'The input ends inside an array. Add the missing "]".' : `Expected "," or "]" after an array item, found ${describe(text[i])}.`);
      }
    }
    if (ch === '"') { string(); return; }
    if (ch === "'") fail('Strings need double quotes in JSON, not single quotes.');
    if (ch === '-' || (ch >= '0' && ch <= '9')) { number(); return; }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) { i += word.length; return; }
    }
    const bare = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 40))?.[0];
    if (bare === 'NaN' || bare === 'Infinity') fail(`${bare} is not allowed in JSON. Use null or a string instead.`);
    if (bare === 'True' || bare === 'False' || bare === 'None' || bare === 'TRUE' || bare === 'FALSE' || bare === 'NULL' || bare === 'undefined') {
      fail(`${bare} is not a JSON value. JSON uses lowercase true, false and null.`);
    }
    if (bare) fail(`Unexpected word "${bare}". Text values need double quotes.`);
    if (ch === undefined) fail('The input ends where a value was expected.');
    fail(`Unexpected ${describe(ch)} where a value was expected.`);
  }

  try {
    skip();
    if (i >= n) return { error: { message: 'The input is empty.', offset: 0 }, warnings, paths };
    value('', 0);
    skip();
    if (i < n) fail(`Unexpected ${describe(text[i])} after the end of the JSON value. A JSON text holds one value: wrap several in an array.`);
  } catch (error) {
    if (error && typeof error.offset === 'number') return { error, warnings, paths };
    throw error;
  }
  return { warnings, paths };
}

/**
 * Parses JSON text. Throws a ConvertError with line and column on invalid input.
 * @returns {{ value: unknown, warnings: string[] }}
 */
export function parseJson(input, options = {}) {
  const [text] = stripBom(String(input ?? ''));
  if (!text.trim()) throw emptyInput('json');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    const { error } = scanJson(text);
    const offset = error?.offset ?? 0;
    const { line, column } = lineColumn(text, offset);
    throw new ConvertError(error?.message ?? 'This is not valid JSON.', { line, column, offset, format: 'json' });
  }
  const warnings = [];
  // The grammar walk costs about as much as JSON.parse; skip it for very large inputs.
  if (options.warnings !== false && text.length <= 5_000_000) {
    for (const w of scanJson(text).warnings) {
      const { line, column } = lineColumn(text, w.offset);
      warnings.push(`Line ${line}, column ${column}: ${w.message}`);
    }
  }
  return { value, warnings };
}

/** Recursively sorts object keys (A to Z, by code point). Arrays keep their order. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

const INDENTS = { '2': 2, '4': 4, tab: '\t', '0': 0, min: 0 };

/**
 * Writes a value as JSON. BigInt values (whole numbers beyond 2^53 from TOML) are written as plain digits,
 * so no digit is lost; NaN and Infinity, which JSON cannot hold, are written as strings with a warning.
 * @param {unknown} value
 * @param {{ indent?: string|number, sortKeys?: boolean }} [options]
 * @returns {{ text: string, warnings: string[] }}
 */
export function serializeJson(value, options = {}) {
  const indent = INDENTS[String(options.indent ?? '2')] ?? 2;
  const warnings = [];
  const data = options.sortKeys ? sortKeys(value) : value;
  const bigints = [];
  const marker = '\u0000bigint:';
  const text = JSON.stringify(data, (key, v) => {
    if (typeof v === 'bigint') { bigints.push(v.toString()); return `${marker}${bigints.length - 1}`; }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      const word = Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
      warnings.push(`JSON has no ${word}; the value at "${key}" is written as the string "${word}".`);
      return word;
    }
    return v;
  }, indent) ?? 'null';
  return { text: bigints.length ? text.replace(/"\\u0000bigint:(\d+)"/g, (_, k) => bigints[Number(k)]) : text, warnings };
}

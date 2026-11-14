// TOML 1.0.0, read and written with smol-toml. TOML has no null and a document is always a table, so those
// two cases get an error that says why and what to do instead of a silent change.
import { parse, stringify, TomlError } from 'smol-toml';
import { ConvertError, emptyInput, stripBom } from './errors.mjs';
import { isPlainObject } from './table.mjs';

/**
 * @param {string} input
 * @returns {{ value: unknown, warnings: string[] }}
 */
export function parseToml(input) {
  const [text] = stripBom(String(input ?? ''));
  if (!text.trim()) throw emptyInput('toml');
  try {
    const value = parse(text, { integersAsBigInt: 'asNeeded', unsafeKeyBehaviour: 'drop' });
    return { value: plain(value), warnings: [] };
  } catch (error) {
    if (error instanceof TomlError) {
      const message = String(error.message).split('\n')[0].replace(/^Invalid TOML document: /, '');
      const lineText = text.split('\n')[(error.line ?? 1) - 1] ?? '';
      const atEnd = error.column && error.column > lineText.replace(/\r$/, '').length;
      return fail(plainTomlMessage(message, atEnd), error.line, error.column);
    }
    throw error;
  }
}

function fail(message, line, column) {
  throw new ConvertError(message.endsWith('.') ? message : `${message}.`, { line, column, format: 'toml', code: 'syntax' });
}
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// smol-toml's messages, said plainly, with what to do.
function plainTomlMessage(message, atLineEnd) {
  if (/control characters are not allowed in strings/i.test(message) && atLineEnd) return 'This string is not closed before the end of the line. Add the closing quote, or use triple quotes (""") for text over several lines.';
  if (/unfinished string/i.test(message)) return 'This string is never closed. Add the closing quote.';
  if (/redefine an already defined/i.test(message)) return 'This key or table is already defined. A key can be set only once in a table, and each [table] header can appear only once.';
  if (/must be followed by an end-of-line/i.test(message)) return 'Each key = value pair must be on its own line.';
  if (/^invalid value/i.test(message)) return 'This is not a valid TOML value. Strings need quotes, true and false are lowercase, and dates are written like 2024-03-15.';
  return capitalize(message);
}

// smol-toml builds tables with no prototype; turn them into ordinary objects, keep dates as ISO text in the
// form TOML wrote them (a local date stays "1979-05-27"), and keep BigInt for integers beyond 2^53.
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Date) return typeof value.toISOString === 'function' ? value.toISOString() : String(value);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = plain(value[key]);
    return out;
  }
  return value;
}

/** Path of the first null in a value, or undefined. */
export function findNull(value, path = '') {
  if (value === null || value === undefined) return path || '(the whole document)';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const p = findNull(value[i], `${path}[${i}]`); if (p) return p; }
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
      const p = findNull(v, path ? `${path}.${key}` : key);
      if (p) return p;
    }
  }
  return undefined;
}

/**
 * Writes a value as TOML.
 * @param {unknown} value
 * @param {{ topArray?: 'error'|'wrap', wrapKey?: string, nulls?: 'error'|'omit' }} [options]
 * @returns {{ text: string, warnings: string[] }}
 */
export function serializeToml(value, options = {}) {
  const warnings = [];
  let data = value;
  if (Array.isArray(data)) {
    if (options.topArray === 'wrap') {
      const key = options.wrapKey || 'items';
      data = { [key]: data };
      warnings.push(`TOML cannot hold an array at the top level, so it is stored under the key "${key}".`);
    } else {
      throw new ConvertError('TOML cannot hold an array at the top level: a TOML document is always a table of keys. Wrap the array in an object, as in {"items": [...]}, or choose "Wrap under a key" in the options.', { code: 'toml-array', format: 'toml' });
    }
  }
  if (!isPlainObject(data)) {
    throw new ConvertError(`TOML cannot hold a single ${data === null ? 'null' : typeof data} value: a TOML document is always a table of keys. Wrap it in an object, as in {"value": ...}.`, { code: 'toml-scalar', format: 'toml' });
  }
  const nullPath = findNull(data);
  if (nullPath) {
    if (options.nulls === 'omit') {
      data = dropNulls(data);
      warnings.push(`TOML has no null, so keys whose value is null are left out (the first is ${nullPath}).`);
    } else {
      throw new ConvertError(`TOML has no null value, and ${nullPath} is null. Remove that key, give it a value such as "" or 0, or choose "Leave out null keys" in the options.`, { code: 'toml-null', format: 'toml' });
    }
  }
  return { text: stringify(data), warnings };
}

function dropNulls(value) {
  if (Array.isArray(value)) return value.filter(v => v !== null && v !== undefined).map(dropNulls);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = dropNulls(v);
    return out;
  }
  return value;
}

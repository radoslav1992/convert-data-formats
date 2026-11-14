// Tables: the shape CSV, TSV and Excel share. Turning nested data into rows and columns (flattening),
// and back (nesting), with the rules the converter pages describe.

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/**
 * Makes header names unique and non-empty. Empty headers become "column_3" (by position); a repeated name gets
 * "_2", "_3" and so on. Returns the new headers and a note for every change.
 */
export function uniqueHeaders(raw) {
  const headers = [];
  const notes = [];
  const used = new Set();
  raw.forEach((value, index) => {
    const original = value == null ? '' : String(value);
    let name = original.trim() === '' ? `column_${index + 1}` : original;
    if (name !== original) notes.push(`Column ${index + 1} has no header, so it is named "${name}".`);
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${name}_${k}`)) k++;
      notes.push(`The header "${name}" appears more than once; column ${index + 1} is renamed "${name}_${k}".`);
      name = `${name}_${k}`;
    }
    used.add(name);
    headers.push(name);
  });
  return { headers, notes };
}

/**
 * Turns one record into flat cells: nested objects become dot paths ("address.city"); arrays are joined with
 * a separator (arrays of plain values) or written as JSON text.
 * @param {unknown} record
 * @param {{ arrays?: 'join'|'json', separator?: string }} options
 * @returns {Map<string, unknown>}
 */
export function flattenRecord(record, options = {}) {
  const out = new Map();
  const arrays = options.arrays ?? 'join';
  const separator = options.separator ?? '; ';
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      const simple = value.every(item => item === null || typeof item !== 'object' || item instanceof Date);
      if (arrays === 'join' && simple) out.set(path, value.map(item => (item === null ? '' : cellText(item))).join(separator));
      else out.set(path, JSON.stringify(value, jsonReplacer));
      return;
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) { out.set(path, path ? '{}' : ''); return; }
      for (const key of keys) walk(value[key], path ? `${path}.${key}` : key);
      return;
    }
    out.set(path || 'value', value);
  };
  walk(record, '');
  return out;
}

const jsonReplacer = (key, v) => (typeof v === 'bigint' ? v.toString() : v);

/** The text of one cell: null is empty, booleans are true/false, dates are ISO 8601. */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value, jsonReplacer);
  return String(value);
}

/**
 * Finds the records in a value for a table: an array is used as is; an object whose only key holds an array of
 * objects ({"users": [...]}) uses that array; any other object becomes a single row.
 * @returns {{ records: unknown[], note?: string }}
 */
export function recordsOf(value) {
  if (Array.isArray(value)) return { records: value };
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && Array.isArray(value[keys[0]]) && value[keys[0]].length && value[keys[0]].every(isPlainObject)) {
      return { records: value[keys[0]], note: `The rows are the ${value[keys[0]].length} items of "${keys[0]}".` };
    }
    return { records: [value], note: 'The input is a single object, so the table has one row.' };
  }
  return { records: [value] };
}

/**
 * Builds a table from any value. Columns are the union of all keys in first-seen order.
 * @param {unknown} value
 * @param {{ arrays?: 'join'|'json', separator?: string }} [options]
 * @returns {{ columns: string[], rows: unknown[][], notes: string[] }}
 */
export function toTable(value, options = {}) {
  const { records, note } = recordsOf(value);
  const notes = note ? [note] : [];
  // An array of arrays is already a table: the first row is the header.
  if (records.length && records.every(Array.isArray)) {
    const [head, ...body] = records;
    const width = records.reduce((max, r) => (r.length > max ? r.length : max), 0);
    const { headers, notes: headerNotes } = uniqueHeaders(Array.from({ length: width }, (_, i) => cellText(head[i])));
    return { columns: headers, rows: body.map(r => Array.from({ length: width }, (_, i) => scalarCell(r[i], options))), notes: [...notes, ...headerNotes] };
  }
  const columns = [];
  const index = new Map();
  const flat = records.map(record => {
    const cells = flattenRecord(record, options);
    for (const key of cells.keys()) if (!index.has(key)) { index.set(key, columns.length); columns.push(key); }
    return cells;
  });
  const rows = flat.map(cells => columns.map(column => (cells.has(column) ? cells.get(column) : null)));
  return { columns, rows, notes };
}

function scalarCell(value, options) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return flattenRecord({ v: value }, options).get('v') ?? JSON.stringify(value);
  return value ?? null;
}

/** Rebuilds nested objects from dot-path keys: {"address.city": "Oslo"} becomes {"address": {"city": "Oslo"}}. */
export function nestRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const parts = key.split('.');
    if (parts.some(part => part === '')) { out[key] = value; continue; }
    let target = out;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (target[part] === undefined) target[part] = {};
      else if (!isPlainObject(target[part])) { ok = false; break; }
      target = target[part];
    }
    if (ok && !(parts.at(-1) in target)) target[parts.at(-1)] = value;
    else out[key] = value;
  }
  return out;
}

export { isPlainObject };

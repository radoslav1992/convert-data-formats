// CSV and TSV, read and written with Papa Parse. CSV follows RFC 4180: fields that hold the delimiter, a
// double quote or a line break are wrapped in double quotes, and a double quote inside is doubled.
import Papa from 'papaparse';
import { ConvertError, lineColumn, emptyInput, stripBom } from './errors.mjs';
import { inferValue } from './infer.mjs';
import { uniqueHeaders, nestRecord, toTable, cellText } from './table.mjs';

export const DELIMITERS = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
const DELIMITER_OPTION = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' };

/** Reads an option value ("comma", ",", "tab", "\t") as a delimiter character, or '' for auto-detect. */
export function delimiterOf(option) {
  if (!option || option === 'auto') return '';
  return DELIMITER_OPTION[option] ?? (option === '\\t' ? '\t' : option);
}

/**
 * Splits delimited text into rows of strings.
 * @param {string} input
 * @param {{ delimiter?: string, format?: 'csv'|'tsv' }} [options]
 * @returns {{ rows: string[][], delimiter: string, bom: boolean, lineBreak: string, warnings: string[] }}
 */
export function parseRows(input, options = {}) {
  const format = options.format ?? 'csv';
  const [text, bom] = stripBom(String(input ?? ''));
  if (!text.trim()) throw emptyInput(format);
  const fixed = delimiterOf(options.delimiter) || (format === 'tsv' ? '\t' : '');
  const result = Papa.parse(text, {
    delimiter: fixed,
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: true,
    header: false,
  });
  const warnings = [];
  for (const error of result.errors) {
    if (error.code === 'UndetectableDelimiter') continue;
    if (error.code === 'MissingQuotes') {
      const offset = findOpenQuote(text, result.meta.delimiter, error.index);
      const { line, column } = lineColumn(text, offset);
      throw new ConvertError('A quoted field is never closed: the opening double quote here has no closing quote. Add the closing quote, or double any quote inside the field ("").', { line, column, offset, format, code: 'syntax' });
    }
    if (error.code === 'InvalidQuotes') {
      const where = typeof error.index === 'number' ? lineColumn(text, error.index) : null;
      warnings.push(`${where ? `Line ${where.line}: ` : ''}a double quote inside a quoted field is not doubled. Write "" for a quote inside quotes.`);
      continue;
    }
    if (warnings.length < 20) warnings.push(error.message);
  }
  let delimiter = result.meta.delimiter;
  // A single column has no delimiter to detect; Papa Parse then reports a comma, which is the right answer.
  if (!delimiter) delimiter = format === 'tsv' ? '\t' : ',';
  return { rows: result.data, delimiter, bom, lineBreak: result.meta.linebreak ?? '\n', warnings };
}

// Papa Parse reports the end of the input for an unclosed quote; the useful position is where it opened.
function findOpenQuote(text, delimiter, index) {
  let inQuotes = false;
  let open = -1;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { i++; continue; }
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"' && fieldStart) { inQuotes = true; open = i; fieldStart = false; continue; }
    fieldStart = ch === delimiter || ch === '\n' || ch === '\r';
  }
  return inQuotes && open >= 0 ? open : Math.max(0, Math.min(index ?? 0, text.length));
}

/**
 * Parses CSV or TSV into an array of objects (first row as headers) or an array of arrays.
 * @param {string} input
 * @param {{ format?: 'csv'|'tsv', delimiter?: string, header?: boolean, inferTypes?: boolean, emptyAsNull?: boolean, nest?: boolean }} [options]
 */
export function parseCsv(input, options = {}) {
  const { rows, delimiter, bom, lineBreak, warnings } = parseRows(input, options);
  const header = options.header !== false;
  const infer = options.inferTypes !== false;
  const emptyAsNull = options.emptyAsNull === true;
  // Types are decided per column, not per cell: a column becomes numbers (or true/false) only when every
  // non-empty value in it converts the same way. One value that must stay text, such as a zip code with a
  // leading zero, keeps the whole column as text, so no column mixes strings and numbers.
  const typed = [];
  const empty = () => (emptyAsNull ? null : '');
  const cell = (text, c) => (text === '' ? empty() : typed[c] ? inferValue(text) : text);
  const meta = { delimiter, delimiterName: DELIMITERS[delimiter] ?? delimiter, bom, lineBreak: lineBreak === '\r\n' ? 'CRLF' : lineBreak === '\r' ? 'CR' : 'LF', rows: 0, columns: 0, ragged: 0 };
  if (!header) {
    const width = widest(rows, 0);
    if (infer) decideColumnTypes(rows, width, typed, c => `column ${c + 1}`, warnings);
    meta.rows = rows.length;
    meta.columns = width;
    return { value: rows.map(r => r.map((text, c) => cell(text, c))), meta, warnings };
  }
  const [first = [], ...body] = rows;
  const { headers, notes } = uniqueHeaders(first);
  warnings.push(...notes);
  if (infer) {
    const width = widest(body, headers.length);
    decideColumnTypes(body, width, typed, c => (c < headers.length ? `"${headers[c]}"` : `column ${c + 1}`), warnings);
  }
  const ragged = [];
  const columns = [...headers];
  const value = body.map((row, index) => {
    if (row.length !== headers.length) ragged.push([index + 2, row.length]);
    const record = {};
    const width = Math.max(row.length, headers.length);
    for (let c = 0; c < width; c++) {
      if (c >= columns.length) columns.push(uniqueExtra(columns, c));
      record[columns[c]] = c < row.length ? cell(row[c], c) : empty();
    }
    return options.nest ? nestRecord(record) : record;
  });
  if (ragged.length) {
    const list = ragged.slice(0, 5).map(([n, count]) => `row ${n} has ${count}`).join(', ');
    warnings.push(`${ragged.length} row${ragged.length === 1 ? '' : 's'} ${ragged.length === 1 ? 'does' : 'do'} not have ${headers.length} field${headers.length === 1 ? '' : 's'} like the header (${list}${ragged.length > 5 ? ', …' : ''}). Missing fields are left empty${columns.length > headers.length ? `; extra fields go into ${columns.slice(headers.length).map(c => `"${c}"`).join(', ')}` : ''}.`);
  }
  meta.rows = body.length;
  meta.columns = columns.length;
  meta.ragged = ragged.length;
  meta.headers = columns;
  return { value, meta, warnings };
}

/** The longest row length, at least `min`. A loop, because spreading a huge array into Math.max overflows the stack. */
function widest(rows, min) {
  let width = min;
  for (const row of rows) if (row.length > width) width = row.length;
  return width;
}

/**
 * Decides, for each column, whether its values are converted to numbers, booleans and null (true) or kept as
 * text (false). A column is converted only when all its non-empty values infer to one kind; "null" fits any
 * kind. When some values would convert and others would not, the column stays text and a warning says why.
 */
function decideColumnTypes(rows, width, typed, name, warnings) {
  const mixed = [];
  for (let c = 0; c < width; c++) {
    let kind = null, ok = true, converted = 0, example = null;
    for (const row of rows) {
      const text = row[c];
      if (text === undefined || text === '') continue;
      const value = inferValue(text);
      if (value === null) { converted++; continue; }
      const k = typeof value;
      if (k === 'string') { ok = false; example ??= text; continue; }
      converted++;
      if (kind === null) kind = k;
      else if (kind !== k) { ok = false; example ??= text; }
    }
    typed[c] = ok;
    if (!ok && converted > 0) mixed.push([name(c), example]);
  }
  if (mixed.length) {
    const list = mixed.slice(0, 4).map(([n, ex]) => `${n} (because of ${JSON.stringify(ex)})`).join(', ');
    warnings.push(`${mixed.length === 1 ? 'One column stays' : `${mixed.length} columns stay`} text so that each column keeps a single type: ${list}${mixed.length > 4 ? ', …' : ''}.`);
  }
}

function uniqueExtra(columns, index) {
  let name = `field_${index + 1}`;
  while (columns.includes(name)) name += '_';
  return name;
}

const LINE_ENDINGS = { crlf: '\r\n', lf: '\n' };

/**
 * Writes a table, or any value (flattened with toTable), as CSV or TSV.
 * @param {unknown} value
 * @param {{ format?: 'csv'|'tsv', delimiter?: string, lineEnding?: 'crlf'|'lf', bom?: boolean, arrays?: 'join'|'json', separator?: string, tsvMode?: 'quote'|'replace', header?: boolean }} [options]
 * @returns {{ text: string, warnings: string[], table: { columns: string[], rows: unknown[][] } }}
 */
export function serializeCsv(value, options = {}) {
  const format = options.format ?? 'csv';
  const delimiter = format === 'tsv' ? '\t' : delimiterOf(options.delimiter) || ',';
  const newline = LINE_ENDINGS[options.lineEnding ?? 'crlf'] ?? '\r\n';
  const table = value && value.columns && value.rows ? value : toTable(value, options);
  const warnings = [...(table.notes ?? [])];
  const head = options.header === false ? [] : [table.columns];
  const body = table.rows.map(row => row.map(cellText));
  let text;
  if (format === 'tsv' && options.tsvMode === 'replace') {
    let changed = 0;
    const clean = s => { const t = s.replace(/\r\n|[\t\r\n]/g, ' '); if (t !== s) changed++; return t; };
    text = [...head, ...body].map(row => row.map(clean).join('\t')).join(newline);
    if (changed) warnings.push(`${changed} field${changed === 1 ? '' : 's'} had tabs or line breaks, replaced with spaces.`);
  } else {
    text = Papa.unparse([...head, ...body], { delimiter, newline, quotes: false, escapeFormulae: false });
  }
  if (table.rows.length || head.length) text += newline;
  if (options.bom) text = '﻿' + text;
  return { text, warnings, table };
}

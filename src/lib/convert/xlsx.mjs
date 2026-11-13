// Excel workbooks (.xlsx, Office Open XML: ECMA-376 / ISO/IEC 29500), read with read-excel-file and written
// with write-excel-file. Both run in the browser and in Node. Only cell values travel: styles, formulas (a
// formula cell gives the value Excel last calculated), merged cells, comments and charts are not kept.
import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { ConvertError } from './errors.mjs';
import { uniqueHeaders, toTable, nestRecord } from './table.mjs';

export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
export const MAX_CELL = 32_767;

async function bytesOf(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  if (input && typeof input.arrayBuffer === 'function') return input.arrayBuffer();
  throw new ConvertError('Open an .xlsx file to convert it. Excel workbooks cannot be pasted as text.', { code: 'xlsx-input', format: 'xlsx' });
}

/** Excel dates as ISO 8601: "2024-03-15" for a date alone, "2024-03-15T13:45:00" with a time. */
export function isoDate(date) {
  const iso = date.toISOString();
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return iso.replace(/\.000Z$/, '').replace(/Z$/, '');
}

/** A cell value as plain data. Numbers keep 15 significant digits, the precision Excel itself works with. */
export function cellValue(value) {
  if (value instanceof Date) return isoDate(value);
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toPrecision(15));
  return value ?? null;
}

/**
 * Reads every sheet of a workbook.
 * @returns {Promise<{ name: string, data: unknown[][] }[]>}
 */
export async function readWorkbook(input) {
  const buffer = await bytesOf(input);
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new ConvertError('This is an old-style .xls workbook (Excel 97-2003), which this tool cannot read. Open it in Excel or LibreOffice and save it as .xlsx first.', { code: 'xls', format: 'xlsx' });
  }
  if (!(head[0] === 0x50 && head[1] === 0x4b)) {
    throw new ConvertError('This file is not an .xlsx workbook (an .xlsx file is a ZIP package, and this one is not). If it is a CSV file, use the CSV converters instead.', { code: 'xlsx-invalid', format: 'xlsx' });
  }
  try {
    const sheets = await readXlsxFile(buffer, { trim: false });
    return sheets.map(sheet => ({ name: sheet.sheet, data: sheet.data }));
  } catch (error) {
    throw new ConvertError(`The workbook could not be read: ${error?.message ?? error}. If it is password-protected, remove the password in Excel and save it again.`, { code: 'xlsx-invalid', format: 'xlsx' });
  }
}

/**
 * Reads one sheet of a workbook as an array of objects (first row as headers) or an array of arrays.
 * @param {ArrayBuffer|Uint8Array|Blob} input
 * @param {{ sheet?: string|number, header?: boolean, skipEmptyRows?: boolean, nest?: boolean }} [options]
 */
export async function parseXlsx(input, options = {}) {
  const sheets = await readWorkbook(input);
  if (!sheets.length) throw new ConvertError('The workbook has no sheets.', { code: 'xlsx-empty', format: 'xlsx' });
  let sheet = sheets[0];
  if (options.sheet !== undefined && options.sheet !== '') {
    sheet = typeof options.sheet === 'number' ? sheets[options.sheet] : sheets.find(s => s.name === options.sheet);
    if (!sheet) throw new ConvertError(`There is no sheet named "${options.sheet}". The sheets are: ${sheets.map(s => s.name).join(', ')}.`, { code: 'xlsx-sheet', format: 'xlsx' });
  }
  const warnings = [];
  let rows = sheet.data.map(row => row.map(cellValue));
  if (options.skipEmptyRows !== false) rows = rows.filter(row => row.some(v => v !== null && v !== ''));
  const meta = { sheets: sheets.map(s => s.name), sheet: sheet.name, rows: 0, columns: 0 };
  if (sheets.length > 1) warnings.push(`The workbook has ${sheets.length} sheets; this is "${sheet.name}". Choose another sheet in the options.`);
  if (!rows.length) {
    warnings.push(`The sheet "${sheet.name}" is empty.`);
    return { value: [], meta, warnings };
  }
  const width = Math.max(...rows.map(r => r.length));
  if (options.header === false) {
    meta.rows = rows.length;
    meta.columns = width;
    return { value: rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? null)), meta, warnings };
  }
  const [first, ...body] = rows;
  const { headers, notes } = uniqueHeaders(Array.from({ length: width }, (_, i) => (first[i] == null ? '' : String(first[i]))));
  warnings.push(...notes);
  const value = body.map(row => {
    const record = {};
    headers.forEach((h, i) => { record[h] = row[i] ?? null; });
    return options.nest ? nestRecord(record) : record;
  });
  meta.rows = body.length;
  meta.columns = headers.length;
  meta.headers = headers;
  return { value, meta, warnings };
}

/** A valid sheet name: at most 31 characters, none of : \ / ? * [ ]. */
export function sheetName(name) {
  const clean = String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return clean || 'Sheet1';
}

/**
 * Writes a value as a one-sheet workbook. Numbers and booleans become number and boolean cells; text stays
 * text, so "007" keeps its zeros.
 * @param {unknown} value
 * @param {{ sheetName?: string, arrays?: 'join'|'json', separator?: string }} [options]
 * @returns {Promise<{ blob: Blob, bytes: Uint8Array, warnings: string[], table: { columns: string[], rows: unknown[][] } }>}
 */
export async function serializeXlsx(value, options = {}) {
  const table = value && value.columns && value.rows ? value : toTable(value, options);
  const warnings = [...(table.notes ?? [])];
  if (table.rows.length + 1 > MAX_ROWS) throw new ConvertError(`Excel sheets hold at most ${MAX_ROWS.toLocaleString('en-US')} rows, and this data has ${(table.rows.length + 1).toLocaleString('en-US')} with the header. Split it into smaller files first.`, { code: 'xlsx-rows', format: 'xlsx' });
  if (table.columns.length > MAX_COLUMNS) throw new ConvertError(`Excel sheets hold at most ${MAX_COLUMNS.toLocaleString('en-US')} columns, and this data has ${table.columns.length.toLocaleString('en-US')}.`, { code: 'xlsx-columns', format: 'xlsx' });
  let cut = 0;
  const cell = v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
    if (typeof v === 'boolean') return v;
    let text = typeof v === 'bigint' ? v.toString() : String(v);
    if (text.length > MAX_CELL) { text = text.slice(0, MAX_CELL); cut++; }
    return text;
  };
  const header = table.columns.map(c => ({ value: String(c).slice(0, MAX_CELL), fontWeight: 'bold' }));
  const data = [header, ...table.rows.map(row => row.map(cell))];
  const widths = table.columns.map((c, i) => {
    let w = String(c).length;
    for (let r = 0; r < Math.min(table.rows.length, 200); r++) w = Math.max(w, String(table.rows[r][i] ?? '').length);
    return { width: Math.min(Math.max(w + 2, 8), 60) };
  });
  if (cut) warnings.push(`${cut} cell${cut === 1 ? ' was' : 's were'} longer than Excel's limit of 32,767 characters and ${cut === 1 ? 'was' : 'were'} cut.`);
  const blob = await writeXlsxFile(data, { sheet: sheetName(options.sheetName), columns: widths, stickyRowsCount: 1 }).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, warnings, table };
}

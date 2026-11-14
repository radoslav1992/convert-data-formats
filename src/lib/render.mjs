// Build-time helpers: the pages run the real engine on their samples and examples, so what a page shows
// before any script runs is exactly what the tool produces.
import fs from 'node:fs';
import path from 'node:path';
import { convert, parse } from './convert/index.mjs';

/** Line numbers for a text: "1\n2\n3". */
export function numbers(text) {
  const count = String(text ?? '').split('\n').length;
  return Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

/** The bytes of a file in public/ (sample workbooks). */
export function publicFile(file) {
  return fs.readFileSync(path.join(process.cwd(), 'public', file.replace(/^\//, '')));
}

/** Converts at build time. Returns the result, or the error (as the page would show it). */
export async function run(from, to, input, options = {}) {
  try {
    const result = await convert(from, to, input, options);
    const table = result.table ? { columns: result.table.columns, rows: result.table.rows.slice(0, 50) } : undefined;
    return { ok: true, text: result.text, table, warnings: result.warnings, stats: result.stats, meta: result.meta };
  } catch (error) {
    if (error?.name !== 'ConvertError') throw error;
    return { ok: false, error: { message: error.message, display: error.display, line: error.line, column: error.column, code: error.code } };
  }
}

/** The first rows of a workbook sheet, for previews. */
export async function workbookGrid(bytes, options = {}) {
  const { value, meta } = await parse('xlsx', bytes, { ...options, header: false });
  return { grid: value, sheets: meta.sheets, sheet: meta.sheet };
}

/**
 * Writes rows (first row = header) as workbook bytes, for examples whose input is a sheet. `sheets` may be
 * [[name, rows], ...] for a workbook with several sheets. Date objects become date cells.
 */
export async function gridToWorkbook(sheets) {
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const list = Array.isArray(sheets[0]?.[1]) && typeof sheets[0][0] === 'string' ? sheets : [['Sheet1', sheets]];
  const cell = v => (v instanceof Date ? { value: v, type: Date, format: 'yyyy-mm-dd' } : v);
  const blob = await writeXlsxFile(list.map(([name, rows]) => ({ sheet: name, data: rows.map(r => r.map(cell)) }))).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

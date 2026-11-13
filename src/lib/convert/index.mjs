// The conversion engine: parse(format, input, options) to plain data, serialize(format, value, options) back
// to text (or workbook bytes), detect(text), and convert(from, to, input, options), which adds the per-pair
// rules (XML records to rows, rows to XML elements, tables copied cell for cell between CSV, TSV and Excel).
// Format modules load on demand, so a page only downloads the libraries its formats need.
import { ConvertError } from './errors.mjs';
import { detect } from './detect.mjs';
import { inferValue } from './infer.mjs';

export { ConvertError, detect };

export const FORMATS = {
  csv: { id: 'csv', name: 'CSV', slug: 'csv', ext: 'csv', mime: 'text/csv', accept: '.csv,.txt,text/csv' },
  tsv: { id: 'tsv', name: 'TSV', slug: 'tsv', ext: 'tsv', mime: 'text/tab-separated-values', accept: '.tsv,.tab,.txt,text/tab-separated-values' },
  json: { id: 'json', name: 'JSON', slug: 'json', ext: 'json', mime: 'application/json', accept: '.json,application/json' },
  yaml: { id: 'yaml', name: 'YAML', slug: 'yaml', ext: 'yaml', mime: 'application/yaml', accept: '.yaml,.yml' },
  xml: { id: 'xml', name: 'XML', slug: 'xml', ext: 'xml', mime: 'application/xml', accept: '.xml,application/xml,text/xml' },
  toml: { id: 'toml', name: 'TOML', slug: 'toml', ext: 'toml', mime: 'application/toml', accept: '.toml' },
  xlsx: { id: 'xlsx', name: 'Excel', slug: 'excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', binary: true },
};

export const TABULAR = new Set(['csv', 'tsv', 'xlsx']);
export const formatBySlug = slug => Object.values(FORMATS).find(f => f.slug === slug);

const load = {
  csv: () => import('./csv.mjs'),
  json: () => import('./json.mjs'),
  yaml: () => import('./yaml.mjs'),
  xml: () => import('./xml.mjs'),
  toml: () => import('./toml.mjs'),
  xlsx: () => import('./xlsx.mjs'),
};
const moduleFor = format => (format === 'tsv' ? load.csv() : load[format]?.());

/**
 * Parses text (or workbook bytes) into plain data.
 * @returns {Promise<{ value: unknown, warnings: string[], meta?: object }>}
 */
export async function parse(format, input, options = {}) {
  const mod = await moduleFor(format);
  switch (format) {
    case 'csv': case 'tsv': return mod.parseCsv(input, { ...options, format });
    case 'json': return mod.parseJson(input, options);
    case 'yaml': return mod.parseYaml(input, options);
    case 'xml': return mod.parseXml(input, options);
    case 'toml': return mod.parseToml(input, options);
    case 'xlsx': return mod.parseXlsx(input, options);
    default: throw new ConvertError(`Unknown format "${format}".`, { code: 'format' });
  }
}

/**
 * Writes plain data in a format. Text formats return { text }, Excel returns { bytes, blob }.
 * @returns {Promise<{ text?: string, bytes?: Uint8Array, blob?: Blob, warnings: string[], table?: object }>}
 */
export async function serialize(format, value, options = {}) {
  const mod = await moduleFor(format);
  switch (format) {
    case 'csv': return mod.serializeCsv(value, { ...options, format, delimiter: options.outDelimiter ?? 'comma' });
    case 'tsv': return mod.serializeCsv(value, { ...options, format });
    case 'json': return mod.serializeJson(value, options);
    case 'yaml': return mod.serializeYaml(value, { ...options, indent: options.yamlIndent ?? 2 });
    case 'xml': return mod.serializeXml(value, options);
    case 'toml': return mod.serializeToml(value, options);
    case 'xlsx': return mod.serializeXlsx(value, options);
    default: throw new ConvertError(`Unknown format "${format}".`, { code: 'format' });
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const byteLength = input => (typeof input === 'string' ? new TextEncoder().encode(input).length : input?.byteLength ?? input?.size ?? 0);

/**
 * Converts input from one format to another.
 * @param {string} from format id
 * @param {string} to format id
 * @param {string|ArrayBuffer|Uint8Array|Blob} input
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<{ text?: string, bytes?: Uint8Array, blob?: Blob, warnings: string[], stats: { inputBytes: number, outputBytes: number, rows?: number, columns?: number, ms: number }, meta?: object, table?: object }>}
 */
export async function convert(from, to, input, options = {}) {
  const start = now();
  const warnings = [];
  let value;
  let meta = {};
  let table;

  if (TABULAR.has(from) && TABULAR.has(to)) {
    // Table to table: the grid is copied cell for cell; nothing is renamed or reshaped.
    let grid;
    if (from === 'xlsx') {
      const result = await parse('xlsx', input, { ...options, header: false });
      grid = result.value;
      meta = result.meta;
      warnings.push(...result.warnings);
    } else {
      const { parseRows } = await load.csv();
      const result = parseRows(input, { delimiter: options.delimiter, format: from });
      grid = result.rows;
      meta = { delimiter: result.delimiter, delimiterName: { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[result.delimiter], bom: result.bom };
      warnings.push(...result.warnings);
      if (to === 'xlsx' && options.inferTypes !== false) grid = grid.map((row, r) => (r === 0 ? row : row.map(cell => (cell === '' ? null : inferValue(cell)))));
    }
    const width = Math.max(0, ...grid.map(r => r.length));
    const [head = [], ...body] = grid;
    table = { columns: Array.from({ length: width }, (_, i) => head[i] ?? ''), rows: body.map(r => Array.from({ length: width }, (_, i) => r[i] ?? null)) };
    meta.rows = body.length;
    meta.columns = width;
    const out = await serialize(to, table, options);
    warnings.push(...out.warnings);
    return finish(out, warnings, input, start, meta, table);
  }

  const parsed = await parse(from, input, options);
  warnings.push(...parsed.warnings);
  meta = parsed.meta ?? {};
  value = parsed.value;

  if (from === 'xml' && TABULAR.has(to)) {
    const { findRecords } = await load.xml();
    const { records, path } = findRecords(value, String(options.recordName ?? '').trim());
    if (path) warnings.push(`Each <${path.split('.').at(-1)}> element is one row (${records.length} found at ${path.split('.').join(' › ')}).`);
    value = records;
  }

  if (TABULAR.has(from) && to === 'xml') {
    const rootName = options.rootName || 'rows';
    const itemName = options.itemName || 'row';
    const rows = Array.isArray(value) ? value : [value];
    value = { [rootName]: { [itemName]: rows.map(r => (Array.isArray(r) ? { [options.cellName || 'cell']: r } : r)) } };
    const out = await serialize('xml', value, { ...options, rootName: '', itemName: options.cellName || 'cell' });
    warnings.push(...out.warnings);
    return finish(out, warnings, input, start, meta);
  }

  const out = await serialize(to, value, options);
  warnings.push(...out.warnings);
  if (out.table) {
    meta.rows = out.table.rows.length;
    meta.columns = out.table.columns.length;
  }
  return finish(out, warnings, input, start, meta, out.table);
}

function finish(out, warnings, input, start, meta, table) {
  const outputBytes = out.bytes ? out.bytes.byteLength : byteLength(out.text ?? '');
  return {
    text: out.text,
    bytes: out.bytes,
    blob: out.blob,
    warnings: [...new Set(warnings)],
    meta,
    table,
    stats: { inputBytes: byteLength(input), outputBytes, rows: meta.rows, columns: meta.columns, ms: Math.round(now() - start) },
  };
}

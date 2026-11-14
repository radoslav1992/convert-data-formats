// Every converter option: its label, control and default. The pages render the controls from this list,
// the browser code reads them back by name, and the engine (src/lib/convert) receives them as one object.

export const OPTION_DEFS = {
  delimiter: { label: 'Delimiter', type: 'select', default: 'auto', choices: [['auto', 'Detect'], ['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab'], ['pipe', 'Pipe |']] },
  header: { label: 'First row is the header', type: 'checkbox', default: true },
  inferTypes: { label: 'Detect numbers, true/false and null', type: 'checkbox', default: true },
  emptyAsNull: { label: 'Empty cells become null', type: 'checkbox', default: false },
  nest: { label: 'Nest dot-path headers (address.city)', type: 'checkbox', default: false },
  multiDoc: { label: 'Several YAML documents', type: 'select', default: 'array', choices: [['array', 'Make an array'], ['first', 'Use the first only']] },
  attrPrefix: { label: 'Attribute prefix', type: 'select', default: '@', choices: [['@', '@ (at sign)'], ['_', '_ (underscore)'], ['$', '$ (dollar)'], ['-', '- (hyphen)']] },
  recordName: { label: 'Record element', type: 'text', default: '', placeholder: 'Found automatically' },
  sheet: { label: 'Sheet', type: 'sheet', default: '' },
  indent: { label: 'Indent', type: 'select', default: '2', choices: [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab'], ['0', 'None (minified)']] },
  sortKeys: { label: 'Sort keys A to Z', type: 'checkbox', default: false },
  yamlIndent: { label: 'Indent', type: 'select', default: '2', choices: [['2', '2 spaces'], ['4', '4 spaces']] },
  quoteYaml11: { label: 'Quote yes, no, on, off and dates for YAML 1.1 tools', type: 'checkbox', default: true },
  rootName: { label: 'Root element', type: 'text', default: '', placeholder: 'Automatic' },
  itemName: { label: 'Element for array items', type: 'text', default: 'item' },
  declaration: { label: 'Add the XML declaration', type: 'checkbox', default: true },
  outDelimiter: { label: 'Delimiter', type: 'select', default: 'comma', choices: [['comma', 'Comma ,'], ['semicolon', 'Semicolon ;'], ['tab', 'Tab'], ['pipe', 'Pipe |']] },
  arrays: { label: 'Arrays', type: 'select', default: 'join', choices: [['join', 'Join the values'], ['json', 'Write as JSON']] },
  separator: { label: 'Join arrays with', type: 'text', default: '; ' },
  bom: { label: 'Add a BOM so Excel reads UTF-8', type: 'checkbox', default: false },
  lineEnding: { label: 'Line endings', type: 'select', default: 'crlf', choices: [['crlf', 'CRLF (RFC 4180, Windows)'], ['lf', 'LF (Unix, macOS)']] },
  tsvMode: { label: 'Tabs and line breaks in a field', type: 'select', default: 'quote', choices: [['quote', 'Quote the field'], ['replace', 'Replace with a space']] },
  topArray: { label: 'Array at the top level', type: 'select', default: 'error', choices: [['error', 'Show an error'], ['wrap', 'Wrap it under "items"']] },
  nulls: { label: 'Null values', type: 'select', default: 'error', choices: [['error', 'Show an error'], ['omit', 'Leave out null keys']] },
  sheetName: { label: 'Sheet name', type: 'text', default: 'Sheet1' },
};

/** Default values for a list of option names, with per-page overrides. */
export function optionDefaults(names, overrides = {}) {
  const out = {};
  for (const name of names) out[name] = name in overrides ? overrides[name] : OPTION_DEFS[name].default;
  return out;
}

/** A short description of an option value, for the pages ("Delimiter: Detect"). */
export function describeOption(name, value) {
  const def = OPTION_DEFS[name];
  if (!def) return `${name}: ${value}`;
  if (def.type === 'checkbox') return `${def.label}: ${value ? 'on' : 'off'}`;
  const choice = def.choices?.find(([v]) => v === String(value));
  return `${def.label}: ${choice ? choice[1] : JSON.stringify(value)}`;
}

const TABLES = new Set(['csv', 'tsv', 'xlsx']);
const PARSE = { csv: ['delimiter', 'header', 'inferTypes', 'emptyAsNull', 'nest'], tsv: ['header', 'inferTypes', 'emptyAsNull', 'nest'], json: [], yaml: ['multiDoc'], xml: ['attrPrefix', 'inferTypes'], toml: [], xlsx: ['sheet', 'header', 'nest'] };
const WRITE = { csv: ['outDelimiter', 'arrays', 'separator', 'bom', 'lineEnding'], tsv: ['arrays', 'separator', 'tsvMode', 'lineEnding'], json: ['indent', 'sortKeys'], yaml: ['yamlIndent', 'quoteYaml11'], xml: ['rootName', 'itemName', 'attrPrefix', 'declaration', 'indent'], toml: ['topArray', 'nulls'], xlsx: ['sheetName', 'arrays', 'separator'] };

/** The options that matter for a conversion, in the order they are shown. */
export function optionsFor(from, to) {
  if (TABLES.has(from) && TABLES.has(to)) {
    // Table to table: cells are copied as they are.
    const list = [];
    if (from === 'csv') list.push('delimiter');
    if (from === 'xlsx') list.push('sheet');
    if (to === 'xlsx' && from !== 'xlsx') list.push('inferTypes');
    if (to === 'csv') list.push('outDelimiter', 'bom', 'lineEnding');
    if (to === 'tsv') list.push('tsvMode', 'lineEnding');
    if (to === 'xlsx') list.push('sheetName');
    return list;
  }
  let parse = PARSE[from] ?? [];
  let write = WRITE[to] ?? [];
  if (TABLES.has(from) && to === 'xml') write = write.filter(name => name !== 'attrPrefix');
  if (from === 'xml' && TABLES.has(to)) parse = ['recordName', ...parse];
  if (TABLES.has(to)) write = write.filter(name => !(name === 'arrays' || name === 'separator') || from !== 'xlsx');
  // Into CSV, TSV or XML every value is written as text again, so typing it on the way in changes nothing.
  if (to === 'csv' || to === 'tsv' || to === 'xml') parse = parse.filter(name => name !== 'inferTypes' && name !== 'emptyAsNull');
  return [...new Set([...parse, ...write])];
}

/** Defaults that differ by conversion (CSV rows become <row> elements inside <rows>, and so on). */
export function pairDefaults(from, to) {
  const out = {};
  if (TABLES.has(from) && to === 'xml') Object.assign(out, { rootName: 'rows', itemName: 'row', nest: true });
  return out;
}

/** Labels that read better for a given conversion. */
export function pairLabels(from, to) {
  if (TABLES.has(from) && to === 'xml') return { rootName: 'Root element', itemName: 'Element for each row' };
  return {};
}

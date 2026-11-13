// Guesses the format of pasted text or an opened file. Cheap checks first (the first character, the file
// signature), then trial parses. Returns null when nothing fits.
import { stripBom } from './errors.mjs';

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * @param {string|Uint8Array|ArrayBuffer} input
 * @param {{ fileName?: string }} [options]
 * @returns {{ format: 'csv'|'tsv'|'json'|'yaml'|'xml'|'toml'|'xlsx', reason: string } | null}
 */
export function detect(input, options = {}) {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (ZIP.every((b, i) => bytes[i] === b)) return { format: 'xlsx', reason: 'The file is a ZIP package, as .xlsx workbooks are.' };
    input = new TextDecoder().decode(bytes.subarray(0, 2_000_000));
  }
  const [text] = stripBom(String(input ?? ''));
  const ext = /\.([a-z]+)$/i.exec(options.fileName ?? '')?.[1]?.toLowerCase();
  const byExt = { csv: 'csv', tsv: 'tsv', tab: 'tsv', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml', xlsx: 'xlsx' }[ext ?? ''];
  if (byExt && byExt !== 'xlsx') return { format: byExt, reason: `The file name ends in .${ext}.` };
  const t = text.trimStart();
  if (!t) return null;
  const sample = t.slice(0, 200_000);
  const c = t[0];
  if (c === '{' || c === '[') {
    if (looksLikeJson(t)) return { format: 'json', reason: `It starts with "${c}" and parses as JSON.` };
    if (c === '[' && looksLikeToml(sample)) return { format: 'toml', reason: 'It has [table] headers and key = value lines.' };
    if (c === '{' || /^\[\s*[{["\d\-tfn]/.test(t)) return { format: 'json', reason: `It starts with "${c}", like JSON (it has an error, shown below).` };
  }
  if (c === '<') return { format: 'xml', reason: 'It starts with "<", like XML.' };
  if (looksLikeToml(sample)) return { format: 'toml', reason: 'It has key = value lines, like TOML.' };
  const delimited = delimiterGuess(sample);
  if (delimited === '\t') return { format: 'tsv', reason: 'Every line has the same number of tabs.' };
  const firstLine = sample.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#')) ?? '';
  const yamlish = /^(?:%YAML|---|-(?:\s|$)|[\w"'][^,:\n]*:(?:\s|$))/.test(firstLine.trim()) || t.startsWith('#');
  if (yamlish) return { format: 'yaml', reason: 'It has "key: value" lines or a "---" marker, like YAML.' };
  if (delimited) return { format: 'csv', reason: `Every line has the same number of ${delimited === ',' ? 'commas' : delimited === ';' ? 'semicolons' : 'pipes'}.` };
  return null;
}

function looksLikeJson(text) {
  try { JSON.parse(text); return true; } catch { return false; }
}

function looksLikeToml(sample) {
  const lines = sample.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 30);
  if (!lines.length) return false;
  const table = /^\[\[?[A-Za-z0-9_."' -]+\]\]?$/;
  const pair = /^[A-Za-z0-9_."'-]+(?:\s*\.\s*[A-Za-z0-9_"'-]+)*\s*=\s*\S/;
  const good = lines.filter(l => table.test(l) || pair.test(l)).length;
  return good >= Math.max(1, Math.ceil(lines.length * 0.8)) && lines.some(l => pair.test(l));
}

/** The delimiter that splits the first lines into the same number (2 or more) of fields, or ''. */
export function delimiterGuess(sample) {
  const lines = sample.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  if (!lines.length) return '';
  let best = '';
  let bestFields = 1;
  for (const d of ['\t', ',', ';', '|']) {
    const counts = lines.map(l => splitCount(l, d));
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter(n => n === first).length / counts.length;
    if (consistent >= (lines.length > 2 ? 0.8 : 1) && first > bestFields) { best = d; bestFields = first; }
  }
  return best;
}

function splitCount(line, d) {
  let n = 1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === d && !quoted) n++;
  }
  return n;
}

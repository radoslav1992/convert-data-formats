// CSV viewer: paste or open CSV or TSV and see it as a table, sorted by any column. Counts rows and columns
// and names the delimiter it found. The first 1,000 rows of the current order are drawn; sorting uses all rows.
import { codeArea, readFile, enableDrop, formatBytes, formatCount, announce, debounce } from './ui';
import { runRows } from './runner';
import { track } from '../lib/analytics';

const MAX_DRAWN = 1000;
const NAMES: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };

export function initCsvViewer(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const area = codeArea($('[data-code-area]'));
  const status = $('[data-status]');
  const summary = $('[data-summary]');
  const tableWrap = $('[data-table]');
  const messages = $('[data-messages]');
  const delimiter = $<HTMLSelectElement>('[data-delimiter]');
  const header = $<HTMLInputElement>('[data-header]');
  const samples: { label: string; text: string }[] = JSON.parse(root.dataset.samples ?? '[]');
  let text = area.textarea.value;
  let fileSize = 0;
  let head: string[] = [];
  let body: string[][] = [];
  let sortCol = -1;
  let sortDir: 'ascending' | 'descending' | 'none' = 'none';
  let run = 0;

  const isNumber = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
  const compare = (a: string, b: string) => (isNumber(a) && isNumber(b) ? Number(a) - Number(b) : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  function draw() {
    const order = body.map((row, i) => i);
    if (sortCol >= 0 && sortDir !== 'none') {
      order.sort((x, y) => compare(body[x][sortCol] ?? '', body[y][sortCol] ?? ''));
      if (sortDir === 'descending') order.reverse();
    }
    const table = document.createElement('table');
    const caption = document.createElement('caption');
    caption.className = 'visually-hidden';
    caption.textContent = `The data as a table. ${sortDir !== 'none' ? `Sorted by ${head[sortCol]}, ${sortDir}.` : 'In file order.'}`;
    table.append(caption);
    const tr = table.createTHead().insertRow();
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.className = 'rownum';
    corner.textContent = '#';
    tr.append(corner);
    head.forEach((name, i) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.setAttribute('aria-sort', i === sortCol ? sortDir : 'none');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name || `(column ${i + 1})`;
      button.addEventListener('click', () => {
        sortDir = sortCol !== i ? 'ascending' : sortDir === 'ascending' ? 'descending' : sortDir === 'descending' ? 'none' : 'ascending';
        sortCol = i;
        draw();
        announce(status, sortDir === 'none' ? 'Back in file order.' : `Sorted by ${name || `column ${i + 1}`}, ${sortDir}.`);
        (tableWrap.querySelectorAll('thead button')[i] as HTMLButtonElement)?.focus();
      });
      th.append(button);
      tr.append(th);
    });
    const tbody = table.createTBody();
    const numeric = head.map((_, c) => body.slice(0, 200).every(r => (r[c] ?? '') === '' || isNumber(r[c])));
    for (const index of order.slice(0, MAX_DRAWN)) {
      const row = tbody.insertRow();
      const num = document.createElement('th');
      num.scope = 'row';
      num.className = 'rownum';
      num.textContent = String(index + 1);
      row.append(num);
      for (let c = 0; c < head.length; c++) {
        const td = row.insertCell();
        td.textContent = body[index][c] ?? '';
        if (numeric[c]) td.className = 'num';
      }
    }
    tableWrap.textContent = '';
    tableWrap.append(table);
  }

  async function update(reason: string) {
    const id = ++run;
    if (!text.trim()) {
      head = []; body = [];
      tableWrap.textContent = '';
      summary.textContent = '';
      messages.textContent = '';
      announce(status, 'The input is empty. Paste CSV or TSV, open a file or pick a sample.');
      return;
    }
    try {
      const result = await runRows(text, { delimiter: delimiter.value });
      if (id !== run) return;
      const rows = result.rows;
      const width = rows.reduce((max, r) => (r.length > max ? r.length : max), 0);
      head = header.checked ? Array.from({ length: width }, (_, i) => rows[0]?.[i] ?? '') : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
      body = header.checked ? rows.slice(1) : rows;
      sortCol = -1;
      sortDir = 'none';
      draw();
      const ragged = body.filter(r => r.length !== width).length;
      summary.textContent = `${formatCount(body.length)} row${body.length === 1 ? '' : 's'} × ${formatCount(width)} column${width === 1 ? '' : 's'} · delimiter: ${NAMES[result.delimiter] ?? result.delimiter}${result.bom ? ' · UTF-8 BOM' : ''} · ${formatBytes(fileSize || new Blob([text]).size)}${body.length > MAX_DRAWN ? ` · showing the first ${formatCount(MAX_DRAWN)} rows` : ''}`;
      const notes = [...result.warnings];
      if (ragged) notes.push(`${formatCount(ragged)} row${ragged === 1 ? ' has' : 's have'} fewer than ${width} fields; the missing cells are empty.`);
      messages.textContent = '';
      if (notes.length) {
        const ul = document.createElement('ul');
        ul.className = 'msg-list';
        for (const note of notes.slice(0, 5)) { const li = document.createElement('li'); li.className = 'msg warn'; li.textContent = note; ul.append(li); }
        messages.append(ul);
      }
      announce(status, `${formatCount(body.length)} rows and ${formatCount(width)} columns, separated by ${NAMES[result.delimiter] ?? result.delimiter}s. Select a column heading to sort.`);
    } catch (error) {
      if (id !== run) return;
      const e = error as { display?: string; message: string; line?: number };
      announce(status, `Error. ${e.display ?? e.message}`);
      area.mark(e.line ?? null);
      track('conversion_error', { pair: 'csv-viewer', error_kind: 'syntax' });
    }
  }

  const later = debounce(() => update('input'), 300);
  area.textarea.addEventListener('input', () => { text = area.textarea.value; fileSize = 0; area.textarea.readOnly = false; later(); });
  delimiter.addEventListener('change', () => update('option'));
  header.addEventListener('change', () => update('option'));

  async function open(file: File) {
    const opened = await readFile(file);
    if (opened.binary) { announce(status, `${file.name} is a workbook, not CSV. Use the Excel to CSV converter first.`); return; }
    track('file_open', { format: (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'txt').toLowerCase().slice(0, 8), tool: 'csv-viewer' });
    text = opened.text ?? '';
    fileSize = file.size;
    // Show at most 200 lines of a large file in the text box; the table uses the whole file.
    if (text.length > 1_000_000) {
      let cut = 0;
      for (let n = 0; n < 200 && cut >= 0; n++) cut = text.indexOf('\n', cut + 1);
      area.textarea.value = text.slice(0, cut < 0 ? text.length : cut);
      area.textarea.readOnly = true;
    } else {
      area.textarea.value = text;
      area.textarea.readOnly = false;
    }
    area.refresh();
    announce(status, `Opened ${file.name}.`);
    update('file');
  }
  const fileInput = $<HTMLInputElement>('[data-file]');
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) open(f); fileInput.value = ''; });
  enableDrop($('[data-drop]'), open);
  root.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => button.addEventListener('click', () => {
    text = samples[Number(button.dataset.sample)].text;
    fileSize = 0;
    area.textarea.value = text;
    area.textarea.readOnly = false;
    area.refresh();
    update('sample');
  }));
  $('[data-clear]').addEventListener('click', () => { text = ''; fileSize = 0; area.textarea.value = ''; area.textarea.readOnly = false; area.refresh(); update('clear'); area.textarea.focus(); });

  // Sorting works on the server-rendered sample too, once the rows are read.
  if (text.trim()) update('init');
}

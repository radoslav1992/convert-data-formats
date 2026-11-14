// Browser code for Converter.astro. Everything happens on this device: input is read from the textarea or
// from a file the visitor opens, converted by src/lib/convert (in a Web Worker for large inputs), and offered
// back for copying or download. Nothing is sent to a server; analytics events carry no data.
import { FORMATS, detect, parse } from '../lib/convert/index.mjs';
import { track, sizeBucket, msBucket } from '../lib/analytics';
import { codeArea, showCode, readFile, enableDrop, download, copyText, formatBytes, formatCount, announce, baseName, debounce } from './ui';
import { runConvert, inputSize, WORKER_THRESHOLD } from './runner';
import type { ConvertResult, ConvertErrorLike } from './types';

type FormatId = keyof typeof FORMATS;
const BIG_TEXT = 1_000_000;
const PREVIEW_LINES = 200;

export function initConverters() {
  document.querySelectorAll<HTMLElement>('[data-converter]').forEach(root => {
    if (root.dataset.ready) return;
    root.dataset.ready = 'true';
    setup(root);
  });
}

const slugOf = (f: string) => (f === 'xlsx' ? 'excel' : f);

function setup(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const mode = root.dataset.mode;
  const auto = mode === 'auto';
  let to = root.dataset.to as FormatId;
  let chosenFrom: string = auto ? 'auto' : (root.dataset.from as string);
  const samples: { label: string; text?: string; file?: string }[] = JSON.parse(root.dataset.samples || '[]');
  const scope: Record<string, string[]> | null = root.dataset.scope ? JSON.parse(root.dataset.scope) : null;

  const area = codeArea($('[data-code-area]'));
  const textarea = area.textarea;
  const codeAreaEl = $('[data-code-area]');
  const book = $('[data-book]');
  const bookName = $('[data-book-name]');
  const bookSize = $('[data-book-size]');
  const inTable = $('[data-in-table]');
  const codeView = $('[data-code-view]');
  const outTable = $('[data-out-table]');
  const inStats = $('[data-in-stats]');
  const outStats = $('[data-out-stats]');
  const status = $('[data-status]');
  const messages = $('[data-messages]');
  const copyBtn = $<HTMLButtonElement>('[data-copy]');
  const downloadBtn = $<HTMLButtonElement>('[data-download]');
  const extEl = $('[data-ext]');
  const outTitle = $('[data-out-title]');
  const inTitle = $('[data-in-title]');
  const detectedEl = root.querySelector('[data-detected]') as HTMLElement | null;
  const selFrom = root.querySelector('[data-select-from]') as HTMLSelectElement | null;
  const selTo = root.querySelector('[data-select-to]') as HTMLSelectElement | null;
  const fileInput = $<HTMLInputElement>('[data-file]');
  const sheetSelect = root.querySelector('[data-option="sheet"]') as HTMLSelectElement | null;

  const state = {
    text: textarea.value,
    bytes: null as ArrayBuffer | null,
    fileName: '',
    fileSize: 0,
    result: null as (ConvertResult & { inWorker: boolean }) | null,
    from: (auto ? detect(textarea.value)?.format : root.dataset.from) as string | undefined,
    runId: 0,
    lastTyped: 0,
    // True until the visitor loads, opens or clears something: the server-rendered sample is still on screen.
    pristine: true,
  };
  const initialText = samples[0]?.text ?? '';

  const pairSlug = () => `${slugOf(state.from ?? 'unknown')}-to-${slugOf(to)}`;

  function readOptions() {
    const out: Record<string, unknown> = {};
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-option]').forEach(el => {
      const row = el.closest('[data-option-row]') as HTMLElement | null;
      if (row?.hidden) return;
      out[el.dataset.option as string] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  }

  function currentFrom(): string | undefined {
    if (!auto) return chosenFrom;
    if (chosenFrom !== 'auto') return chosenFrom;
    if (state.bytes) return 'xlsx';
    return detect(state.text, { fileName: state.fileName })?.format;
  }

  function showInputKind(binary: boolean) {
    codeAreaEl.hidden = binary;
    book.hidden = !binary;
  }

  function showOutputKind() {
    const binary = to === 'xlsx';
    codeView.hidden = binary;
    outTable.hidden = !binary;
    copyBtn.hidden = binary;
    extEl.textContent = FORMATS[to].ext;
    outTitle.textContent = `${FORMATS[to].name} output`;
  }

  function updateScope(from: string | undefined) {
    if (!scope) return;
    const names = new Set(from && from !== to ? scope[`${from}>${to}`] ?? [] : []);
    root.querySelectorAll<HTMLElement>('[data-option-row]').forEach(row => { row.hidden = !names.has(row.dataset.optionRow as string); });
    const fieldset = root.querySelector('[data-options]') as HTMLElement | null;
    if (fieldset) fieldset.hidden = names.size === 0;
  }

  function setMessages(items: { kind: 'error' | 'warn'; text: string; line?: number; column?: number }[]) {
    messages.textContent = '';
    if (!items.length) return;
    const list = document.createElement('ul');
    list.className = 'msg-list';
    const shown = items.slice(0, 6);
    for (const item of shown) {
      const li = document.createElement('li');
      li.className = `msg ${item.kind}`;
      const kind = document.createElement('span');
      kind.className = 'msg-kind';
      kind.textContent = item.kind === 'error' ? 'Error' : 'Note';
      li.append(kind, item.text);
      if (item.line && !codeAreaEl.hidden && !textarea.readOnly) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn small';
        go.textContent = `Go to line ${item.line}`;
        go.addEventListener('click', () => area.goTo(item.line as number, item.column));
        li.append(go);
      }
      list.append(li);
    }
    if (items.length > shown.length) {
      const li = document.createElement('li');
      li.className = 'msg warn';
      li.textContent = `…and ${items.length - shown.length} more notes.`;
      list.append(li);
    }
    messages.append(list);
  }

  function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
    status.classList.toggle('is-ok', kind === 'ok');
    status.classList.toggle('is-error', kind === 'error');
    announce(status, text);
  }

  function renderTable(target: HTMLElement, columns: string[] | null, rows: unknown[][]) {
    const table = document.createElement('table');
    const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    if (columns) {
      const head = table.createTHead().insertRow();
      for (const c of columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = c; head.append(th); }
    }
    const body = table.createTBody();
    rows.forEach((row, r) => {
      const tr = body.insertRow();
      for (const v of row) {
        const td = document.createElement(!columns && r === 0 ? 'th' : 'td');
        td.textContent = cell(v);
        tr.append(td);
      }
    });
    target.textContent = '';
    target.append(table);
  }

  function inputStats(result: ConvertResult | null, extra: string[] = []) {
    const parts: string[] = [];
    const size = state.bytes ? state.bytes.byteLength : state.fileSize && textarea.readOnly ? state.fileSize : new Blob([state.text]).size;
    parts.push(formatBytes(size));
    if (result?.stats.rows !== undefined) parts.push(`${formatCount(result.stats.rows)} row${result.stats.rows === 1 ? '' : 's'}`);
    if (result?.stats.columns !== undefined) parts.push(`${formatCount(result.stats.columns)} column${result.stats.columns === 1 ? '' : 's'}`);
    if (result?.meta?.delimiterName && (currentFrom() === 'csv')) parts.push(`delimiter: ${result.meta.delimiterName}`);
    if (result?.meta?.documents && result.meta.documents > 1) parts.push(`${result.meta.documents} documents`);
    if (result) parts.push(`${formatCount(result.stats.ms)} ms`);
    inStats.textContent = [...parts, ...extra].join(' · ');
  }

  async function renderBook() {
    if (!state.bytes) return;
    try {

      const opts = readOptions();
      const { value, meta } = await parse('xlsx', state.bytes, { header: false, sheet: opts.sheet || undefined });
      renderTable(inTable, null, (value as unknown[][]).slice(0, 30));
      if (sheetSelect && meta?.sheets) {
        const names = meta.sheets as string[];
        const current = [...sheetSelect.options].map(o => o.value);
        if (names.join('\u0000') !== current.join('\u0000')) {
          sheetSelect.textContent = '';
          for (const name of names) sheetSelect.add(new Option(name, name, false, name === meta.sheet));
        }
        sheetSelect.value = meta.sheet as string;
      }
    } catch { /* The conversion reports the error. */ }
  }

  function trackDone(reason: string, result: ConvertResult) {
    if (reason === 'restore') return;
    const now = Date.now();
    // Typing converts on every pause; count it at most once every 30 seconds.
    if (reason === 'input') { if (now - state.lastTyped < 30_000) return; state.lastTyped = now; }
    track('conversion_done', { pair: pairSlug(), size_bucket: sizeBucket(result.stats.inputBytes), ms_bucket: msBucket(result.stats.ms) });
  }

  async function convertNow(reason: string) {
    const runId = ++state.runId;
    const from = currentFrom();
    state.from = from;
    if (auto) {
      updateScope(from);
      const detected = chosenFrom === 'auto' && from ? detect(state.bytes ?? state.text, { fileName: state.fileName }) : null;
      if (detectedEl) detectedEl.textContent = chosenFrom !== 'auto' ? '' : from ? `Detected ${FORMATS[from as FormatId].name}. ${detected?.reason ?? ''}` : '';
      inTitle.textContent = from ? `${FORMATS[from as FormatId].name} input` : 'Input';
    }
    const input = state.bytes ?? state.text;
    if (!state.bytes && !state.text.trim()) {
      setMessages([]);
      area.mark(null);
      setStatus(state.fileName ? `${state.fileName} is empty.` : 'The input is empty. Paste some data, open a file or pick a sample.');
      inputStats(null);
      return;
    }
    if (!from) {
      fail({ message: 'The format of this input could not be recognized. Choose it in the "From" list.', code: 'detect' }, reason);
      return;
    }
    if (from === 'xlsx' && !state.bytes && state.pristine && samples[0]?.file) {
      await loadSample(0);
      return;
    }
    if (from === 'xlsx' && !state.bytes) {
      fail({ message: 'Excel workbooks cannot be pasted as text. Open the .xlsx file instead, or paste CSV and choose CSV.', code: 'xlsx-input' }, reason);
      return;
    }
    if (from !== 'xlsx' && state.bytes) {
      fail({ message: `${state.fileName || 'This file'} is an Excel workbook. Use the Excel converters, such as Excel to ${FORMATS[to === 'xlsx' ? 'json' : to].name}.`, code: 'wrong-format' }, reason);
      return;
    }
    const big = inputSize(input) > WORKER_THRESHOLD;
    if (big) {
      root.setAttribute('aria-busy', 'true');
      setStatus(`Converting ${formatBytes(inputSize(input))}…`);
    }
    try {
      const result = await runConvert(from, to, input, readOptions());
      if (runId !== state.runId) return;
      state.result = result;
      codeView.classList.remove('stale');
      outTable.classList.remove('stale');
      area.mark(null);
      let note = '';
      if (to === 'xlsx') {
        const table = result.table ?? { columns: [], rows: [] };
        renderTable(outTable, table.columns, table.rows.slice(0, 50));
        outStats.textContent = `Workbook · ${formatBytes(result.stats.outputBytes)} · ${formatCount(result.stats.rows ?? table.rows.length)} rows${(result.stats.rows ?? 0) > 50 ? ' · preview shows the first 50' : ''}`;
      } else {
        const shown = showCode(codeView, result.text ?? '');
        note = shown.cut ? ` Showing the first ${formatCount(shown.shownLines)} of ${formatCount(shown.totalLines)} lines; Copy and Download give the whole result.` : '';
        outStats.textContent = `${formatBytes(result.stats.outputBytes)} · ${formatCount(shown.totalLines)} line${shown.totalLines === 1 ? '' : 's'}${shown.cut ? ` · showing ${formatCount(shown.shownLines)}` : ''}`;
      }
      inputStats(result, textarea.readOnly && state.fileName ? [`showing the first ${PREVIEW_LINES} lines`] : []);
      if (state.bytes) renderBook();
      const rows = result.stats.rows !== undefined ? `${formatCount(result.stats.rows)} row${result.stats.rows === 1 ? '' : 's'} ` : '';
      setStatus(`Converted ${rows}to ${FORMATS[to].name} in ${formatCount(result.stats.ms)} ms${result.inWorker ? ' (in a background worker)' : ''}.${result.warnings.length ? ` ${result.warnings.length} note${result.warnings.length === 1 ? '' : 's'} below.` : ''}${note}`, 'ok');
      setMessages(result.warnings.map(text => ({ kind: 'warn' as const, text })));
      trackDone(reason, result);
    } catch (error) {
      if (runId !== state.runId) return;
      fail(error as ConvertErrorLike, reason);
    } finally {
      if (runId === state.runId) root.removeAttribute('aria-busy');
    }
  }

  function fail(error: ConvertErrorLike, reason: string) {
    const where = error.line ? `Line ${error.line}${error.column ? `, column ${error.column}` : ''}: ` : '';
    const message = String(error.message ?? error);
    setStatus(`Error. ${where}${message}`, 'error');
    setMessages([{ kind: 'error', text: `${where}${message}`, line: error.line, column: error.column }]);
    area.mark(error.line && !textarea.readOnly ? error.line : null);
    codeView.classList.add('stale');
    outTable.classList.add('stale');
    outStats.textContent = 'Not updated: fix the error to convert again.';
    inputStats(null);
    if (reason !== 'restore') track('conversion_error', { pair: pairSlug(), error_kind: error.code ?? 'syntax' });
  }

  const typed = debounce(() => convertNow('input'), 250);
  const typedSlow = debounce(() => convertNow('input'), 700);

  textarea.addEventListener('input', () => {
    state.pristine = false;
    state.text = textarea.value;
    state.bytes = null;
    state.fileSize = 0;
    (state.text.length > WORKER_THRESHOLD ? typedSlow : typed)();
  });

  async function openFile(file: File) {
    let opened;
    try {
      opened = await readFile(file);
    } catch {
      fail({ message: `${file.name} could not be read.`, code: 'file' }, 'file');
      return;
    }
    const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? (opened.binary ? 'xlsx' : 'txt');
    track('file_open', { format: ext.slice(0, 8), tool: auto ? 'universal' : pairSlug() });
    state.fileName = file.name;
    state.fileSize = file.size;
    state.pristine = false;
    if (opened.binary) {
      if (!auto && chosenFrom !== 'xlsx') {
        fail({ message: `${file.name} is an Excel workbook, and this page converts ${FORMATS[chosenFrom as FormatId].name}. Use Excel to ${FORMATS[to === 'xlsx' ? 'json' : to].name} instead.`, code: 'wrong-format' }, 'file');
        return;
      }
      state.bytes = opened.bytes ?? null;
      state.text = '';
      bookName.textContent = file.name;
      bookSize.textContent = formatBytes(file.size);
      if (sheetSelect) sheetSelect.value = '';
      if (sheetSelect) sheetSelect.textContent = '';
      showInputKind(true);
    } else {
      if (!auto && chosenFrom === 'xlsx') {
        fail({ message: `${file.name} is not an .xlsx workbook. This page reads Excel files; for text formats use the matching converter, such as CSV to JSON.`, code: 'wrong-format' }, 'file');
        return;
      }
      state.bytes = null;
      state.text = opened.text ?? '';
      if (state.text.length > BIG_TEXT) {
        // Very large files are converted whole, but only their first lines are put in the text box.
        let cut = 0;
        for (let i = 0, n = 0; i < state.text.length && n < PREVIEW_LINES; i = cut + 1, n++) { cut = state.text.indexOf('\n', i); if (cut < 0) { cut = state.text.length; break; } }
        textarea.value = state.text.slice(0, cut);
        textarea.readOnly = true;
      } else {
        textarea.value = state.text;
        textarea.readOnly = false;
      }
      showInputKind(false);
      area.refresh();
      textarea.scrollTop = 0;
    }
    convertNow('file');
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) openFile(file);
    fileInput.value = '';
  });
  enableDrop($('[data-drop]'), openFile);

  async function loadSample(index: number) {
    const sample = samples[index];
    if (!sample) return;
    state.pristine = false;
    state.fileName = '';
    state.fileSize = 0;
    textarea.readOnly = false;
    if (sample.file) {
      try {
        const response = await fetch(sample.file);
        if (!response.ok) throw new Error(String(response.status));
        state.bytes = await response.arrayBuffer();
      } catch {
        fail({ message: 'The sample workbook could not be loaded. Check your connection and try again.', code: 'sample' }, 'sample');
        return;
      }
      state.text = '';
      state.fileName = sample.file.split('/').pop() ?? 'sample.xlsx';
      bookName.textContent = state.fileName;
      bookSize.textContent = formatBytes(state.bytes.byteLength);
      if (sheetSelect) sheetSelect.textContent = '';
      showInputKind(true);
    } else {
      state.bytes = null;
      state.text = sample.text ?? '';
      textarea.value = state.text;
      showInputKind(false);
      area.refresh();
      textarea.scrollTop = 0;
    }
    if (auto && selFrom) { selFrom.value = 'auto'; chosenFrom = 'auto'; }
    track('sample_load', { tool: auto ? 'universal' : pairSlug(), sample: sample.label.slice(0, 40) });
    await convertNow('sample');
  }

  root.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => {
    button.addEventListener('click', () => loadSample(Number(button.dataset.sample)));
  });

  $('[data-clear]').addEventListener('click', () => {
    state.runId++;
    state.pristine = false;
    state.text = '';
    state.bytes = null;
    state.fileName = '';
    state.fileSize = 0;
    state.result = null;
    textarea.value = '';
    textarea.readOnly = false;
    area.refresh();
    area.mark(null);
    showInputKind(!auto && chosenFrom === 'xlsx');
    bookName.textContent = 'No workbook open';
    bookSize.textContent = '';
    inTable.textContent = '';
    showCode(codeView, '');
    outTable.textContent = '';
    outStats.textContent = '';
    inStats.textContent = '';
    setMessages([]);
    setStatus('Cleared. Paste data, open a file or pick a sample.');
    if (!book.hidden) fileInput.focus(); else textarea.focus();
  });

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-option]').forEach(el => {
    el.addEventListener(el instanceof HTMLInputElement && el.type === 'text' ? 'input' : 'change', debounce(() => convertNow('option'), el instanceof HTMLInputElement && el.type === 'text' ? 400 : 0));
  });

  copyBtn.addEventListener('click', async () => {
    const text = state.result?.text ?? (codeView.querySelector('code')?.textContent || '');
    if (!text) { setStatus('There is nothing to copy yet.'); return; }
    const ok = await copyText(text);
    setStatus(ok ? `Copied ${formatCount(text.length)} characters of ${FORMATS[to].name}.` : 'Copying was blocked by the browser. Select the output and copy it by hand.', ok ? 'ok' : 'error');
    if (ok) track('copy_output', { pair: pairSlug() });
  });

  downloadBtn.addEventListener('click', async () => {
    let result = state.result;
    // Before any conversion in this visit, the output on screen is the server-rendered sample: convert it now.
    if (!result) {
      if (!auto && chosenFrom === 'xlsx' && !state.bytes) await loadSample(0);
      else await convertNow('download');
      result = state.result;
    }
    if (!result) { setStatus('Fix the error first: there is no output to download.', 'error'); return; }
    const format = FORMATS[to];
    const name = `${state.fileName ? baseName(state.fileName) : 'converted'}.${format.ext}`;
    if (result.bytes) download(new Blob([result.bytes], { type: format.mime }), name, format.mime);
    else download(result.text ?? '', name, format.mime);
    setStatus(`Downloaded ${name}.`, 'ok');
    track('download_output', { pair: pairSlug(), format: format.ext });
  });

  if (auto && selFrom && selTo) {
    selFrom.addEventListener('change', () => { chosenFrom = selFrom.value; convertNow('format'); });
    selTo.addEventListener('change', () => { to = selTo.value as FormatId; showOutputKind(); convertNow('format'); });
    $('[data-swap]').addEventListener('click', async () => {
      const from = currentFrom();
      const result = state.result;
      if (!from || !result) return;
      const newTo = from as FormatId;
      if (result.bytes) {
        state.bytes = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
        state.text = '';
        state.fileName = 'converted.xlsx';
        bookName.textContent = state.fileName;
        bookSize.textContent = formatBytes(state.bytes.byteLength);
        showInputKind(true);
      } else {
        state.bytes = null;
        state.text = result.text ?? '';
        textarea.value = state.text;
        textarea.readOnly = false;
        showInputKind(false);
        area.refresh();
      }
      chosenFrom = to;
      selFrom.value = to;
      to = newTo;
      selTo.value = newTo;
      showOutputKind();
      convertNow('format');
    });
  }

  // A browser may restore the text box from an earlier visit (back button); convert what is really there.
  if (!state.bytes && textarea.value !== initialText && textarea.value.trim()) {
    state.text = textarea.value;
    convertNow('restore');
  }
}

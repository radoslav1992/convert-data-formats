// Shared wiring for the XML and YAML editors: a code pane with validation, open/drop, download, copy, clear,
// a sample button and a draft kept in this browser's local storage.
import { codeArea, readFile, enableDrop, download, copyText, formatBytes, formatCount, announce, debounce, baseName } from './ui';
import type { CodeArea } from './ui';
import { track } from '../lib/analytics';

export interface Check { ok: boolean; badge: string; message: string; notes?: string[]; error?: { message: string; line?: number; column?: number; display?: string } }

export interface EditorConfig {
  tool: string;
  storageKey: string;
  ext: string;
  mime: string;
  check(text: string): Check;
  after?(text: string, check: Check): void;
}

export function initTextEditor(root: HTMLElement, config: EditorConfig) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const area = codeArea($('[data-code-area]'));
  const status = $('[data-status]');
  const badge = $('[data-badge]');
  const messages = $('[data-messages]');
  const stats = $('[data-stats]');
  let fileName = `data.${config.ext}`;
  let edited = false;
  let lastError = 0;
  const say = (text: string) => announce(status, text);

  function show(items: { kind: 'error' | 'warn'; text: string; line?: number; column?: number }[]) {
    messages.textContent = '';
    if (!items.length) return;
    const ul = document.createElement('ul');
    ul.className = 'msg-list';
    for (const item of items.slice(0, 10)) {
      const li = document.createElement('li');
      li.className = `msg ${item.kind}`;
      const kind = document.createElement('span');
      kind.className = 'msg-kind';
      kind.textContent = item.kind === 'error' ? 'Error' : 'Note';
      li.append(kind, item.text);
      if (item.line) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn small';
        go.textContent = `Go to line ${item.line}`;
        go.addEventListener('click', () => area.goTo(item.line as number, item.column));
        li.append(go);
      }
      ul.append(li);
    }
    messages.append(ul);
  }

  function validate() {
    const text = area.textarea.value;
    stats.textContent = `${formatBytes(new Blob([text]).size)} · ${formatCount(text.split('\n').length)} lines`;
    const result = config.check(text);
    badge.className = `badge ${result.ok ? 'ok' : text.trim() ? 'bad' : ''}`;
    badge.textContent = result.badge;
    status.classList.toggle('is-ok', result.ok);
    status.classList.toggle('is-error', !result.ok && Boolean(text.trim()));
    say(result.message);
    const items: { kind: 'error' | 'warn'; text: string; line?: number; column?: number }[] = [];
    if (result.error) items.push({ kind: 'error', text: result.error.display ?? result.error.message, line: result.error.line, column: result.error.column });
    for (const note of result.notes ?? []) items.push({ kind: 'warn', text: note });
    show(items);
    area.mark(result.error?.line ?? null);
    if (!result.ok && text.trim() && edited && Date.now() - lastError > 30_000) { lastError = Date.now(); track('conversion_error', { pair: config.tool, error_kind: 'syntax' }); }
    config.after?.(text, result);
    return result;
  }

  const saveNow = () => {
    try {
      const text = area.textarea.value;
      if (text.length <= 1_000_000) localStorage.setItem(config.storageKey, text);
      else localStorage.removeItem(config.storageKey);
    } catch { /* Storage full or blocked. */ }
  };
  const save = debounce(saveNow, 500);
  window.addEventListener('pagehide', () => { if (edited) saveNow(); });

  function replace(text: string, message: string) {
    area.textarea.value = text;
    area.refresh();
    edited = true;
    save();
    validate();
    say(message);
  }

  area.textarea.addEventListener('input', debounce(() => { edited = true; validate(); save(); }, 200));

  async function open(file: File) {
    const opened = await readFile(file);
    if (opened.binary) { say(`${file.name} is not a text file.`); return; }
    fileName = file.name;
    track('file_open', { format: (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'txt').toLowerCase().slice(0, 8), tool: config.tool });
    replace(opened.text ?? '', `Opened ${file.name} (${formatBytes(file.size)}).`);
  }
  const fileInput = $<HTMLInputElement>('[data-file]');
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) open(f); fileInput.value = ''; });
  enableDrop($('[data-drop]'), open);

  $('[data-download]').addEventListener('click', () => {
    const name = `${baseName(fileName)}.${config.ext}`;
    download(area.textarea.value, name, config.mime);
    say(`Downloaded ${name}.`);
    track('download_output', { pair: config.tool, format: config.ext });
  });
  $('[data-copy]').addEventListener('click', async () => {
    const ok = await copyText(area.textarea.value);
    say(ok ? 'Copied.' : 'Copying was blocked by the browser. Select the text and copy it by hand.');
    if (ok) track('copy_output', { pair: config.tool });
  });
  $('[data-clear]').addEventListener('click', () => {
    area.textarea.value = '';
    area.refresh();
    try { localStorage.removeItem(config.storageKey); } catch { /* ignore */ }
    validate();
    say('Cleared, and removed the saved copy from this browser.');
    area.textarea.focus();
  });
  $('[data-sample]').addEventListener('click', () => replace(root.dataset.sampleText ?? '', 'Loaded the sample.'));

  try {
    const saved = localStorage.getItem(config.storageKey);
    if (saved && saved.trim() && saved !== area.textarea.value) {
      area.textarea.value = saved;
      area.refresh();
      validate();
      say('Restored the text you were editing last time (kept in this browser only). Clear removes it.');
    } else if (area.textarea.value !== root.dataset.sampleText) validate();
  } catch { /* Storage blocked. */ }

  return { area, replace, validate, say } as { area: CodeArea; replace: (t: string, m: string) => void; validate: () => Check; say: (t: string) => void };
}

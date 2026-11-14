// JSON editor: live validation with line and column, lossless format and minify, sort keys, JSON Schema
// validation with Ajv (drafts 07 and 2020-12, loaded only when a schema is used), open, download and copy.
// The text you edit is kept in this browser's local storage (key "dfs-json-content", the same key the previous
// version of this editor used) so a reload does not lose it. Clear removes it.
import { codeArea, readFile, enableDrop, download, copyText, formatBytes, formatCount, announce, debounce, baseName } from './ui';
import { parseJson, formatJsonText, serializeJson, sortKeys, scanJson } from '../lib/convert/json.mjs';
import { lineColumn } from '../lib/convert/errors.mjs';
import { track } from '../lib/analytics';

const KEY = 'dfs-json-content';
const MAX_SAVE = 1_000_000;

interface Problem { text: string; line?: number; column?: number; kind: 'error' | 'warn' }

export function initJsonEditor(root: HTMLElement) {
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const data = codeArea($('#json-input').closest('[data-code-area]') as HTMLElement);
  const schema = codeArea($('#schema-input').closest('[data-code-area]') as HTMLElement);
  const status = $('[data-status]');
  const badge = $('[data-badge]');
  const messages = $('[data-messages]');
  const schemaStatus = $('[data-schema-status]');
  const schemaList = $('[data-schema-results]');
  const indent = $<HTMLSelectElement>('[data-indent]');
  const draft = $<HTMLSelectElement>('[data-draft]');
  const stats = $('[data-stats]');
  let fileName = 'data.json';
  let current: { ok: boolean; value?: unknown } = { ok: true };
  let lastError = 0;
  let edited = false;

  const say = (text: string) => announce(status, text);

  function list(target: HTMLElement, items: Problem[], area = data) {
    target.textContent = '';
    if (!items.length) return;
    const ul = document.createElement('ul');
    ul.className = 'msg-list';
    for (const item of items.slice(0, 20)) {
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
    if (items.length > 20) {
      const li = document.createElement('li');
      li.className = 'msg warn';
      li.textContent = `…and ${items.length - 20} more.`;
      ul.append(li);
    }
    target.append(ul);
  }

  function describe(value: unknown) {
    if (Array.isArray(value)) return `an array of ${formatCount(value.length)} item${value.length === 1 ? '' : 's'}`;
    if (value && typeof value === 'object') { const n = Object.keys(value).length; return `an object with ${formatCount(n)} key${n === 1 ? '' : 's'}`; }
    return value === null ? 'null' : `a ${typeof value}`;
  }

  function setBadge(kind: 'ok' | 'bad' | '', text: string) {
    badge.className = `badge ${kind}`;
    badge.textContent = text;
  }

  function validate() {
    const text = data.textarea.value;
    stats.textContent = `${formatBytes(new Blob([text]).size)} · ${formatCount(text.split('\n').length)} lines`;
    if (!text.trim()) {
      current = { ok: false };
      setBadge('', 'Empty');
      say('The editor is empty. Paste JSON, open a file or load the sample.');
      list(messages, []);
      data.mark(null);
      checkSchema();
      return;
    }
    try {
      const { value, warnings } = parseJson(text);
      current = { ok: true, value };
      setBadge('ok', 'Valid JSON');
      say(`Valid JSON: ${describe(value)}.${warnings.length ? ` ${warnings.length} note${warnings.length === 1 ? '' : 's'} below.` : ''}`);
      status.classList.remove('is-error');
      status.classList.add('is-ok');
      list(messages, warnings.map(w => {
        const m = /^Line (\d+), column (\d+): /.exec(w);
        return { kind: 'warn' as const, text: w, line: m ? Number(m[1]) : undefined, column: m ? Number(m[2]) : undefined };
      }));
      data.mark(null);
    } catch (error) {
      const e = error as { message: string; line?: number; column?: number; display?: string };
      current = { ok: false };
      setBadge('bad', 'Invalid JSON');
      status.classList.remove('is-ok');
      status.classList.add('is-error');
      say(`Invalid JSON. ${e.display ?? e.message}`);
      list(messages, [{ kind: 'error', text: e.display ?? e.message, line: e.line, column: e.column }]);
      data.mark(e.line ?? null);
      if (edited && Date.now() - lastError > 30_000) { lastError = Date.now(); track('conversion_error', { pair: 'json-editor', error_kind: 'syntax' }); }
    }
    checkSchema();
  }

  let schemaRun = 0;
  async function checkSchema() {
    const run = ++schemaRun;
    const text = schema.textarea.value;
    schema.mark(null);
    if (!text.trim()) {
      schemaStatus.textContent = 'No schema. Paste a JSON Schema or open a schema file to check the data against it.';
      list(schemaList, []);
      return;
    }
    let schemaValue: Record<string, unknown>;
    try {
      schemaValue = parseJson(text).value as Record<string, unknown>;
    } catch (error) {
      const e = error as { message: string; line?: number; column?: number; display?: string };
      schemaStatus.textContent = 'The schema itself is not valid JSON.';
      list(schemaList, [{ kind: 'error', text: `Schema: ${e.display ?? e.message}`, line: e.line, column: e.column }], schema);
      schema.mark(e.line ?? null);
      return;
    }
    if (!current.ok) {
      schemaStatus.textContent = 'Fix the JSON errors first; then it is checked against the schema.';
      list(schemaList, []);
      return;
    }
    const declared = typeof schemaValue.$schema === 'string' ? schemaValue.$schema : '';
    const choice = draft.value === 'auto' ? (/2020-12/.test(declared) ? '2020-12' : /2019-09/.test(declared) ? '2019-09' : '07') : draft.value;
    if (choice === '2019-09') {
      schemaStatus.textContent = 'This schema declares draft 2019-09, which this editor does not support. Choose draft 2020-12 or draft-07 above to check it with that draft\'s rules.';
      list(schemaList, []);
      return;
    }
    schemaStatus.textContent = 'Checking…';
    try {
      const mod = choice === '2020-12' ? await import('ajv/dist/2020') : await import('ajv');
      const Ajv = (mod as unknown as { default: new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: Record<string, unknown> }[] } } }).default;
      const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
      const { $schema: _ignored, ...rest } = schemaValue;
      void _ignored;
      // A $schema that names another draft is left out, so the chosen draft's rules apply.
      const matches = !declared || (choice === '2020-12' ? /2020-12/.test(declared) : /draft-07/.test(declared));
      const validateFn = ajv.compile(matches ? schemaValue : rest);
      if (run !== schemaRun) return;
      const ok = validateFn(current.value);
      if (ok) {
        schemaStatus.textContent = `Valid against the schema (draft ${choice}).`;
        list(schemaList, []);
        return;
      }
      const { paths } = scanJson(data.textarea.value, { paths: true });
      const errors = (validateFn.errors ?? []).map(err => {
        const offset = paths?.get(err.instancePath);
        const pos = offset !== undefined ? lineColumn(data.textarea.value, offset) : undefined;
        const where = err.instancePath ? err.instancePath : '(the whole document)';
        const extra = err.params && 'allowedValues' in err.params ? `: ${(err.params.allowedValues as unknown[]).map(v => JSON.stringify(v)).join(', ')}` : '';
        return { kind: 'error' as const, text: `${where} ${err.message ?? 'is not valid'}${extra}${pos ? ` (line ${pos.line}, column ${pos.column})` : ''}`, line: pos?.line, column: pos?.column };
      });
      schemaStatus.textContent = `${errors.length} problem${errors.length === 1 ? '' : 's'} against the schema (draft ${choice}).`;
      list(schemaList, errors);
      if (edited && Date.now() - lastError > 30_000) { lastError = Date.now(); track('conversion_error', { pair: 'json-editor', error_kind: 'schema' }); }
    } catch (error) {
      if (run !== schemaRun) return;
      schemaStatus.textContent = `The schema could not be used: ${(error as Error).message}`;
      list(schemaList, []);
    }
  }

  const save = debounce(() => {
    try {
      const text = data.textarea.value;
      if (text.length <= MAX_SAVE) localStorage.setItem(KEY, text);
      else localStorage.removeItem(KEY);
    } catch { /* Storage can be full or blocked; the editor still works. */ }
  }, 500);

  const later = debounce(validate, 200);
  data.textarea.addEventListener('input', () => { edited = true; later(); save(); });
  schema.textarea.addEventListener('input', debounce(checkSchema, 300));
  draft.addEventListener('change', checkSchema);

  function replace(text: string, message: string) {
    data.textarea.value = text;
    data.refresh();
    edited = true;
    save();
    validate();
    say(message);
  }

  function tryFormat(kind: 'format' | 'minify') {
    try {
      const out = formatJsonText(data.textarea.value, kind === 'minify' ? '0' : indent.value);
      replace(out, kind === 'minify' ? `Minified: ${formatBytes(new Blob([out]).size)}.` : 'Formatted.');
    } catch (error) {
      validate();
    }
  }

  $('[data-format]').addEventListener('click', () => tryFormat('format'));
  $('[data-minify]').addEventListener('click', () => tryFormat('minify'));
  $('[data-sort]').addEventListener('click', () => {
    try {
      const { value, warnings } = parseJson(data.textarea.value);
      if (warnings.some(w => /2\^53/.test(w))) {
        say('Sorting reads the values, and this JSON has numbers beyond 2^53 that would be rounded. Put them in quotes first.');
        return;
      }
      if (warnings.some(w => /appears twice/.test(w))) {
        say('Sorting keeps only the last of two keys with the same name, and this JSON has such keys. Rename them first.');
        return;
      }
      replace(serializeJson(sortKeys(value), { indent: indent.value }).text + '\n', 'Keys sorted from A to Z.');
    } catch {
      validate();
    }
  });

  async function open(file: File, target: 'data' | 'schema') {
    const opened = await readFile(file);
    if (opened.binary) { say(`${file.name} is not a text file.`); return; }
    track('file_open', { format: (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? 'txt').toLowerCase().slice(0, 8), tool: 'json-editor' });
    if (target === 'schema') {
      schema.textarea.value = opened.text ?? '';
      schema.refresh();
      checkSchema();
      say(`Opened ${file.name} as the schema.`);
      return;
    }
    fileName = file.name;
    replace(opened.text ?? '', `Opened ${file.name} (${formatBytes(file.size)}).`);
  }

  const fileInput = $<HTMLInputElement>('[data-file]');
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) open(f, 'data'); fileInput.value = ''; });
  const schemaFile = $<HTMLInputElement>('[data-schema-file]');
  schemaFile.addEventListener('change', () => { const f = schemaFile.files?.[0]; if (f) open(f, 'schema'); schemaFile.value = ''; });
  enableDrop($('[data-drop]'), file => open(file, 'data'));
  enableDrop($('[data-schema-drop]'), file => open(file, 'schema'));

  $('[data-download]').addEventListener('click', () => {
    const name = `${baseName(fileName)}.json`;
    download(data.textarea.value, name, 'application/json');
    say(`Downloaded ${name}.`);
    track('download_output', { pair: 'json-editor', format: 'json' });
  });
  $('[data-copy]').addEventListener('click', async () => {
    const ok = await copyText(data.textarea.value);
    say(ok ? 'Copied the JSON.' : 'Copying was blocked by the browser. Select the text and copy it by hand.');
    if (ok) track('copy_output', { pair: 'json-editor' });
  });
  $('[data-clear]').addEventListener('click', () => {
    data.textarea.value = '';
    data.refresh();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    validate();
    say('Cleared, and removed the saved copy from this browser.');
    data.textarea.focus();
  });
  $('[data-sample]').addEventListener('click', () => replace(root.dataset.sample ?? '', 'Loaded the sample.'));
  $('[data-schema-clear]').addEventListener('click', () => { schema.textarea.value = ''; schema.refresh(); checkSchema(); say('Removed the schema.'); });
  $('[data-schema-sample]').addEventListener('click', () => { schema.textarea.value = root.dataset.schema ?? ''; schema.refresh(); checkSchema(); say('Loaded the sample schema.'); });

  // Bring back the text from the last visit (this browser only).
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.trim() && saved !== data.textarea.value) {
      data.textarea.value = saved;
      data.refresh();
      validate();
      say('Restored the JSON you were editing last time (kept in this browser only). Clear removes it.');
      return;
    }
  } catch { /* Storage blocked: start with the sample. */ }
  if (data.textarea.value !== root.dataset.sample) validate();
}

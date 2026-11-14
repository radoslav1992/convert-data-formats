// Small browser helpers shared by the converters, editors and the CSV viewer: code panes with line numbers,
// opening and dropping files, downloads, the clipboard and the live status line.

export const numbers = (count: number) => {
  let out = '1';
  for (let i = 2; i <= count; i++) out += '\n' + i;
  return out;
};

export function countLines(text: string) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

export interface CodeArea {
  textarea: HTMLTextAreaElement;
  refresh(): void;
  mark(line: number | null): void;
  goTo(line: number, column?: number): void;
}

/** A textarea with a line-number gutter and an error-line marker. Markup: CodeEditor.astro. */
export function codeArea(wrapper: HTMLElement): CodeArea {
  const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement;
  const gutter = wrapper.querySelector('.gutter') as HTMLElement;
  const marker = wrapper.querySelector('.line-mark') as HTMLElement | null;
  let lines = countLines(textarea.value);
  let marked = 0;
  const lineHeight = () => parseFloat(getComputedStyle(textarea).lineHeight) || 20;
  const sync = () => {
    gutter.style.transform = `translateY(${-textarea.scrollTop}px)`;
    if (marker && marked) marker.style.transform = `translateY(${(marked - 1) * lineHeight() - textarea.scrollTop}px)`;
  };
  const refresh = () => {
    const count = countLines(textarea.value);
    if (count !== lines) {
      lines = count;
      gutter.textContent = numbers(count);
      wrapper.style.setProperty('--digits', String(Math.max(2, String(count).length)));
    }
    sync();
  };
  textarea.addEventListener('scroll', sync, { passive: true });
  textarea.addEventListener('input', refresh);
  return {
    textarea,
    refresh,
    mark(line) {
      marked = line ?? 0;
      if (marker) marker.hidden = !marked;
      sync();
    },
    goTo(line, column = 1) {
      const text = textarea.value;
      let offset = 0;
      for (let l = 1; l < line; l++) {
        const next = text.indexOf('\n', offset);
        if (next < 0) break;
        offset = next + 1;
      }
      offset = Math.min(offset + Math.max(column - 1, 0), text.length);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(offset, Math.min(offset + 1, text.length));
      textarea.scrollTop = Math.max(0, (line - 4) * lineHeight());
      sync();
    },
  };
}

/** Fills a read-only code view (gutter + pre) and returns whether the text was cut for display. */
export function showCode(view: HTMLElement, text: string, maxLines = 1000, maxChars = 200_000) {
  const code = view.querySelector('code') as HTMLElement;
  const gutter = view.querySelector('.gutter') as HTMLElement;
  let shown = text.length > maxChars ? text.slice(0, maxChars) : text;
  let cut = shown.length < text.length;
  let lineCount = 0;
  let index = -1;
  while ((index = shown.indexOf('\n', index + 1)) !== -1) {
    lineCount++;
    if (lineCount >= maxLines) { shown = shown.slice(0, index); cut = true; break; }
  }
  if (cut) shown = shown.slice(0, shown.lastIndexOf('\n') > 0 ? shown.lastIndexOf('\n') : shown.length);
  const display = shown.replace(/\n$/, '');
  code.textContent = display;
  const count = countLines(display);
  gutter.textContent = numbers(count);
  view.style.setProperty('--digits', String(Math.max(2, String(count).length)));
  view.scrollTop = 0;
  return { cut, shownLines: count, totalLines: cut ? countLines(text.replace(/\n$/, '')) : count };
}

export interface OpenedFile { name: string; size: number; text?: string; bytes?: ArrayBuffer; binary: boolean }

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Reads a file: workbooks (by name or ZIP signature) as bytes, anything else as UTF-8 text. */
export async function readFile(file: File): Promise<OpenedFile> {
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const binary = /\.(xlsx|xlsm|xls)$/i.test(file.name) || ZIP.every((b, i) => head[i] === b) || ole;
  if (binary) return { name: file.name, size: file.size, bytes, binary: true };
  return { name: file.name, size: file.size, text: new TextDecoder('utf-8').decode(bytes), binary: false };
}

/** Lets files be dropped on an element (and highlights it while dragging). */
export function enableDrop(target: HTMLElement, onFile: (file: File) => void) {
  let depth = 0;
  target.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); depth++; target.classList.add('dragging'); } });
  target.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  target.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) target.classList.remove('dragging'); });
  target.addEventListener('drop', event => {
    depth = 0;
    target.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    onFile(file);
  });
}

export function download(data: BlobPart | Blob, name: string, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: `${mime}${mime.startsWith('text/') || mime.endsWith('json') || mime.endsWith('xml') || mime.endsWith('yaml') || mime.endsWith('toml') ? ';charset=utf-8' : ''}` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission: fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export const formatCount = (n: number) => n.toLocaleString('en-US');

/** Writes a message to a live region. Repeating the same text still gets announced. */
export function announce(region: HTMLElement, text: string) {
  region.textContent = region.textContent === text ? `${text} ` : text;
}

export function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'converted';
}

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

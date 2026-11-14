// Errors the converters throw. Every parse error carries a 1-based line and column when the input has one,
// so the page can say "Line 3, column 7" and move the cursor there.

export class ConvertError extends Error {
  /**
   * @param {string} message What went wrong, in plain words.
   * @param {{ code?: string, line?: number, column?: number, offset?: number, hint?: string, format?: string }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConvertError';
    this.code = details.code ?? 'syntax';
    this.format = details.format;
    this.line = details.line;
    this.column = details.column;
    this.offset = details.offset;
    this.hint = details.hint;
  }

  /** "Line 3, column 7: message", or the message alone when there is no position. */
  get display() {
    const where = this.line ? `Line ${this.line}${this.column ? `, column ${this.column}` : ''}: ` : '';
    return where + this.message;
  }

  toJSON() {
    return { name: this.name, message: this.message, code: this.code, format: this.format, line: this.line, column: this.column, offset: this.offset, hint: this.hint };
  }
}

/** Rebuilds a ConvertError from its JSON form (errors cross the Web Worker boundary as plain objects). */
export function reviveError(data) {
  if (!data || data.name !== 'ConvertError') return new ConvertError(String(data?.message ?? data), { code: 'internal' });
  return new ConvertError(data.message, data);
}

/** 1-based line and column of a 0-based offset in text. Columns count UTF-16 code units, as editors do. */
export function lineColumn(text, offset) {
  let line = 1;
  let start = 0;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) { line++; start = i + 1; }
  }
  return { line, column: end - start + 1 };
}

/** 0-based offset of a 1-based line and column. */
export function offsetOf(text, line, column = 1) {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(column - 1, 0), text.length);
}

export const emptyInput = format => new ConvertError('The input is empty. Paste some data, open a file or pick a sample.', { code: 'empty', format });

/** Removes a leading UTF-8 byte order mark. Returns [text, hadBom]. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? [text.slice(1), true] : [text, false];
}

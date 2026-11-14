// Type inference for text values (CSV and TSV cells, XML text and attributes).
//
// The rule: a value becomes a number, boolean or null only if writing that number, boolean or null back out
// gives exactly the same text. So "42", "-3.5", "true", "false" and "null" convert, while "007", "1.50",
// "1e5", "+44 20 7946 0958", "12345678901234567890" (beyond 2^53) and "TRUE" stay strings: converting them
// would change what the value says when it is written out again.

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** The typed value of a text, following the round-trip rule; the text itself when no type fits. */
export function inferValue(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (text.length > 0 && text.length < 24 && NUMBER.test(text)) {
    const number = Number(text);
    if (String(number) === text) {
      if (Number.isInteger(number) && !Number.isSafeInteger(number)) return text;
      return number;
    }
  }
  return text;
}

/** A short explanation of why a text was or was not converted (used on the pages and in tests). */
export function inferReason(text) {
  const value = inferValue(text);
  if (typeof value !== 'string') return `${JSON.stringify(text)} becomes ${JSON.stringify(value)}`;
  if (/^-?0\d/.test(text)) return `${JSON.stringify(text)} stays text: a leading zero would be lost`;
  if (/^-?\d{16,}$/.test(text)) return `${JSON.stringify(text)} stays text: it is beyond 2^53 and would be rounded`;
  if (/[eE]/.test(text) && !Number.isNaN(Number(text))) return `${JSON.stringify(text)} stays text: it would be written back as ${String(Number(text))}`;
  if (/^\+/.test(text)) return `${JSON.stringify(text)} stays text: the plus sign would be lost`;
  if (/^-?\d+\.\d*0$/.test(text)) return `${JSON.stringify(text)} stays text: the trailing zero would be lost`;
  return `${JSON.stringify(text)} stays text`;
}

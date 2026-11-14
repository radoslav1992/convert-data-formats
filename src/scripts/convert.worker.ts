// Runs conversions off the main thread, so a large file never freezes the page.
import { convert } from '../lib/convert/index.mjs';
import { parseRows } from '../lib/convert/csv.mjs';

self.onmessage = async (event: MessageEvent) => {
  const { id, from, to, input, options, task } = event.data;
  if (task === 'rows') {
    try {
      (self as unknown as Worker).postMessage({ id, ok: true, result: parseRows(input, options) });
    } catch (error) {
      const e = error as { toJSON?: () => unknown; message?: string };
      (self as unknown as Worker).postMessage({ id, ok: false, error: typeof e?.toJSON === 'function' ? e.toJSON() : { name: 'Error', message: String(e?.message ?? error) } });
    }
    return;
  }
  try {
    const result = await convert(from, to, input, options);
    const { blob, ...rest } = result as { blob?: Blob; table?: { columns: string[]; rows: unknown[][] } };
    // Only a preview of the table goes back: the page shows the first rows, the download uses text or bytes.
    if (rest.table) rest.table = { columns: rest.table.columns, rows: rest.table.rows.slice(0, 100) };
    (self as unknown as Worker).postMessage({ id, ok: true, result: rest }, (rest as { bytes?: Uint8Array }).bytes ? [(rest as { bytes: Uint8Array }).bytes.buffer] : []);
  } catch (error) {
    const e = error as { toJSON?: () => unknown; message?: string };
    (self as unknown as Worker).postMessage({ id, ok: false, error: typeof e?.toJSON === 'function' ? e.toJSON() : { name: 'Error', message: String(e?.message ?? error) } });
  }
};

// Runs a conversion: on the main thread for small inputs, in a Web Worker above about 200 KB.
import type { ConvertResult } from './types';
import { reviveError } from '../lib/convert/errors.mjs';
import { convert } from '../lib/convert/index.mjs';

export const WORKER_THRESHOLD = 200_000;
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: ConvertResult) => void; reject: (e: unknown) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, result, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (ok) job.resolve(result);
    else job.reject(reviveError(error));
  };
  worker.onerror = event => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'The conversion worker stopped.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function inputSize(input: string | ArrayBuffer) {
  return typeof input === 'string' ? input.length : input.byteLength;
}

export async function runConvert(from: string, to: string, input: string | ArrayBuffer, options: Record<string, unknown>): Promise<ConvertResult & { inWorker: boolean }> {
  if (inputSize(input) > WORKER_THRESHOLD && typeof Worker !== 'undefined') {
    const id = nextId++;
    const w = getWorker();
    const result = await new Promise<ConvertResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Workbook bytes are copied, not transferred, so the page can convert the same file again.
      w.postMessage({ id, from, to, input, options });
    });
    return { ...result, inWorker: true };
  }
  return { ...(await convert(from, to, input, options)), inWorker: false } as ConvertResult & { inWorker: boolean };
}

/** Splits CSV or TSV into rows: in the worker above about 200 KB, on the main thread below. */
export async function runRows(input: string, options: Record<string, unknown>): Promise<{ rows: string[][]; delimiter: string; bom: boolean; warnings: string[] }> {
  if (input.length > WORKER_THRESHOLD && typeof Worker !== 'undefined') {
    const id = nextId++;
    const w = getWorker();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as unknown as (r: ConvertResult) => void, reject });
      w.postMessage({ id, task: 'rows', input, options });
    });
  }
  const { parseRows } = await import('../lib/convert/csv.mjs');
  return parseRows(input, options);
}

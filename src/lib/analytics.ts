// GA4 events. A no-op unless the Google tag (or the consent defaults' gtag stub) exists.
// Never send the data itself: only the tool, the format, and coarse size and time buckets.
type Params = Record<string, string | number | boolean>;
export function track(name: string, params: Params = {}) {
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag === 'function') gtag('event', name, params);
}

/** Size of the input, in buckets: never the exact size. */
export function sizeBucket(bytes: number) {
  if (bytes < 10_000) return '<10KB';
  if (bytes < 100_000) return '10-100KB';
  if (bytes < 1_000_000) return '100KB-1MB';
  if (bytes < 10_000_000) return '1-10MB';
  return '>10MB';
}

/** Time a conversion took, in buckets. */
export function msBucket(ms: number) {
  if (ms < 50) return '<50ms';
  if (ms < 200) return '50-200ms';
  if (ms < 1000) return '200ms-1s';
  if (ms < 5000) return '1-5s';
  return '>5s';
}

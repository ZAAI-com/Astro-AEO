export const RELEASE_THRESHOLDS = Object.freeze({
  // 1.3 measured 272,377 packed and 1,106,331 unpacked bytes after adding the
  // dependency-free planner, validator, cache, crawler registry, and IndexNow,
  // then correcting the review backlog. 1.3.1 measured 282,003 packed and
  // 1,136,004 unpacked after the security and validator fixes and the new
  // public-IP helper, then 290,286 packed and 1,163,361 unpacked after the
  // development rewrite diagnostics, the loopback fallback, and the review
  // round that followed them. The unpacked ceiling
  // moved with that last measurement. The packed ceiling is deliberately
  // generous so ordinary correctness work does not gate a release; the absolute
  // bundle, startup, memory, and request ceilings below remain the binding
  // limits.
  packagePackedBytes: 400_000,
  packageUnpackedBytes: 1_180_000,
  parse100KbP95Ms: 50,
  convert100KbP95Ms: 150,
  requestP95OverheadMs: 10,
  retainedHeapBytes: 10 * 1024 * 1024,
  corpusConcurrency: 1,
  cloudflareRawBytes: Math.floor(64 * 1024 * 1024 * 0.8),
  cloudflareGzipBytes: Math.floor(3 * 1024 * 1024 * 0.8),
  cloudflareStartupMs: 800,
});

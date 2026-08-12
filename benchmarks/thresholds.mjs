export const RELEASE_THRESHOLDS = Object.freeze({
  // 1.3 measured 254,633 packed and 1,036,681 unpacked bytes after adding the
  // dependency-free planner, validator, cache, crawler registry, and IndexNow.
  packagePackedBytes: 280_000,
  packageUnpackedBytes: 1_150_000,
  parse100KbP95Ms: 50,
  convert100KbP95Ms: 150,
  requestP95OverheadMs: 10,
  retainedHeapBytes: 10 * 1024 * 1024,
  corpusConcurrency: 1,
  cloudflareRawBytes: Math.floor(64 * 1024 * 1024 * 0.8),
  cloudflareGzipBytes: Math.floor(3 * 1024 * 1024 * 0.8),
  cloudflareStartupMs: 800,
});

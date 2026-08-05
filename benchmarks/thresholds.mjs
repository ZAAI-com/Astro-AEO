export const RELEASE_THRESHOLDS = Object.freeze({
  packagePackedBytes: 79_793,
  packageUnpackedBytes: 264_541,
  parse100KbP95Ms: 50,
  convert100KbP95Ms: 150,
  requestP95OverheadMs: 10,
  retainedHeapBytes: 10 * 1024 * 1024,
  corpusConcurrency: 4,
  cloudflareRawBytes: Math.floor(64 * 1024 * 1024 * 0.8),
  cloudflareGzipBytes: Math.floor(3 * 1024 * 1024 * 0.8),
  cloudflareStartupMs: 800,
});

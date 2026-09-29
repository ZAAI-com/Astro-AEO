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
  //
  // 1.4 ships the audit engine and its seven report formats, the doctor and fix
  // commands, the content and Starlight helpers, and three edge handlers, all as
  // new opt-in source. The first of those (the rule registry and finding
  // contracts) alone measured 1,200,204 unpacked, past the 1.3 ceiling, so both
  // ceilings move once here for the whole release instead of creeping per
  // workstream. None of the new code enters a consumer's runtime bundle unless it
  // is imported, and that is held by the bundle and startup limits below. 1.4.0
  // measured 350,713 packed and 1,358,848 unpacked across 164 files. The unpacked
  // ceiling sits close to that measurement, as before; the packed one stays loose.
  //
  // 1.5 adds the producer-versioned cache state and the Markdown fidelity passes
  // (glyph unwrap, inline block flattening, code-fence language resolution) with
  // their colocated tests. 1.5.0 measured 365,087 packed and 1,403,094 unpacked
  // across 168 files, past the 1.4 unpacked ceiling, so it moves once here. The
  // growth is correctness work in extraction and build caching, none of it in a
  // consumer's runtime bundle unless imported, which the limits below still hold.
  packagePackedBytes: 450_000,
  packageUnpackedBytes: 1_420_000,
  parse100KbP95Ms: 50,
  convert100KbP95Ms: 150,
  // The rich document repeats hidden glyphs, a definition term, a two-image
  // figure and a Shiki block, so it is denser than the plain one. 1.5.0 measured
  // a p95 near 101 ms on the M2 Pro reference machine; the ceiling keeps the
  // same headroom the plain document has over its own measurement.
  convertRich100KbP95Ms: 300,
  requestP95OverheadMs: 10,
  retainedHeapBytes: 10 * 1024 * 1024,
  corpusConcurrency: 1,
  cloudflareRawBytes: Math.floor(64 * 1024 * 1024 * 0.8),
  cloudflareGzipBytes: Math.floor(3 * 1024 * 1024 * 0.8),
  cloudflareStartupMs: 800,
});

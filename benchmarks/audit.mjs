#!/usr/bin/env node
// @ts-check
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { auditDist } from '../src/audit/local.js';
import { createAuditReport, serializeAuditReport } from '../src/audit/report.js';
import { generateAuditFixture } from './audit-fixture.mjs';

// Offline audit of a generated site: wall time, peak heap, and proof that two runs
// serialize to the same bytes. `--enforce` applies the ceilings below.
const { values } = parseArgs({ options: { pages: { type: 'string', default: '10000' }, enforce: { type: 'boolean', default: false } } });
const pages = Number(values.pages);
// Measured at 1.4.0 on a developer laptop: 10,000 pages in under 3 s with a 69 MiB heap, and
// linear from 1,000 pages. The ceilings leave a slow CI runner an order of magnitude.
const CEILINGS = { secondsPer10k: 30, heapBytes: 512 * 1024 * 1024 };

const root = mkdtempSync(join(tmpdir(), 'astro-aeo-audit-bench-'));
try {
  generateAuditFixture(root, pages);
  const run = () => {
    const started = performance.now();
    const result = auditDist(root);
    const text = serializeAuditReport(createAuditReport({ toolVersion: 'bench', target: { kind: 'dist', value: 'dist' }, ...result }));
    return { text, seconds: (performance.now() - started) / 1000, findings: result.findings.length, pagesChecked: result.pagesChecked };
  };
  const first = run();
  const heapBytes = process.memoryUsage().heapUsed;
  const second = run();
  const report = {
    pages,
    pagesChecked: first.pagesChecked,
    findings: first.findings,
    seconds: [Number(first.seconds.toFixed(2)), Number(second.seconds.toFixed(2))],
    heapMiB: Math.round(heapBytes / 1024 / 1024),
    reportBytes: Buffer.byteLength(first.text),
    deterministic: first.text === second.text,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.deterministic) throw new Error('two audits of the same site serialized differently');
  if (report.pagesChecked !== pages) throw new Error(`audited ${report.pagesChecked} of ${pages} pages`);
  if (values.enforce) {
    const budget = CEILINGS.secondsPer10k * Math.max(1, pages / 10_000);
    if (Math.max(...report.seconds) > budget) throw new Error(`audit took longer than ${budget}s`);
    if (heapBytes > CEILINGS.heapBytes) throw new Error('audit heap exceeded its ceiling');
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

// @ts-check
import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { UnsafeAuditRootError, auditDist } from '../src/audit/local.js';
import { AuditTargetError, LIVE_DEFAULTS, auditLive } from '../src/audit/live.js';
import { createAuditReport } from '../src/audit/report.js';
import { isAuditFormat, renderAuditReport } from './formats/index.js';
import { writeOutput } from './reports/io.js';
import { failsGate } from './formats/shared.js';

/** A bad command line or an unreachable target: exit status 2. */
export class AuditInvocationError extends Error {}

const LIVE_ONLY = /** @type {const} */ (['max-pages', 'allow-origin', 'timeout', 'concurrency','discovery','discovery-base']);

/**
 * Run `astro-aeo audit`. Exit status follows severities only: `0` pass, `1`
 * findings at or above `--fail-on`, `2` for anything thrown as an invocation
 * error. Scores never take part.
 *
 * @param {string[]} args
 * @param {{ version: string; cwd?: string; fetch?: typeof globalThis.fetch }} context
 * @returns {Promise<{ exitCode: 0 | 1; output: string; written?: string }>}
 */
export async function runAudit(args, context) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        format: { type: 'string', default: 'terminal' },
        output: { type: 'string' },
        'github-output':{type:'string'},
        'summary-output':{type:'string'},
        discovery:{type:'boolean'},
        'discovery-base':{type:'string'},
        'fail-on': { type: 'string', default: 'error' },
        'no-score': { type: 'boolean', default: false },
        base: { type: 'string' },
        'max-pages': { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
        timeout: { type: 'string' },
        concurrency: { type: 'string' },
        heuristics: { type: 'boolean', default: false },
        'schema-target': { type: 'string', default: 'schema' },
      },
    });
  } catch (error) {
    throw new AuditInvocationError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new AuditInvocationError('audit accepts at most one distDir or URL');
  const format = values.format ?? 'terminal';
  if (!isAuditFormat(format)) {
    throw new AuditInvocationError('--format must be terminal, json, sarif, html, markdown, github, or junit');
  }
  const failOn = values['fail-on'];
  if (failOn !== 'error' && failOn !== 'warning' && failOn !== 'none') {
    throw new AuditInvocationError('--fail-on must be error, warning, or none');
  }

  const cwd = context.cwd ?? process.cwd();
  const schemaTarget = values['schema-target'];
  if (schemaTarget !== 'schema' && schemaTarget !== 'google') {
    throw new AuditInvocationError('--schema-target must be schema or google');
  }
  const target = positionals[0] ?? 'dist';
  const live = /^https?:\/\//i.test(target);
  /** @type {ReturnType<typeof auditDist> & { scope?: import('../src/index.js').AuditCrawlScope }} */
  let result;
  if (live) {
    if (values.base) throw new AuditInvocationError('--base applies to a build directory, not a URL');
    if (values['discovery-base'] && !values.discovery) throw new AuditInvocationError('--discovery-base requires --discovery');
    if (values['discovery-base'] && (!/^\/(?:[^?#\\]*)$/.test(values['discovery-base']) || values['discovery-base'].includes('//') || values['discovery-base'].split('/').some((part) => part === '.' || part === '..') || /%|[\u0000-\u0020]/.test(values['discovery-base']))) throw new AuditInvocationError('--discovery-base must be an absolute, decoded deployment path');
    try {
      result = await auditLive(target, {
        discovery:values.discovery,
        discoveryBase:values['discovery-base'],
        heuristics: values.heuristics,
        schemaTarget,
        maxPages: values['max-pages'] === 'unlimited'
          ? 'unlimited'
          : integer('--max-pages', values['max-pages'], LIVE_DEFAULTS.maxPages, 1, Number.MAX_SAFE_INTEGER),
        allowOrigins: values['allow-origin'] ?? [],
        timeout: integer('--timeout', values.timeout, LIVE_DEFAULTS.timeout, 1, 600_000),
        concurrency: integer('--concurrency', values.concurrency, LIVE_DEFAULTS.concurrency, 1, 32),
        toolVersion: context.version,
        ...(context.fetch ? { fetch: context.fetch } : {}),
      });
    } catch (error) {
      if (error instanceof AuditTargetError) throw new AuditInvocationError(error.message);
      throw error;
    }
  } else {
    const used = LIVE_ONLY.find((name) => values[name] !== undefined && (!Array.isArray(values[name]) || values[name].length > 0));
    if (used) throw new AuditInvocationError(`--${used} applies only when the target is a URL`);
    const distDir = resolve(cwd, target);
    if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
      throw new AuditInvocationError(`build directory not found: ${target}`);
    }
    try {
      result = auditDist(distDir, { base: values.base, heuristics: values.heuristics, schemaTarget });
    } catch (error) {
      if (error instanceof UnsafeAuditRootError) throw new AuditInvocationError(error.message);
      throw error;
    }
  }

  const report = createAuditReport({
    toolVersion: context.version,
    // Dist targets are relative; public URL targets omit credentials, queries and fragments.
    target: live
      ? { kind: 'url', value: new URL(target).origin + new URL(target).pathname }
      : { kind: 'dist', value: relative(cwd, resolve(cwd, target)).split('\\').join('/') || '.' },
    findings: result.findings,
    pagesChecked: result.pagesChecked,
    languageCount: result.languageCount,
    applicability:result.applicability,
    ...(result.scope ? { scope: result.scope } : {}),
    score: !values['no-score'],
  });
  const output = renderAuditReport(report, format, { failOn });
  const failed = report.findings.some((finding) => failsGate(finding.severity, failOn));
  const exports = [
    {file:values.output,text:output},
    {file:values['github-output'],text:renderAuditReport(report,'github',{failOn})},
    {file:values['summary-output'],text:renderAuditReport(report,'markdown',{failOn})},
  ].filter((entry) => entry.file);
  const destinations = exports.map((entry) => resolve(cwd,/** @type {string} */ (entry.file)));
  if (new Set(destinations).size !== destinations.length) throw new AuditInvocationError('Audit output files must be distinct.');
  // Render once from a single immutable report, never re-crawl for the Action summary.
  try { for (let i=0;i<exports.length;i++) await writeOutput(destinations[i],exports[i].text); }
  catch { throw new AuditInvocationError('Could not safely write audit output.'); }
  return {exitCode:failed ? 1 : 0,output:values.output ? '' : output,...(values.output ? {written:resolve(cwd,values.output)} : {})};
}

/**
 * @param {string} flag
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 */
function integer(flag, value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER ? `${minimum} or more` : `from ${minimum} to ${maximum}`;
    throw new AuditInvocationError(`${flag} must be a whole number ${range}${flag === '--max-pages' ? ', or "unlimited"' : ''}`);
  }
  return number;
}

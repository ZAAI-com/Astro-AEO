// @ts-check
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { auditDist } from '../src/audit/local.js';
import { AuditTargetError, LIVE_DEFAULTS, auditLive } from '../src/audit/live.js';
import { createAuditReport } from '../src/audit/report.js';
import { isAuditFormat, renderAuditReport } from './formats/index.js';

/** A bad command line or an unreachable target: exit status 2. */
export class AuditInvocationError extends Error {}

const LIVE_ONLY = /** @type {const} */ (['max-pages', 'allow-origin', 'timeout', 'concurrency']);

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
        'fail-on': { type: 'string', default: 'error' },
        'no-score': { type: 'boolean', default: false },
        base: { type: 'string' },
        'max-pages': { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
        timeout: { type: 'string' },
        concurrency: { type: 'string' },
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
  const target = positionals[0] ?? 'dist';
  const live = /^https?:\/\//i.test(target);
  /** @type {ReturnType<typeof auditDist> & { scope?: import('../src/index.js').AuditCrawlScope }} */
  let result;
  if (live) {
    if (values.base) throw new AuditInvocationError('--base applies to a build directory, not a URL');
    try {
      result = await auditLive(target, {
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
    result = auditDist(distDir, { base: values.base });
  }

  const report = createAuditReport({
    toolVersion: context.version,
    // The target is recorded as typed, relative to the working directory, never as an absolute path.
    target: live
      ? { kind: 'url', value: target }
      : { kind: 'dist', value: relative(cwd, resolve(cwd, target)).split('\\').join('/') || '.' },
    findings: result.findings,
    pagesChecked: result.pagesChecked,
    languageCount: result.languageCount,
    ...(result.scope ? { scope: result.scope } : {}),
    score: !values['no-score'],
  });
  const output = renderAuditReport(report, format);
  const failed = failOn === 'none'
    ? false
    : report.summary.errors > 0 || (failOn === 'warning' && report.summary.warnings > 0);
  if (!values.output) return { exitCode: failed ? 1 : 0, output };
  const destination = resolve(cwd, values.output);
  writeAtomically(destination, output);
  return { exitCode: failed ? 1 : 0, output: '', written: destination };
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

/** A reader never sees a half-written report: temp file in the same directory, then rename. */
function writeAtomically(/** @type {string} */ destination, /** @type {string} */ contents) {
  const directory = dirname(destination);
  const temporary = join(directory, `.${basename(destination)}.${process.pid}.tmp`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, contents, 'utf8');
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new AuditInvocationError(`could not write ${destination}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

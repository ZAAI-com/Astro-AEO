#!/usr/bin/env node
// @ts-check
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { validateDist } from '../cli/validate.js';
import { formatReport, formatJson } from '../cli/report.js';
import { prepareIndexNow } from '../cli/indexnow-prepare.js';
import { submitIndexNow } from '../cli/indexnow-submit.js';
import { IndexNowInvocationError } from '../cli/indexnow-io.js';
import { AuditInvocationError, runAudit } from '../cli/audit.js';
import { DoctorInvocationError, runDoctor } from '../cli/doctor.js';
import { FixRefusal, runFix } from '../cli/fix/index.js';

const HELP = `astro-aeo - Answer Engine Optimization for Astro

Usage:
  astro-aeo validate [distDir]   Validate AEO outputs in a build directory (default: ./dist)
  astro-aeo audit [distDir|URL]  Audit a build directory (default: ./dist) or a deployed site
  astro-aeo doctor [projectDir]  Check how this project is set up to deploy (default: .)
  astro-aeo fix [projectDir]     Make a static host serve .md as text/markdown (dry run by default)
  astro-aeo indexnow prepare [distDir] [--source cache|config] [--input <file>]
                               Prepare the private IndexNow queue (default: ./dist)
  astro-aeo indexnow submit [queueFile]
                               Submit pending IndexNow work after deployment
  astro-aeo --help               Show this help
  astro-aeo --version            Show the version

Options for "validate":
  --strict        Treat warnings as errors (exit 1 if any warnings)
  --json          Print a machine-readable JSON report
  --quiet         Suppress warnings in human output
  --base <path>   Site base path, if the build was generated with one

Options for "audit":
  --format <name>   terminal (default), json, sarif, html, markdown, github, or junit
  --output <file>   Write the report to a file instead of standard output
  --fail-on <level> Exit 1 on findings at this level: error (default), warning, or none
  --no-score        Omit the advisory readiness scores and deductions
  --base <path>     Site base path, for a build directory
  --max-pages <n>   URL only: page cap, or "unlimited" (default: 500)
  --allow-origin <origin>
                    URL only, repeatable: another origin the crawl may follow
  --timeout <ms>    URL only: per-request timeout (default: 10000)
  --concurrency <n> URL only: parallel requests, 1 to 32 (default: 8)

Options for "doctor":
  --url <page>      Also probe one deployed page. Without it, local files prove nothing deployed
  --dist <dir>      Build output directory (default: dist)
  --public-dir <d>  Public directory (default: public)
  --json            Print a machine-readable report

Options for "fix":
  --write           Apply the change. The current file is backed up under .astro/aeo-backups/
  --provider <name> cloudflare, netlify, vercel or render; nginx, apache, node, workers or deno print a snippet
  --service <name>  render only: the static site service to edit
  --public-dir <d>  Public directory (default: public)

Options for "indexnow prepare":
  --source <mode> Read sanitized cache input (default) or explicitly load config
  --input <file>  Alternate prepare input; valid only with --source cache
`;

await main();

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    process.exit(command ? 0 : 1);
  }

  if (command === '--version' || command === '-v') {
    process.stdout.write(`${readVersion()}\n`);
    process.exit(0);
  }

  if (command === 'validate') {
    runValidate(argv.slice(1));
    return;
  }

  if (command === 'audit') {
    try {
      const result = await runAudit(argv.slice(1), { version: readVersion() });
      if (result.written) process.stderr.write(`astro-aeo audit: wrote ${result.written}\n`);
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    } catch (error) {
      // An unexpected failure is not a finding, so it never reports as exit 1.
      const prefix = error instanceof AuditInvocationError ? '' : 'audit failed: ';
      process.stderr.write(`astro-aeo: ${prefix}${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
    return;
  }

  if (command === 'doctor' || command === 'fix') {
    try {
      if (command === 'doctor') {
        const result = await runDoctor(argv.slice(1));
        process.stdout.write(result.output);
        process.exitCode = result.exitCode;
      } else {
        process.stdout.write((await runFix(argv.slice(1))).output);
      }
    } catch (error) {
      const refused = error instanceof DoctorInvocationError || error instanceof FixRefusal;
      process.stderr.write(`astro-aeo: ${refused ? '' : `${command} failed: `}${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
    return;
  }

  if (command === 'indexnow') {
    await runIndexNow(argv.slice(1));
    return;
  }

  process.stderr.write(`astro-aeo: unknown command "${command}"\n\n${HELP}`);
  process.exit(2);
}

/** @param {string[]} args */
async function runIndexNow(args) {
  const action = args[0];
  try {
    if (action === 'prepare') {
      const parsed = parseArgs({
        args: args.slice(1),
        allowPositionals: true,
        options: {
          source: { type: 'string', default: 'cache' },
          input: { type: 'string' },
        },
      });
      if (parsed.positionals.length > 1) throw new IndexNowInvocationError('indexnow prepare accepts at most one distDir');
      if (parsed.values.source !== 'cache' && parsed.values.source !== 'config') {
        throw new IndexNowInvocationError('--source must be cache or config');
      }
      if (parsed.values.input && parsed.values.source !== 'cache') {
        throw new IndexNowInvocationError('--input is valid only with --source cache');
      }
      const result = await prepareIndexNow(resolve(parsed.positionals[0] ?? 'dist'), {
        source: parsed.values.source,
        ...(parsed.values.input ? { input: resolve(parsed.values.input) } : {}),
      });
      for (const warning of result.warnings) process.stderr.write(`astro-aeo: warning: ${warning}\n`);
      process.stdout.write(
        `astro-aeo indexnow prepare: ${result.operations} URL operation(s) across ${result.origins} origin(s)\n`,
      );
      process.exit(0);
    }
    if (action === 'submit') {
      const parsed = parseArgs({ args: args.slice(1), allowPositionals: true, options: {} });
      if (parsed.positionals.length > 1) throw new IndexNowInvocationError('indexnow submit accepts at most one queueFile');
      const queueFile = resolve(parsed.positionals[0] ?? join('.astro', 'aeo-cache', 'indexnow', 'pending-v1.json'));
      const result = await submitIndexNow(queueFile);
      for (const warning of result.warnings) process.stderr.write(`astro-aeo: warning: ${warning}\n`);
      process.stdout.write(
        `astro-aeo indexnow submit: ${result.submitted} submitted, ${result.pending} pending\n`,
      );
      process.exit(result.strictFailure ? 1 : 0);
    }
    throw new IndexNowInvocationError('indexnow requires "prepare" or "submit"');
  } catch (error) {
    if (error instanceof IndexNowInvocationError) {
      process.stderr.write(`astro-aeo: ${error.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`astro-aeo: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

/**
 * @param {string[]} args
 */
function runValidate(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        strict: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        base: { type: 'string' },
      },
    });
  } catch (err) {
    process.stderr.write(`astro-aeo: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
    return;
  }

  const distDir = resolve(parsed.positionals[0] ?? 'dist');
  const result = validateDist(distDir, { base: parsed.values.base });

  if (parsed.values.json) {
    process.stdout.write(`${formatJson(result)}\n`);
  } else {
    process.stdout.write(`${formatReport(result, { quiet: parsed.values.quiet, strict: parsed.values.strict })}\n`);
  }

  if (!result.ok) process.exit(1);
  if (parsed.values.strict && result.warnings.length > 0) process.exit(1);
  process.exit(0);
}

/**
 * @returns {string}
 */
function readVersion() {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

#!/usr/bin/env node
// @ts-check
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { validateDist } from '../cli/validate.js';
import { formatReport, formatJson } from '../cli/report.js';

const HELP = `astro-aeo - Answer Engine Optimization for Astro

Usage:
  astro-aeo validate [distDir]   Validate AEO outputs in a build directory (default: ./dist)
  astro-aeo --help               Show this help
  astro-aeo --version            Show the version

Options for "validate":
  --strict        Treat warnings as errors (exit 1 if any warnings)
  --json          Print a machine-readable JSON report
  --quiet         Suppress warnings in human output
  --base <path>   Site base path, if the build was generated with one
`;

main();

function main() {
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

  process.stderr.write(`astro-aeo: unknown command "${command}"\n\n${HELP}`);
  process.exit(2);
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

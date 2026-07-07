// @ts-check

/**
 * Render a validation result for humans.
 * @param {import('./validate.js').ValidateResult} result
 * @param {{ quiet?: boolean; strict?: boolean }} [opts]
 * @returns {string}
 */
export function formatReport(result, opts = {}) {
  const lines = [];
  for (const e of result.errors) lines.push(`  x [${e.code}] ${e.message}`);
  if (!opts.quiet) for (const w of result.warnings) lines.push(`  ! [${w.code}] ${w.message}`);

  // Under --strict, warnings also fail the run (matching the CLI's exit code),
  // so the printed verdict must reflect that too.
  const failed = !result.ok || (opts.strict === true && result.warnings.length > 0);
  const summary =
    `astro-aeo validate: ${result.errors.length} error(s), ${result.warnings.length} warning(s) ` +
    `across ${result.pagesChecked} page(s)`;
  lines.push('');
  lines.push(failed ? `${summary} - FAIL` : `${summary} - PASS`);
  return lines.join('\n');
}

/**
 * @param {import('./validate.js').ValidateResult} result
 * @returns {string}
 */
export function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

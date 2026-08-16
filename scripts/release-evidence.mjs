/**
 * Validate the committed human sign-off record without attempting to automate
 * either external validator. This check only prevents a tag from publishing a
 * record that still says its required review is incomplete.
 *
 * @param {string} source
 * @param {string} version
 * @returns {string[]}
 */
export function releaseEvidenceErrors(source, version) {
  const errors = [];
  const lines = source.split(/\r?\n/);
  if (!lines.includes(`# Astro-AEO ${version} semantic validation evidence`)) {
    errors.push(`semantic validation evidence heading does not match ${version}`);
  }
  if (!lines.includes('| Release | `' + version + '` |')) {
    errors.push(`semantic validation evidence release does not match ${version}`);
  }
  if (!/^\| Overall status \| \*\*Passed\*\* \|$/m.test(source)) {
    errors.push('semantic validation evidence overall status is not Passed');
  }
  if (/\bPending\b/i.test(source)) {
    errors.push('semantic validation evidence still contains Pending values');
  }

  const checkboxes = [...source.matchAll(/^- \[([ xX])\]/gm)];
  if (checkboxes.length === 0) {
    errors.push('semantic validation evidence has no release sign-off checklist');
  } else if (checkboxes.some((match) => match[1].toLowerCase() !== 'x')) {
    errors.push('semantic validation evidence release sign-off is incomplete');
  }
  return errors;
}

import { describe, expect, test } from 'vitest';
import { releaseEvidenceErrors } from '../scripts/release-evidence.mjs';

const passed = `# Astro-AEO 1.2.0 semantic validation evidence

| Field | Value |
| --- | --- |
| Release | \`1.2.0\` |
| Overall status | **Passed** |

- [x] The final commit is recorded.
- [X] External validation is complete.
`;

describe('release semantic validation evidence', () => {
  test('accepts a matching passed record with complete sign-off', () => {
    expect(releaseEvidenceErrors(passed, '1.2.0')).toEqual([]);
  });

  test('rejects pending values and incomplete sign-off', () => {
    const pending = passed
      .replace('**Passed**', '**Pending: required before the tag**')
      .replace('External validation is complete.', 'External validation: Pending.')
      .replace('- [X]', '- [ ]');
    expect(releaseEvidenceErrors(pending, '1.2.0')).toEqual(expect.arrayContaining([
      expect.stringContaining('not Passed'),
      expect.stringContaining('Pending'),
      expect.stringContaining('incomplete'),
    ]));
  });

  test('rejects a record for a different package version', () => {
    expect(releaseEvidenceErrors(passed, '1.2.1')).toEqual(expect.arrayContaining([
      expect.stringContaining('heading'),
      expect.stringContaining('release'),
    ]));
  });
});

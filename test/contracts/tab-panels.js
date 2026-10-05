import { expect } from 'vitest';

// One byte-for-byte body contract for static build, development, and Node SSR.
// Site-specific frontmatter is the only part omitted from the comparison.
export const TAB_PANELS_MARKDOWN = `# Tab Content

## Visible tab

Visible panel instructions.

## Hidden tab

Hidden panel instructions.

![Inactive panel diagram](https://example.com/tab-diagram.png)

### Nested tab

Nested panel instructions.

## ARIA-hidden tab

ARIA-hidden panel instructions.`;

export function verifyTabPanels(markdown, fullCorpus) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  expect(body).toBe(TAB_PANELS_MARKDOWN);
  expect(fullCorpus).toContain(TAB_PANELS_MARKDOWN);
  for (const excluded of [
    'Visible tab control',
    'Inactive tab control',
    'UNRELATED-HIDDEN-DESCENDANT',
    'HIDDEN-PANEL-CONTROL',
    'UNRELATED-HIDDEN-ANCESTOR',
    'HIDDEN-NAVIGATION',
    'TEMPLATE-PANEL',
    'astro-aeo-marker',
  ]) {
    expect(markdown).not.toContain(excluded);
    expect(fullCorpus).not.toContain(excluded);
  }
}

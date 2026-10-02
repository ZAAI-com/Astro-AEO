import { expect, test } from 'vitest';
import { planMarkdownUnits } from './markdown-units.js';

test('keeps consecutive headings and a fenced first block indivisible', () => {
  const fence = '```md\n# Not a heading\n\nbody\n```';
  const units = planMarkdownUnits(`# Guide\n\n## Example\n\n${fence}\n\nNext paragraph.`);
  expect(units).toEqual([
    { text: `# Guide\n\n## Example\n\n${fence}`, startLine: 1, endLine: 9,
      sectionStart: true, headings: ['# Guide', '## Example'] },
    { text: 'Next paragraph.', startLine: 11, endLine: 11, sectionStart: false, headings: [] },
  ]);
});

test('never creates an orphan trailing heading unit', () => {
  expect(planMarkdownUnits('Body.\n\n## Trailing')).toMatchObject([
    { text: 'Body.\n\n## Trailing', startLine: 1, endLine: 3 },
  ]);
  expect(planMarkdownUnits('# Title\n\n## Subtitle')).toHaveLength(1);
  expect(planMarkdownUnits('')).toEqual([]);
});

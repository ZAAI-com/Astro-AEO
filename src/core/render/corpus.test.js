import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../config.js';
import {
  renderGroupedLlmsFullTxt,
  renderGroupedLlmsTxt,
  renderLanguageDirectory,
} from './corpus.js';

const siteMeta = { name: 'Site', description: 'A site.' };
const page = (pathname, title) => ({
  id: pathname,
  pathname,
  url: `https://example.com${pathname}`,
  canonicalUrl: `https://example.com${pathname}`,
  mdHref: `${pathname}.md`,
  title,
  description: `${title} description.`,
  markdown: `${title} body.`,
  aeoTokens: [],
});

describe('locale corpus render helpers', () => {
  test('renders a language directory from already deployed hrefs', () => {
    expect(renderLanguageDirectory(siteMeta, [
      { language: 'en', href: '/en/llms.txt' },
      { language: 'fr', href: 'https://fr.example.com/fr/llms.txt' },
    ])).toBe([
      '# Site', '', '> A site.', '', '## Languages', '',
      '- [en](/en/llms.txt)',
      '- [fr](https://fr.example.com/fr/llms.txt)', '',
    ].join('\n'));
  });

  test('groups index sections beneath stable language headings', () => {
    const config = resolveConfig({ corpus: { index: { sections: [{ title: 'Home', match: '/' }] } } });
    const out = renderGroupedLlmsTxt([
      { language: 'fr', pages: [page('/', 'Accueil')] },
      { language: 'en', pages: [page('/', 'Home')] },
    ], config, siteMeta);
    expect(out.indexOf('## fr')).toBeLessThan(out.indexOf('## en'));
    expect(out).toContain('### Home');
    expect(out).toContain('- [Accueil](/.md): Accueil description.');
  });

  test('renders one preamble and language-grouped full page records', () => {
    const out = renderGroupedLlmsFullTxt([
      { language: 'en', pages: [page('/guide', 'Guide')] },
      { language: 'fr', pages: [page('/guide-fr', 'Guide FR')] },
    ], resolveConfig(), siteMeta);
    expect(out.match(/^# Site$/gm)).toHaveLength(1);
    expect(out).toContain('## en');
    expect(out).toContain('## fr');
    expect(out).toContain('URL: https://example.com/guide');
  });
});

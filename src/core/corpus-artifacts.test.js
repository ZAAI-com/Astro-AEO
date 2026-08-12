import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createLocaleSnapshot } from './locale.js';
import { planCorpusArtifacts } from './corpus-artifacts.js';
import { renderLlmsFullTxt, renderLlmsTxt } from './render/llms-txt.js';

const siteMeta = { name: 'Example', description: 'Corpus fixture' };

function page(pathname, language, locale = language) {
  const canonicalUrl = `https://example.test${pathname}/`;
  return {
    id: pathname,
    pathname,
    url: canonicalUrl,
    canonicalUrl,
    markdownUrl: `https://example.test${pathname}.md`,
    mdHref: `${pathname}.md`,
    title: pathname.slice(1).toUpperCase(),
    description: `${language} page`,
    markdown: `# ${language}\n\nAuthored ${language} content.`,
    language,
    locale,
    origin: 'https://example.test',
    aeoTokens: [],
    directives: {
      index: true,
      includeInLlms: true,
      includeInLlmsFull: true,
      generateMarkdown: true,
    },
    source: { kind: 'rendered', strategy: 'rendered' },
  };
}

describe('logical corpus artifact planner', () => {
  test('preserves the legacy root bytes for one implicit locale', async () => {
    const config = resolveConfig();
    const pages = [{ ...page('/guide', undefined, null), language: undefined, locale: null }];
    const plan = await planCorpusArtifacts({
      pages,
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    expect(plan.artifacts.find(({ pathname }) => pathname === '/llms.txt')?.contents)
      .toBe(renderLlmsTxt(pages, config, siteMeta));
    expect(plan.artifacts.find(({ pathname }) => pathname === '/llms-full.txt')?.contents)
      .toBe(renderLlmsFullTxt(pages, config, siteMeta));
  });

  test('plans locale families, chunks, small corpora, and a host-local manifest', async () => {
    const config = resolveConfig({
      corpus: {
        small: { enabled: true, maxTokens: 1_000 },
        chunks: { enabled: true, maxTokensPerFile: 1_000 },
        manifest: { enabled: true },
      },
      i18n: { indexes: 'auto' },
    });
    const i18n = createLocaleSnapshot({
      locales: ['en', { path: 'fr', codes: ['fr-FR', 'fr'] }],
      defaultLocale: 'en',
      routing: { prefixDefaultLocale: true },
    }, 'https://example.test');
    const plan = await planCorpusArtifacts({
      pages: [page('/en/guide', 'en', 'en'), page('/fr/guide', 'fr-FR', 'fr')],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '/docs',
      i18n,
    });
    const paths = plan.artifacts.map(({ pathname }) => pathname);

    expect(paths).toContain('/llms.txt');
    expect(paths).toContain('/en/llms.txt');
    expect(paths).toContain('/fr/llms-full.txt');
    expect(paths).toContain('/en/llms-small.txt');
    expect(paths.some((pathname) => pathname.startsWith('/fr/llms/pages-'))).toBe(true);
    expect(plan.artifacts.find(({ pathname }) => pathname === '/llms.txt')?.contents)
      .toContain('## Languages');
    expect(plan.manifest).toMatchObject({
      version: 1,
      origin: 'https://example.test',
      base: '/docs',
      tokenizer: { name: 'astro-aeo-approx', version: '1', approximate: true },
    });
    expect(plan.manifest.locales.map(({ locale }) => locale)).toEqual(['en', 'fr']);
    expect(plan.manifest.artifacts.every(({ encoding }) => encoding === 'identity')).toBe(true);
    expect(plan.manifestText.endsWith('\n')).toBe(true);
  });

  test('emits byte-copy aliases only in both mode', async () => {
    const config = resolveConfig({
      corpus: { small: { enabled: true, maxTokens: 1_000 } },
      i18n: { indexes: 'both' },
    });
    const plan = await planCorpusArtifacts({
      pages: [page('/en/guide', 'en', 'en')],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
      i18n: createLocaleSnapshot({ locales: ['en'], defaultLocale: 'en' }, 'https://example.test'),
    });

    for (const [alias, source] of [
      ['/llms-en.txt', '/en/llms.txt'],
      ['/llms-full-en.txt', '/en/llms-full.txt'],
      ['/llms-small-en.txt', '/en/llms-small.txt'],
    ]) {
      const aliasArtifact = plan.artifacts.find(({ pathname }) => pathname === alias);
      const sourceArtifact = plan.artifacts.find(({ pathname }) => pathname === source);
      expect(aliasArtifact).toMatchObject({ kind: 'alias', sourcePathname: source });
      expect(aliasArtifact.contents).toBe(sourceArtifact.contents);
    }
  });

  test('keeps domain plans host-local while linking every active language', async () => {
    const config = resolveConfig({ corpus: { manifest: { enabled: true } } });
    const i18n = createLocaleSnapshot({
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      domains: { fr: 'https://fr.example.test' },
    }, 'https://example.test');
    const english = page('/en/guide', 'en', 'en');
    const french = {
      ...page('/fr/guide', 'fr', 'fr'),
      origin: 'https://fr.example.test',
      url: 'https://fr.example.test/fr/guide/',
      canonicalUrl: 'https://fr.example.test/fr/guide/',
      markdownUrl: 'https://fr.example.test/fr/guide.md',
    };
    const plan = await planCorpusArtifacts({
      pages: [english, french],
      config,
      siteMeta,
      origin: 'https://fr.example.test',
      base: '',
      i18n,
    });

    expect(plan.artifacts.map(({ pathname }) => pathname)).toEqual([
      '/fr/llms.txt',
      '/fr/llms-full.txt',
      '/llms.txt',
    ]);
    expect(plan.artifacts.find(({ pathname }) => pathname === '/llms.txt')?.contents)
      .toContain('https://example.test/en/llms.txt');
    expect(plan.manifest.pages).toHaveLength(1);
    expect(plan.manifest.pages[0].origin).toBe('https://fr.example.test');
  });
});

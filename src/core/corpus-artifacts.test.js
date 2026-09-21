import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createLocaleSnapshot } from './locale.js';
import { planCorpusArtifacts } from './corpus-artifacts.js';
import { renderLlmsFullTxt, renderLlmsTxt } from './render/llms-txt.js';

const siteMeta = { name: 'Example', description: 'Corpus fixture' };

function page(pathname, language, locale = language, origin = 'https://example.test') {
  const canonicalUrl = `${origin}${pathname}/`;
  return {
    id: pathname,
    pathname,
    url: canonicalUrl,
    canonicalUrl,
    markdownUrl: `${origin}${pathname}.md`,
    mdHref: `${pathname}.md`,
    title: pathname.slice(1).toUpperCase(),
    description: `${language} page`,
    markdown: `# ${language}\n\nAuthored ${language} content.`,
    language,
    locale,
    origin,
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

  test('rejects an unresolved locale group beside concrete locales in auto mode', async () => {
    const config = resolveConfig({ i18n: { indexes: 'auto' } });
    const plan = await planCorpusArtifacts({
      pages: [page('/guide', undefined, null), page('/en/guide', 'en', 'en')],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    expect(plan.artifacts).toEqual([]);
    expect(plan.manifest).toBeUndefined();
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ code: 'corpus-locale-required', severity: 'error' }),
    ]);
  });

  test('rejects an unresolved group when another origin supplies the second locale', async () => {
    const config = resolveConfig({ i18n: { indexes: 'auto' } });
    const plan = await planCorpusArtifacts({
      // This host contributes one unresolved group, so a host-local check sees a
      // single locale and permits the legacy root layout. Topology selection uses
      // the complete set, takes the locale-family path, and would publish /null/.
      pages: [
        page('/guide', undefined, null),
        page('/guide', 'en', 'en', 'https://other.test'),
      ],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    expect(plan.artifacts.map(({ pathname }) => pathname)).not.toContain('/null/llms.txt');
    expect(plan.artifacts).toEqual([]);
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ code: 'corpus-locale-required', severity: 'error' }),
    ]);
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

  // src/build/collect.js only sets `origin` on a page when a catalog descriptor carries
  // one, so ordinary rendered pages have none. The chunk map keyed on the site origin and
  // the page records keyed on the page, so the two never met and every page advertised an
  // empty chunk list while chunk artifacts existed.
  test('links chunk artifacts to pages that carry no origin of their own', async () => {
    const config = resolveConfig({
      corpus: {
        chunks: { enabled: true, maxTokensPerFile: 1_000 },
        manifest: { enabled: true },
      },
    });
    const { origin: _origin, ...originless } = page('/guide', 'en');
    const plan = await planCorpusArtifacts({
      pages: [originless],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    expect(plan.artifacts.some(({ kind }) => kind === 'chunk')).toBe(true);
    expect(plan.manifest.pages).toHaveLength(1);
    expect(plan.manifest.pages[0].chunks.length).toBeGreaterThan(0);
  });

  test('records a page version in the manifest and leaves unversioned bytes untouched', async () => {
    const config = resolveConfig({ corpus: { manifest: { enabled: true } } });
    const plan = (/** @type {any[]} */ pages) =>
      planCorpusArtifacts({ pages, config, siteMeta, origin: 'https://example.test', base: '' });

    const plain = await plan([page('/guide', 'en')]);
    expect(plain.manifestText).not.toContain('"version":"');
    expect(plain.manifest.pages[0]).not.toHaveProperty('version');

    const versioned = await plan([{ ...page('/guide', 'en'), version: 'v2' }]);
    expect(versioned.manifest.pages[0].version).toBe('v2');
    // A version is metadata: it changes no corpus artifact.
    expect(versioned.artifacts).toEqual(plain.artifacts);
  });

  // Chunks are planned per locale group, so the chunk map is scoped by locale as
  // well as origin. Two pages sharing a pathname across locales (domain-routed
  // i18n, or catalog pages while the site origin is empty) must each be credited
  // with only their own locale's chunk artifacts.
  test('keeps chunk links locale-scoped when two locales share a pathname', async () => {
    const config = resolveConfig({
      corpus: {
        chunks: { enabled: true, maxTokensPerFile: 1_000 },
        manifest: { enabled: true },
      },
    });
    const plan = await planCorpusArtifacts({
      pages: [page('/guide', 'en', 'en'), page('/guide', 'fr', 'fr')],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    const englishChunks = plan.artifacts
      .filter(({ kind, locale }) => kind === 'chunk' && locale === 'en')
      .map(({ pathname }) => pathname);
    const frenchChunks = plan.artifacts
      .filter(({ kind, locale }) => kind === 'chunk' && locale === 'fr')
      .map(({ pathname }) => pathname);
    const english = plan.manifest.pages.find((entry) => entry.locale === 'en');
    const french = plan.manifest.pages.find((entry) => entry.locale === 'fr');

    expect(englishChunks.length).toBeGreaterThan(0);
    expect(frenchChunks.length).toBeGreaterThan(0);
    expect(english.chunks).toEqual(englishChunks);
    expect(french.chunks).toEqual(frenchChunks);
    expect(english.chunks).not.toEqual(french.chunks);
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

  test('carries the dev-preview note into every non-chunk artifact', async () => {
    const note = '<!-- dev preview -->';
    const config = resolveConfig({
      corpus: {
        small: { enabled: true, maxTokens: 1_000 },
        chunks: { enabled: true, maxTokensPerFile: 1_000 },
        manifest: { enabled: true },
      },
      i18n: { indexes: 'both' },
    });
    const plan = await planCorpusArtifacts({
      pages: [page('/en/guide', 'en', 'en'), page('/fr/guide', 'fr-FR', 'fr')],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
      note,
      i18n: createLocaleSnapshot({
        locales: ['en', 'fr'],
        defaultLocale: 'en',
        routing: { prefixDefaultLocale: true },
      }, 'https://example.test'),
    });

    expect(plan.artifacts.length).toBeGreaterThan(0);
    for (const artifact of plan.artifacts) {
      if (artifact.kind === 'chunk') {
        expect(artifact.contents).not.toContain(note);
      } else {
        expect(artifact.contents).toContain(note);
      }
      expect(artifact.contents.split('\n')[0].startsWith('# ')).toBe(true);
    }
    for (const alias of plan.artifacts.filter(({ kind }) => kind === 'alias')) {
      const source = plan.artifacts.find(({ pathname }) => pathname === alias.sourcePathname);
      expect(alias.contents).toBe(source.contents);
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

  test('selects the shared global artifact for a single-locale domain host', async () => {
    const config = resolveConfig({
      corpus: { manifest: { enabled: true } },
      i18n: { indexes: 'global' },
    });
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

    expect(plan.diagnostics).toEqual([]);
    expect(plan.manifest.locales).toEqual([
      expect.objectContaining({ locale: 'fr', canonicalArtifact: '/llms.txt' }),
    ]);
  });

  test('keeps per-locale token counts when two locales share a page id', async () => {
    const { renderMarkdownDocument } = await import('./render/markdown-doc.js');
    const { countApproximateTokens } = await import('./corpus-tokenizer.js');
    const config = resolveConfig({ corpus: { manifest: { enabled: true } } });
    const english = page('/guide', 'en', 'en');
    const french = {
      ...page('/guide', 'fr', 'fr'),
      markdown: `# fr\n\n${'Contenu français nettement plus long. '.repeat(12)}`,
    };
    const plan = await planCorpusArtifacts({
      pages: [english, french],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });

    const counts = Object.fromEntries(plan.manifest.pages.map((entry) => [entry.locale, entry.tokenCount]));
    expect(counts.en).toBe(countApproximateTokens(renderMarkdownDocument(english, config)));
    expect(counts.fr).toBe(countApproximateTokens(renderMarkdownDocument(french, config)));
    expect(counts.en).not.toBe(counts.fr);
  });

  test('hashes published companion Markdown and nulls companion-less pages', async () => {
    const { renderMarkdownDocument } = await import('./render/markdown-doc.js');
    const { sha256Digest } = await import('./corpus-manifest.js');
    const { normalizePublishedText, countApproximateTokens } = await import('./corpus-tokenizer.js');
    const config = resolveConfig({
      corpus: { manifest: { enabled: true }, index: { includeHtmlOnly: true } },
      markdown: { includeLastModified: true },
    });
    const withCompanion = {
      ...page('/about', 'en', 'en'),
      lastModified: '2024-01-15T00:00:00.000Z',
    };
    const withoutCompanion = {
      ...page('/secret', 'en', 'en'),
      directives: {
        index: true,
        includeInLlms: true,
        includeInLlmsFull: true,
        generateMarkdown: false,
      },
    };
    const plan = await planCorpusArtifacts({
      pages: [withCompanion, withoutCompanion],
      config,
      siteMeta,
      origin: 'https://example.test',
      base: '',
    });
    const about = plan.manifest.pages.find((entry) => entry.id === '/about');
    const secret = plan.manifest.pages.find((entry) => entry.id === '/secret');
    const published = renderMarkdownDocument(withCompanion, config);
    expect(about.hash).toBe(await sha256Digest(normalizePublishedText(published)));
    expect(about.tokenCount).toBe(countApproximateTokens(published));
    expect(secret).toMatchObject({
      markdownUrl: null,
      tokenCount: null,
      hash: null,
    });
  });
});

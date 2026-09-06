import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createLocaleSnapshot } from '../core/locale.js';
import { stageCorpusArtifacts } from './corpus.js';

const SITE = 'https://example.test';
const FR_SITE = 'https://fr.example.test';
const siteMeta = { name: 'Example', description: 'Corpus fixture' };

/** The smallest record that satisfies participatesInCorpus and renderMarkdownDocument. */
function page(pathname, locale, origin = SITE) {
  const canonicalUrl = `${origin}${pathname}/`;
  return {
    id: pathname,
    pathname,
    url: canonicalUrl,
    canonicalUrl,
    markdownUrl: `${origin}${pathname}.md`,
    mdHref: `${pathname}.md`,
    title: pathname.slice(1).toUpperCase(),
    description: `${locale} page`,
    markdown: `# ${locale}\n\nAuthored ${locale} content.`,
    language: locale,
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

// stageCorpusArtifacts ignores write()'s return value and never passes `path`.
function fakeWriter() {
  const writes = [];
  return { writes, write(artifact) { writes.push(artifact); return true; } };
}

function environment(overrides = {}) {
  return {
    siteUrl: SITE,
    base: '',
    siteMeta,
    writer: fakeWriter(),
    diagnostics: [],
    i18n: createLocaleSnapshot(
      { locales: ['en', 'fr'], defaultLocale: 'en', domains: { fr: FR_SITE } },
      SITE,
    ),
    ...overrides,
  };
}

const twoDomains = () => [page('/en/guide', 'en'), page('/fr/guide', 'fr', FR_SITE)];

describe('stageCorpusArtifacts', () => {
  // Astro honours i18n.domains only under SSR and rejects prerendered routes in
  // that mode, so every route is on demand and middleware owns the corpus. The
  // build still has to reserve the right ownership claims.
  test('reserves the multi-domain topology instead of a legacy root index', async () => {
    const env = environment({ runtime: true });
    const result = await stageCorpusArtifacts(twoDomains(), resolveConfig(), env);

    expect(env.writer.writes.map(({ route }) => route)).toEqual([
      '/en/llms.txt',
      '/en/llms-full.txt',
      '/llms.txt',
    ]);
    expect(result.artifacts.map(({ pathname }) => pathname)).toEqual([
      '/en/llms.txt',
      '/en/llms-full.txt',
      '/llms.txt',
    ]);
    expect(env.writer.writes.every(({ runtime }) => runtime === true)).toBe(true);
    expect(env.writer.writes.map(({ owner }) => owner.name))
      .toEqual(['llmsTxt', 'llmsFullTxt', 'llmsTxt']);
    expect(env.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  test('links the other domain from the root language directory', async () => {
    const env = environment({ runtime: true });
    const result = await stageCorpusArtifacts(twoDomains(), resolveConfig(), env);
    const directory = result.artifacts.find(({ pathname }) => pathname === '/llms.txt');

    expect(directory.contents).toContain('/en/llms.txt');
    expect(directory.contents).toContain(`${FR_SITE}/fr/llms.txt`);
  });

  // A static two-origin plan is reachable through a pages.catalogs descriptor
  // that declares an origin. The plan must stay host-local: only the primary
  // origin's locale gets artifacts, pages, and manifest records.
  test('keeps a static two-origin plan host-local across gzip and the manifest', async () => {
    const env = environment();
    const config = resolveConfig({
      corpus: { manifest: { enabled: true }, compression: { gzip: true } },
    });
    const result = await stageCorpusArtifacts(twoDomains(), config, env);

    expect(env.writer.writes.map(({ route }) => route)).toEqual([
      '/en/llms.txt',
      '/en/llms-full.txt',
      '/llms.txt',
      '/en/llms.txt.gz',
      '/en/llms-full.txt.gz',
      '/llms.txt.gz',
      '/llms/manifest.json',
    ]);
    expect(env.writer.writes
      .filter(({ route }) => route.endsWith('.gz'))
      .every(({ contentType, owner }) =>
        contentType === 'application/gzip' && owner.name === 'corpusGzip')).toBe(true);
    expect(result.manifest.pages.map(({ origin }) => origin)).toEqual([SITE]);
    expect(result.manifest.locales).toEqual([expect.objectContaining({
      origin: SITE,
      locale: 'en',
      canonicalArtifact: '/en/llms.txt',
    })]);
    expect(result.manifest.artifacts.filter(({ encoding }) => encoding === 'gzip'))
      .toHaveLength(3);
  });

  test('still drops corpus-excluded pages', async () => {
    const env = environment();
    const result = await stageCorpusArtifacts(
      [page('/en/guide', 'en'), { ...page('/en/secret', 'en'), corpusExcluded: true }],
      resolveConfig(),
      env,
    );
    const index = result.artifacts.find(({ kind }) => kind === 'index');

    expect(index.contents).toContain('/en/guide');
    expect(index.contents).not.toContain('/en/secret');
  });
});

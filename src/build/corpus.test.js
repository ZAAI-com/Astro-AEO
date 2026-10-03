import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { createLocaleSnapshot } from '../core/locale.js';
import { planCorpusArtifacts } from '../core/corpus-artifacts.js';
import { stageCorpusArtifacts } from './corpus.js';
import { canonicalStringify } from './processing-cache.js';

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
// `preview()` mirrors the transactional writer: every registered claim appears
// with its ownership status, overridable per served pathname.
function fakeWriter(rejections = new Map()) {
  const writes = [];
  return {
    writes,
    write(artifact) { writes.push(artifact); return true; },
    preview() {
      return {
        manifestEntries: writes.map(({ route }) => ({
          pathname: route,
          status: rejections.get(route) ?? 'emitted',
        })),
      };
    },
  };
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
  test('build and runtime archive manifests share the same logical contract', async () => {
    const pages = [page('/en/guide', 'en'), { ...page('/en/v1/guide', 'en'), version: 'v1' }];
    const config = resolveConfig({ corpus: { versions: { current: 'v2' }, manifest: { enabled: true } } });
    const env = environment();
    await stageCorpusArtifacts(pages, config, env);
    const runtime = await planCorpusArtifacts({ pages, config, i18n: env.i18n, origin: SITE,
      base: '', siteMeta, requestTime: true });
    const scoped = env.writer.writes.find((record) => record.route === '/v1/llms/manifest.json');
    expect(scoped.contents).toBe(runtime.manifests[0].contents);
  });

  test('keeps archive gzip and aliases deterministic and withholds manifests after canonical ownership loss', async () => {
    const pages = [page('/en/guide', 'en'), { ...page('/en/v1/guide', 'en'), version: 'v1' }];
    const config = resolveConfig({ i18n: { indexes: 'both' }, corpus: { versions: { current: 'v2' },
      compression: { gzip: true }, manifest: { enabled: true } } });
    const env = environment();
    const first = await stageCorpusArtifacts(pages, config, env);
    const secondEnv = environment();
    await stageCorpusArtifacts(pages, config, secondEnv);
    expect(secondEnv.writer.writes).toEqual(env.writer.writes);
    const scoped = env.writer.writes.find((record) => record.route === '/v1/llms/manifest.json');
    expect(JSON.parse(scoped.contents).artifacts.every((record) => record.version === 'v1')).toBe(true);
    expect(first.manifest.artifacts).toContainEqual(expect.objectContaining({
      pathname: '/en/v1/llms-full.txt.gz', sourcePathname: '/en/v1/llms-full.txt', version: 'v1',
    }));
    const conflictEnv = environment({ writer: fakeWriter(new Map([['/en/v1/llms.txt', 'preserved']])) });
    const conflict = await stageCorpusArtifacts(pages, config, conflictEnv);
    expect(conflict.manifest).toBeUndefined();
    expect(conflictEnv.writer.writes.some((record) => record.route.endsWith('/manifest.json'))).toBe(false);
  });

  test('a locale edit invalidates its full family, not other locales or unchanged index text', async () => {
    const entries = new Map();
    const misses = [];
    const cache = {
      key: (stage, inputs) => `${stage}:${canonicalStringify(inputs)}`,
      get(key) { if (!entries.has(key)) misses.push(key); return entries.get(key); },
      put: (key, value) => entries.set(key, value),
    };
    const pages = [page('/en/guide', 'en'), page('/fr/guide', 'fr')];
    const config = resolveConfig({ i18n: { indexes: 'both' }, corpus: { compression: { gzip: true } } });
    const build = (pages) => stageCorpusArtifacts(pages, config, environment({ cache,
      i18n: createLocaleSnapshot({ locales: ['en', 'fr'], defaultLocale: 'en' }, SITE) }));
    await build(pages); misses.length = 0;
    await build(pages); expect(misses).toEqual([]);
    const edited = [{ ...pages[0], markdown: 'Edited English body' }, pages[1]];
    const result = await build(edited);
    const textMisses = misses.filter((key) => key.startsWith('artifact-text-v1:'))
      .map((key) => JSON.parse(key.slice('artifact-text-v1:'.length)).pathname).sort();
    expect(textMisses).toEqual(['/en/llms-full.txt', '/llms-full.txt']);
    expect(result.artifacts.find((artifact) => artifact.pathname === '/en/llms-full.txt').contents).toContain('Edited English body');
    expect(result.artifacts.find((artifact) => artifact.pathname === '/fr/llms-full.txt').contents).toContain('Authored fr content');
  });

  test('function-dependent section rendering bypasses text reuse without disabling tokenization', async () => {
    const entries = new Map();
    const writes = [];
    const cache = { key: (stage, inputs) => `${stage}:${canonicalStringify(inputs)}`,
      get: (key) => entries.get(key), put(key, value) { writes.push(key); entries.set(key, value); } };
    const calls = [];
    const config = resolveConfig({ corpus: { index: { sections: [{ title: 'Custom', match(page) { calls.push(page.pathname); return true; } }] } } });
    for (let index = 0; index < 2; index++) await stageCorpusArtifacts([page('/en/guide', 'en')], config, environment({ cache }));
    expect(calls).toHaveLength(2);
    expect(writes.filter((key) => key.startsWith('artifact-text-v1:'))).toHaveLength(1); // Full text only.
    expect(writes.some((key) => key.startsWith('tokenization-v1:'))).toBe(true);
  });
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

  test('drops artifacts that lost ownership from the manifest and page chunks', async () => {
    const config = resolveConfig({
      corpus: { chunks: { enabled: true, maxTokensPerFile: 1_000 }, manifest: { enabled: true } },
    });
    const env = environment();
    const result = await stageCorpusArtifacts([page('/en/guide', 'en')], config, env);
    const chunkPathnames = result.artifacts.filter(({ kind }) => kind === 'chunk').map(({ pathname }) => pathname);
    expect(chunkPathnames.length).toBeGreaterThan(0);

    const rejected = new Map([[chunkPathnames[0], 'group-skipped']]);
    const filteredEnv = environment({ writer: fakeWriter(rejected) });
    const filtered = await stageCorpusArtifacts([page('/en/guide', 'en')], config, filteredEnv);

    expect(filtered.manifest.artifacts.map(({ pathname }) => pathname)).not.toContain(chunkPathnames[0]);
    expect(filtered.manifest.artifacts.map(({ pathname }) => pathname)).toContain(chunkPathnames[1] ?? '/llms.txt');
    for (const entry of filtered.manifest.pages) {
      expect(entry.chunks).not.toContain(chunkPathnames[0]);
    }
    expect(filteredEnv.diagnostics.filter(({ code }) => code === 'corpus-manifest-skipped')).toEqual([]);
  });

  test('skips the manifest with a warning when a locale canonical artifact was preserved', async () => {
    const config = resolveConfig({ corpus: { manifest: { enabled: true } } });
    const env = environment({ writer: fakeWriter(new Map([['/en/llms.txt', 'preserved']])) });
    const result = await stageCorpusArtifacts(twoDomains(), config, env);

    expect(env.writer.writes.map(({ route }) => route)).not.toContain('/llms/manifest.json');
    expect(result.manifest).toBeUndefined();
    expect(env.diagnostics.filter(({ code }) => code === 'corpus-manifest-skipped')).toHaveLength(1);
  });
});

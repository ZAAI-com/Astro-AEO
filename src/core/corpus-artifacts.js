// @ts-check
import { isRagEligible, planRagRecords, serializeRagRecords } from './rag.js';
import { finishRagPlan } from './rag-plan.js';
import { planVersionCorpus } from './version-corpus.js';
import { pageMarkdown } from './render/page-markdown.js';
import { chunkTopology, corpusPathname } from './corpus-topology.js';
export { chunkTopology, isPotentialCorpusArtifactPath } from './corpus-topology.js';
import { allocateSmallCorpus, planSectionChunks } from './corpus-plan.js';
import { chunkPathname, resolveSectionSlugs } from './corpus-blocks.js';
import { createCorpusManifest, serializeCorpusManifest } from './corpus-manifest.js';
import { corpusPageIdentity } from './page-identity.js';
import { CorpusTokenizerError, normalizePublishedText, runCorpusPlanWithTokenizer } from './corpus-tokenizer.js';
import { normalizeOrigin } from './locale.js';
import { renderMarkdownDocument } from './render/markdown-doc.js';
import {
  renderGroupedLlmsFullTxt,
  renderGroupedLlmsTxt,
  renderLanguageDirectory,
} from './render/corpus.js';
import {
  groupSections,
  hasMarkdownCompanion,
  isLlmsEligible,
  renderLlmsFullTxt,
  renderLlmsTxt,
  selectFullTxtPages,
} from './render/llms-txt.js';

/**
 * @typedef {object} CorpusTextArtifact
 * @property {string} pathname
 * @property {'index'|'full'|'small'|'chunk'|'alias'|'rag'} kind
 * @property {string} [version]
 * @property {string|null} locale
 * @property {string|null} section
 * @property {number|null} part
 * @property {number} tokenCount
 * @property {string} contents
 * @property {string|null} sourcePathname
 * @property {string[]} [pageIds]
 */

/**
 * Plan every logical (uncompressed) corpus artifact with no filesystem or Node
 * dependencies. Build output may add gzip siblings after this step; middleware
 * serves these exact strings and relies on transport compression.
 *
 * @param {{
 *   ragHook?: import('./rag-plan.js').RagHook;
 *   deferRagHooks?: boolean;
 *   topologyLocaleCount?: number;
 *   artifactVersion?: { version: string; current: string };
 *   tokenContext?: { tokenizer: { name: string; version: string; approximate: boolean }; count: (text: string) => Promise<number> };
 *   deferEmptyManifest?: boolean;
 *   pages: any[];
 *   config: import('../index.js').ResolvedAstroAeoConfig;
 *   siteMeta: { name: string; description: string };
 *   origin: string;
 *   base: string;
 *   i18n?: import('./locale.js').LocaleSnapshot;
 *   tokenizer?: unknown;
 *   tokenizerOptions?: unknown;
 *   tokenizerProbed?: boolean;
 *   tokenizerFallback?: 'preflight'|'count';
 *   cachedCount?: import('./corpus-tokenizer.js').CachedTokenCount;
 *   cachedRag?: (identity: unknown, produce: () => ReturnType<typeof planRagRecords>) => ReturnType<typeof planRagRecords>;
 *   cachedText?: (identity: unknown, produce: () => string) => Promise<string>;
 *   cachedChunks?: (identity: unknown, produce: () => ReturnType<typeof planSectionChunks>) => ReturnType<typeof planSectionChunks>;
 *   requestTime?: boolean;
 *   note?: string;
 * }} input
 * @returns {Promise<{ artifacts: CorpusTextArtifact[]; ragRecords?: import('../index.js').RagRecordV1[]; manifest?: any; manifestText?: string; manifests?: Array<{ pathname: string; manifest: any; contents: string }>; diagnostics: Array<{ code: string; severity: 'info'|'warning'|'error'; message: string; pathname?: string; details?: unknown }>; tokenizer?: { name: string; version: string; approximate: boolean } }>}
 */
export async function planCorpusArtifacts(input) {
  const plan = input.config.corpus.versions ? await planVersionCorpus(input) : await planUnversionedCorpus(input);
  if (input.deferRagHooks) return plan;
  try { return await finishRagPlan(plan, input); }
  catch (error) {
    if (!(error instanceof CorpusTokenizerError) || input.tokenizer === undefined) throw error;
    // A metadata replacement can make serialized JSONL fail a custom counter
    // after the raw record transaction. Restart every family/version, not just
    // the JSONL counts, so no manifest can mix tokenizer identities.
    const fallbackInput = { ...input, tokenizer: undefined, tokenContext: undefined,
      tokenizerFallback: /** @type {const} */ ('count') };
    const fallback = input.config.corpus.versions
      ? await planVersionCorpus(fallbackInput) : await planUnversionedCorpus(fallbackInput);
    return finishRagPlan(fallback, fallbackInput);
  }
}

/** @param {Parameters<typeof planCorpusArtifacts>[0]} input
 * @returns {ReturnType<typeof planCorpusArtifacts>} */
async function planUnversionedCorpus(input) {
  const origin = normalizeOrigin(input.origin) ?? '';
  const mode = input.config.i18n.indexes;
  const allParticipatingPages = input.pages.filter((page) => !page.corpusExcluded);
  const allLocales = localeGroups(allParticipatingPages, input.i18n, input.config);
  const topologyLocaleCount = input.topologyLocaleCount ?? allLocales.length;
  const participatingPages = allParticipatingPages.filter((page) =>
    !origin || !page.origin || normalizeOrigin(page.origin) === origin);
  const locales = localeGroups(participatingPages, input.i18n, input.config);
  /** @type {Array<{ code: string; severity: 'info'|'warning'|'error'; message: string; pathname?: string; details?: unknown }>} */
  const diagnostics = [];
  // A request-time plan lists the companions the middleware serves, on-demand pages included.
  const companionOptions = { requestTime: input.requestTime === true };
  /** @param {any} page */
  const hasCompanion = (page) => hasMarkdownCompanion(page, input.config, companionOptions);

  // Locale-prefixed families spell the locale into a public path, so an
  // unresolved group may only use the legacy root layout: alone in auto mode.
  // Any other sharing of concrete and unresolved groups is an explicit error
  // rather than a public `/null/` directory.
  // Evaluate against `allLocales`, the same complete set that drives topology
  // selection below. Checking only host-local groups lets a multi-origin `auto`
  // build take the locale-family path while this host's sole group is
  // unresolved, which spells `null` into a public `/null/` directory.
  const unresolvedLocaleGroup = allLocales.some((locale) => locale.locale === null);
  const requiresConcreteLocale = mode === 'locale' || mode === 'both' ||
    (mode === 'auto' && topologyLocaleCount > 1);
  if (requiresConcreteLocale && unresolvedLocaleGroup) {
    diagnostics.push(finding(
      'corpus-locale-required',
      'error',
      `i18n.indexes "${mode}" requires a concrete locale for every corpus page.`,
    ));
    return { artifacts: [], manifest: undefined, diagnostics, tokenizer: undefined };
  }

  /** @param {NonNullable<typeof input.tokenContext>} context */
  const producePlan = async ({ tokenizer, count }) => {
      diagnostics.length = 0; // A failed tokenizer transaction must not retain partial-plan warnings.
      /** @type {CorpusTextArtifact[]} */
      const artifacts = [];
      /**
       * @param {string} pathname
       * @param {CorpusTextArtifact['kind']} kind
       * @param {string|null} locale
       * @param {string|null} section
       * @param {number|null} part
       * @param {string | (() => string)} contents
       * @param {string|null} [sourcePathname]
       * @param {string[]} [pageIds]
       */
      const addText = async (
        pathname,
        kind,
        locale,
        section,
        part,
        contents,
        sourcePathname = null,
        pageIds,
      ) => {
        const produce = typeof contents === 'function' ? contents : () => contents;
        let text;
        if (typeof contents === 'function' && input.cachedText) {
          const directory = ((mode === 'both' || (mode === 'auto' && topologyLocaleCount > 1)) && pathname === '/llms.txt');
          const relevantPages = directory ? [] : locale === null ? participatingPages
            : locales.find((group) => group.locale === locale)?.pages ?? [];
          const identity = {
            pathname, kind, locale, section, part, origin, base: input.base,
            siteMeta: input.siteMeta, note: input.note, artifactVersion: input.artifactVersion,
            ...(locale === null && !directory ? { localeOrder: locales.map((group) => ({
              locale: group.locale, language: group.language, pageIds: group.pages.map(pageId),
            })) } : {}),
            family: directory ? undefined : kind === 'index' ? input.config.corpus.index : { mode: input.config.corpus.full.mode },
            markdown: kind === 'index' && !directory ? { enabled: input.config.markdown.enabled } : undefined,
            pages: relevantPages.map((page) => ({
              pathname: page.pathname, url: page.url, canonicalUrl: page.canonicalUrl, mdHref: page.mdHref,
              locale: page.locale, language: page.language, title: page.title, description: page.description,
              directives: page.directives, aeoTokens: page.aeoTokens, rendering: page.rendering,
              ...(kind === 'index' ? {} : { markdown: pageMarkdown(page) }),
              ...((kind === 'index' && input.config.corpus.index.showLastModified)
                ? { lastModified: page.lastModified } : {}),
            })),
            ...(directory
              ? { directory: allLocales.map((group) => ({ locale: group.locale, language: group.language, origin: group.origin,
                origins: [...new Set(group.pages.map((page) => page.origin))].sort() })) } : {}),
          };
          text = await input.cachedText(identity, produce);
        } else text = produce();
        const normalized = normalizePublishedText(text);
        artifacts.push({
          pathname,
          kind,
          locale,
          section,
          part,
          tokenCount: await count(normalized),
          contents: normalized,
          sourcePathname,
          ...(pageIds ? { pageIds } : {}),
        });
      };

      const oneLocale = topologyLocaleCount <= 1;
      const legacyRoot = oneLocale && (mode === 'auto' || mode === 'global');
      if (legacyRoot) {
        const locale = locales[0];
        const pages = locale?.pages ?? [];
        if (input.config.corpus.index.enabled) {
          await addText(
            '/llms.txt',
            'index',
            locale?.locale ?? null,
            null,
            null,
            () => renderLlmsTxt(pages, input.config, input.siteMeta, { note: input.note }),
          );
        }
        if (input.config.corpus.full.enabled) {
          const selected = selectFullTxtPages(pages, input.config);
          await addText(
            '/llms-full.txt',
            'full',
            locale?.locale ?? null,
            null,
            null,
            () => renderLlmsFullTxt(pages, input.config, input.siteMeta, { note: input.note }),
            null,
            selected.map(pageId),
          );
        }
      } else if (mode === 'global') {
        const grouped = locales.map((locale) => ({ language: locale.language ?? 'und', pages: locale.pages }));
        if (input.config.corpus.index.enabled) {
          await addText('/llms.txt', 'index', null, null, null,
            () => renderGroupedLlmsTxt(grouped, input.config, input.siteMeta, { note: input.note }));
        }
        if (input.config.corpus.full.enabled) {
          await addText(
            '/llms-full.txt',
            'full',
            null,
            null,
            null,
          () => renderGroupedLlmsFullTxt(grouped, input.config, input.siteMeta, { note: input.note }),
            null,
            grouped.flatMap((locale) => selectFullTxtPages(locale.pages, input.config).map(pageId)),
          );
        }
      }

      const localeFamilies = mode === 'locale' || mode === 'both' || (mode === 'auto' && !oneLocale);
      if (localeFamilies) {
        for (const locale of locales) {
          const prefix = `/${encodeURIComponent(/** @type {string} */ (locale.locale))}`;
          if (input.config.corpus.index.enabled) {
            await addText(`${prefix}/llms.txt`, 'index', locale.locale, null, null,
              () => renderLlmsTxt(locale.pages, input.config, input.siteMeta, { note: input.note }));
          }
          if (input.config.corpus.full.enabled) {
            const selected = selectFullTxtPages(locale.pages, input.config);
            await addText(
              `${prefix}/llms-full.txt`,
              'full',
              locale.locale,
              null,
              null,
              () => renderLlmsFullTxt(locale.pages, input.config, input.siteMeta, { note: input.note }),
              null,
              selected.map(pageId),
            );
          }
        }
      }

      if (((mode === 'auto' && !oneLocale) || mode === 'both') && input.config.corpus.index.enabled) {
        await addText('/llms.txt', 'index', null, null, null, () => renderLanguageDirectory(
          input.siteMeta,
          allLocales.map((locale) => ({
            language: locale.language ?? 'und',
            href: localeOriginHref(
              locale,
              origin,
              input.base,
              corpusPathname(`/${encodeURIComponent(/** @type {string} */ (locale.locale))}/llms.txt`,
                { locale: locale.locale, ...input.artifactVersion }),
            ),
          })),
          { note: input.note },
        ));
      }
      if (mode === 'both' && input.config.corpus.full.enabled) {
        const grouped = locales.map((locale) => ({ language: locale.language ?? 'und', pages: locale.pages }));
        await addText(
          '/llms-full.txt',
          'full',
          null,
          null,
          null,
          () => renderGroupedLlmsFullTxt(grouped, input.config, input.siteMeta, { note: input.note }),
          null,
          grouped.flatMap((locale) => selectFullTxtPages(locale.pages, input.config).map(pageId)),
        );
      }

      if (input.config.corpus.small.enabled) {
        if (legacyRoot || mode === 'global') {
          const small = await allocateSmallCorpus({
            siteMeta: input.siteMeta,
            locales: locales.map((locale) => ({
              locale: locale.locale,
              language: locale.language,
              sections: planSections(fullSections(locale.pages, input.config)),
            })),
            groupLanguages: !legacyRoot && locales.length > 1,
            note: input.note,
            maxTokens: input.config.corpus.small.maxTokens,
            count,
          });
          addPlannerDiagnostics(diagnostics, small.diagnostics);
          await addText(
            '/llms-small.txt',
            'small',
            legacyRoot ? locales[0]?.locale ?? null : null,
            null,
            null,
            small.text,
            null,
            small.pages.map((page) => page.id),
          );
        }
        if (localeFamilies) {
          for (const locale of locales) {
            const small = await allocateSmallCorpus({
              siteMeta: input.siteMeta,
              locales: [{
                locale: locale.locale,
                language: locale.language,
                sections: planSections(fullSections(locale.pages, input.config)),
              }],
              groupLanguages: false,
              note: input.note,
              maxTokens: input.config.corpus.small.maxTokens,
              count,
            });
            addPlannerDiagnostics(diagnostics, small.diagnostics, locale.locale);
            await addText(
              `/${encodeURIComponent(/** @type {string} */ (locale.locale))}/llms-small.txt`,
              'small',
              locale.locale,
              null,
              null,
              small.text,
              null,
              small.pages.map((page) => page.id),
            );
          }
        }
        if (mode === 'both') {
          const small = await allocateSmallCorpus({
            siteMeta: input.siteMeta,
            locales: locales.map((locale) => ({
              locale: locale.locale,
              language: locale.language,
              sections: planSections(fullSections(locale.pages, input.config)),
            })),
            groupLanguages: true,
            note: input.note,
            maxTokens: input.config.corpus.small.maxTokens,
            count,
          });
          addPlannerDiagnostics(diagnostics, small.diagnostics);
          await addText('/llms-small.txt', 'small', null, null, null, small.text, null,
            small.pages.map((page) => page.id));
        }
      }

      if (input.config.corpus.chunks.enabled) {
        for (const locale of locales) {
          const sections = fullSections(locale.pages, input.config);
          const slugs = await resolveSectionSlugs(sections.map((section) => section.title));
          for (let index = 0; index < sections.length; index++) {
            const section = sections[index];
            const chunkInput = {
              pages: section.pages.map(planPage),
              maxTokens: input.config.corpus.chunks.maxTokensPerFile,
              count,
            };
            const produce = () => planSectionChunks(chunkInput);
            const result = input.cachedChunks
              ? await input.cachedChunks({ pages: chunkInput.pages, maxTokens: chunkInput.maxTokens,
                  tokenizer, options: input.tokenizerOptions }, produce)
              : await produce();
            addPlannerDiagnostics(diagnostics, result.diagnostics, locale.locale, section.title);
            const topology = chunkTopology(mode, topologyLocaleCount);
            for (const chunk of result.chunks) {
              await addText(
                chunkPathname({
                  locale: topology.root ? null : locale.locale,
                  sectionSlug: slugs[index],
                  part: chunk.part,
                }),
                'chunk',
                locale.locale,
                section.title,
                chunk.part,
                chunk.text,
                null,
                chunk.pageIds,
              );
            }
          }
        }
      }

      if (mode === 'both') {
        for (const locale of locales) {
          const segment = encodeURIComponent(/** @type {string} */ (locale.locale));
          for (const family of /** @type {const} */ ([
            ['index', 'llms', 'llms.txt'],
            ['full', 'llms-full', 'llms-full.txt'],
            ['small', 'llms-small', 'llms-small.txt'],
          ])) {
            const source = artifacts.find((artifact) =>
              artifact.pathname === `/${segment}/${family[2]}` && artifact.kind === family[0]);
            if (!source) continue;
            artifacts.push({
              ...source,
              pathname: `/${family[1]}-${segment}.txt`,
              kind: 'alias',
              sourcePathname: source.pathname,
            });
          }
        }
      }

      /** @type {Map<string, number>} */
      const pageTokenCounts = new Map();
      for (const page of participatingPages) {
        if (!hasCompanion(page)) continue;
        const published = renderMarkdownDocument(page, input.config);
        // Keyed by locale as well: two locales may share a page id on one
        // origin and each owns its companion token count.
        pageTokenCounts.set(`${corpusPageIdentity(page)}\0${page.locale ?? ''}`, await count(published));
      }
      /** @type {any[]} */
      const ragPages = input.config.corpus.rag.enabled ? groupSections(participatingPages.filter(isRagEligible),
        input.config.corpus.index.sections, input.config.corpus.index.defaultSection).flatMap((section) =>
          section.pages.map((page) => ({ ...page, section: section.title }))) : [];
      const produceRag = () => planRagRecords(ragPages, { maxTokens: input.config.corpus.rag.maxTokens, tokenizer, count });
      const rag = !input.config.corpus.rag.enabled ? undefined : input.cachedRag
        ? await input.cachedRag({ maxTokens: input.config.corpus.rag.maxTokens, tokenizer, options: input.tokenizerOptions,
            pages: ragPages.map((page) => ({ pathname: page.pathname, canonicalUrl: page.canonicalUrl ?? page.url,
              locale: page.locale, language: page.language, version: page.version, versionGroup: page.versionGroup,
              title: page.title, section: page.section, markdown: pageMarkdown(page) })) }, produceRag)
        : await produceRag();
      if (rag) {
        diagnostics.push(...rag.diagnostics);
        if (input.config.corpus.rag.publish) {
          const addRag = async (/** @type {string} */ pathname, /** @type {string|null} */ locale,
            /** @type {import('../index.js').RagRecordV1[]} */ records) =>
            addText(pathname, 'rag', locale, null, null, serializeRagRecords(records));
          if (mode === 'global' || mode === 'both' || mode === 'auto' && topologyLocaleCount <= 1)
            await addRag('/llms/rag.jsonl', topologyLocaleCount <= 1 ? locales[0]?.locale ?? null : null, rag.records);
          if (mode === 'locale' || mode === 'both' || mode === 'auto' && topologyLocaleCount > 1)
            for (const locale of locales) await addRag(`/${encodeURIComponent(/** @type {string} */ (locale.locale))}/llms/rag.jsonl`,
              locale.locale, rag.records.filter((record) => record.metadata.locale === locale.locale));
        }
      }
      return { artifacts, tokenizer, pageTokenCounts, ragRecords: rag?.records.map((record) => ({ ...record })) };
    };
  const planned = input.tokenContext
    ? { result: await producePlan(input.tokenContext), tokenizer: input.tokenContext.tokenizer }
    : await runCorpusPlanWithTokenizer(input.tokenizer, input.tokenizerOptions, producePlan,
      { skipProbe: input.tokenizerProbed === true, cachedCount: input.cachedCount });

  const tokenizerFallback = planned.fallback?.reason ?? input.tokenizerFallback ??
    (input.config.corpus.tokenizer && input.tokenizer === undefined ? 'preflight' : undefined);
  if (tokenizerFallback) {
    diagnostics.push(finding(
      'corpus-tokenizer-fallback',
      'warning',
      'The configured tokenizer failed; the complete corpus plan was restarted with astro-aeo-approx@1.',
    ));
  }

  if (tokenizerFallback) for (const record of planned.result.ragRecords ?? []) record.tokenizerFallback = { reason: tokenizerFallback };

  let manifest;
  if (input.config.corpus.manifest.enabled) {
    if (!origin) {
      diagnostics.push(finding(
        'corpus-manifest-origin-missing',
        'error',
        'A corpus manifest requires a stable site origin.',
      ));
    } else if (planned.result.artifacts.length === 0) {
      diagnostics.push(finding(
        'corpus-manifest-canonical-missing',
        'error',
        'The enabled corpus families produced no canonical artifact.',
      ));
    } else {
      const localeRecords = locales.flatMap((locale) => {
        // The shared global artifact is selected against every active locale,
        // including those routed to other domains: a host carrying a single
        // locale still serves the shared root artifact and must claim it.
        const canonical = selectCanonicalArtifact(
          locale.locale,
          planned.result.artifacts,
          mode,
          topologyLocaleCount,
        );
        return canonical
          ? [{
              origin,
              locale: locale.locale,
              language: locale.language,
              canonicalArtifact: withBase(canonical.pathname, input.base),
            }]
          : [];
      });
      if (localeRecords.length !== locales.length || localeRecords.length === 0) {
        diagnostics.push(finding(
          'corpus-manifest-canonical-missing',
          'error',
          'No canonical corpus artifact exists for every active locale.',
        ));
      } else {
        /** @type {Map<string, string[]>} */
        const chunksByPage = new Map();
        for (const artifact of planned.result.artifacts.filter((item) => item.kind === 'chunk')) {
          for (const id of artifact.pageIds ?? []) {
            const key = `${corpusPageIdentity({ origin, id })}\0${artifact.locale ?? ''}`;
            const paths = chunksByPage.get(key) ?? [];
            paths.push(withBase(artifact.pathname, input.base));
            chunksByPage.set(key, paths);
          }
        }
        /** @type {any[]} */
        const pageRecords = [];
        for (const locale of locales) {
          for (const section of manifestSections(locale.pages, input.config)) {
            for (const page of section.pages) {
              const companion = hasCompanion(page);
              const identity = corpusPageIdentity(page);
              // Page records are stamped with the site origin, and so is the chunk map.
              // Most pages carry no origin of their own, so the page identity used for
              // token counts cannot double as the chunk key. The key is also scoped by
              // locale: chunks are planned per locale group, so two pages sharing a
              // pathname across locales must not be credited with each other's chunks.
              const chunkIdentity = `${corpusPageIdentity({ origin, id: page.id })}\0${locale.locale ?? ''}`;
              const published = companion ? renderMarkdownDocument(page, input.config) : null;
              pageRecords.push({
                origin,
                id: page.id,
                canonicalUrl: page.canonicalUrl ?? page.url,
                markdownUrl: companion
                  ? (page.markdownUrl ?? new URL(page.mdHref, origin).href)
                  : null,
                locale: locale.locale,
                language: locale.language,
                section: section.title,
                tokenCount: companion
                  ? (planned.result.pageTokenCounts.get(`${identity}\0${locale.locale ?? ''}`) ?? 0)
                  : null,
                sourceStrategy: page.source?.strategy ?? 'rendered',
                ...(page.lastModified ? { modified: page.lastModified } : {}),
                ...(page.version ? { version: page.version } : {}),
                ...(page.versionGroup ? { versionGroup: page.versionGroup } : {}),
                ...(page.alternates?.some((/** @type {any} */ alternate) => alternate.kind === 'version')
                  ? { versionAlternates: page.alternates.filter((/** @type {any} */ alternate) => alternate.kind === 'version') } : {}),
                chunks: chunksByPage.get(chunkIdentity) ?? [],
                markdown: published,
              });
            }
          }
        }
        manifest = await createCorpusManifest({
          origin,
          base: input.base || '/',
          tokenizer: planned.tokenizer,
          ...(tokenizerFallback ? { tokenizerFallback: { reason: tokenizerFallback } } : {}),
          locales: localeRecords,
          pages: pageRecords,
          artifacts: planned.result.artifacts.map((artifact) => ({
            origin,
            pathname: withBase(artifact.pathname, input.base),
            kind: artifact.kind,
            locale: artifact.locale,
            section: artifact.section,
            part: artifact.part,
            tokenCount: artifact.tokenCount,
            encoding: 'identity',
            sourcePathname: artifact.sourcePathname
              ? withBase(artifact.sourcePathname, input.base)
              : null,
            contents: artifact.contents,
          })),
        });
      }
    }
  }

  return {
    artifacts: planned.result.artifacts,
    ...(planned.result.ragRecords ? { ragRecords: planned.result.ragRecords } : {}),
    ...(manifest ? { manifest, manifestText: serializeCorpusManifest(manifest) } : {}),
    diagnostics,
    tokenizer: planned.tokenizer,
  };
}

/** @param {any[]} pages @param {import('./locale.js').LocaleSnapshot | undefined} i18n @param {import('../index.js').ResolvedAstroAeoConfig} config */
export function localeGroups(pages, i18n, config) {
  /** @type {Map<string, { locale: string|null; language: string|null; origin?: string; pages: any[] }>} */
  const groups = new Map();
  for (const page of pages) {
    if (!participatesInCorpus(page, config)) continue;
    const locale = page.locale ?? null;
    const key = locale ?? '\0legacy';
    /** @type {{ locale: string|null; language: string|null; origin?: string; pages: any[] }} */
    const group = groups.get(key) ?? {
      locale,
      language: page.language ?? null,
      ...(page.origin ? { origin: page.origin } : {}),
      pages: [],
    };
    group.pages.push(page);
    groups.set(key, group);
  }
  const configured = new Map((i18n?.locales ?? []).map((locale, index) => [locale.locale, index]));
  const ordered = [...groups.values()].sort((left, right) => {
    const leftOrder = configured.get(/** @type {string} */ (left.locale)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = configured.get(/** @type {string} */ (right.locale)) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || codeUnit(left.locale ?? '', right.locale ?? '');
  });
  const preserveLegacyOrder = ordered.length <= 1 && (i18n?.locales.length ?? 0) === 0;
  return ordered.map((group) => ({
    ...group,
    pages: preserveLegacyOrder ? [...group.pages] : [...group.pages].sort(comparePages),
  }));
}

/** @param {any} page @param {import('../index.js').ResolvedAstroAeoConfig} config */
function participatesInCorpus(page, config) {
  if (config.corpus.rag.enabled && isRagEligible(page)) return true;
  if (config.corpus.index.enabled && isLlmsEligible(page, config)) return true;
  return (config.corpus.full.enabled || config.corpus.small.enabled || config.corpus.chunks.enabled) &&
    selectFullTxtPages([page], config).length > 0;
}

/** @param {any[]} pages @param {import('../index.js').ResolvedAstroAeoConfig} config */
function manifestSections(pages, config) {
  return /** @type {{ title: string; pages: any[] }[]} */ (groupSections(
    pages.filter((page) => participatesInCorpus(page, config)),
    config.corpus.index.sections,
    config.corpus.index.defaultSection,
  ));
}

/** @param {any[]} pages @param {import('../index.js').ResolvedAstroAeoConfig} config */
function fullSections(pages, config) {
  return /** @type {{ title: string; pages: any[] }[]} */ (groupSections(
    selectFullTxtPages(pages, config),
    config.corpus.index.sections,
    config.corpus.index.defaultSection,
  ));
}

/** @param {{ title: string; pages: any[] }[]} sections */
function planSections(sections) {
  return sections.map((section) => ({
    title: section.title,
    pages: section.pages.map(planPage),
  }));
}

/** @param {any} page */
function planPage(page) {
  return {
    id: page.id,
    title: page.title,
    canonicalUrl: page.canonicalUrl ?? page.url,
    description: page.description,
    markdown: pageMarkdown(page),
  };
}

/** @param {any} left @param {any} right */
function comparePages(left, right) {
  return codeUnit(left.canonicalUrl ?? left.url, right.canonicalUrl ?? right.url) ||
    codeUnit(left.id, right.id);
}

/** @param {string} left @param {string} right */
function codeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** @param {{ locale: string|null; origin?: string }} locale @param {string} currentOrigin @param {string} base @param {string} pathname */
function localeOriginHref(locale, currentOrigin, base, pathname) {
  const deployed = withBase(pathname, base);
  return locale.origin && normalizeOrigin(locale.origin) !== currentOrigin
    ? new URL(deployed, locale.origin).href
    : deployed;
}

/** @param {string} pathname @param {string} base */
function withBase(pathname, base) {
  const prefix = base && base !== '/' ? base.replace(/\/$/, '') : '';
  return prefix ? `${prefix}${pathname}` : pathname;
}

/** @param {string|null} locale @param {CorpusTextArtifact[]} artifacts @param {string} mode @param {number} locales */
function selectCanonicalArtifact(locale, artifacts, mode, locales) {
  const direct = artifacts.filter((artifact) => artifact.kind !== 'alias' && artifact.locale === locale);
  const shared = mode === 'global' && locales > 1
    ? artifacts.filter((artifact) => artifact.kind !== 'alias' && artifact.locale === null)
    : [];
  return [...direct, ...shared].sort((left, right) =>
    kindOrder(left.kind) - kindOrder(right.kind) ||
    (left.part ?? 0) - (right.part ?? 0) ||
    codeUnit(left.pathname, right.pathname),
  )[0];
}

/**
 * Planner outcomes that are the configured budget working as intended, not a defect. A small
 * corpus is built from each page's leading blocks, so cutting the rest of a page is its contract.
 * Losing a page's first block, its wrapper, or the preamble still means content the corpus was
 * meant to carry is missing, so those stay warnings.
 */
const PLANNER_INFO_CODES = new Set(['small-corpus-truncated']);

/** @param {CorpusTextArtifact['kind']} kind */
function kindOrder(kind) {
  return ({ index: 0, full: 1, small: 2, chunk: 3, alias: 4, rag: 5 })[kind];
}

/** @param {Array<{ code: string; severity: 'info'|'warning'|'error'; message: string; pathname?: string; details?: unknown }>} target @param {any[]} source @param {string|null} [locale] @param {string} [section] */
function addPlannerDiagnostics(target, source, locale, section) {
  for (const item of source) {
    target.push({
      code: item.code,
      severity: PLANNER_INFO_CODES.has(item.code) ? 'info' : 'warning',
      message: item.message,
      ...(item.pageId ? { pathname: item.pageId } : {}),
      ...(locale !== undefined || section
        ? { details: { locale: locale ?? null, section: section ?? item.section ?? null } }
        : {}),
    });
  }
}

/** @param {string} code @param {'warning'|'error'} severity @param {string} message */
function finding(code, severity, message) {
  return { code, severity, message };
}

/** @param {any} page */
function pageId(page) {
  return page.id;
}

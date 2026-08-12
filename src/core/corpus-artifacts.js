// @ts-check
import { allocateSmallCorpus, planSectionChunks } from './corpus-plan.js';
import { chunkPathname, resolveSectionSlugs } from './corpus-blocks.js';
import { createCorpusManifest, serializeCorpusManifest } from './corpus-manifest.js';
import { normalizePublishedText, runCorpusPlanWithTokenizer } from './corpus-tokenizer.js';
import { normalizeOrigin } from './locale.js';
import {
  renderGroupedLlmsFullTxt,
  renderGroupedLlmsTxt,
  renderLanguageDirectory,
} from './render/corpus.js';
import {
  groupSections,
  isLlmsEligible,
  renderLlmsFullTxt,
  renderLlmsTxt,
  selectFullTxtPages,
} from './render/llms-txt.js';

/**
 * @typedef {object} CorpusTextArtifact
 * @property {string} pathname
 * @property {'index'|'full'|'small'|'chunk'|'alias'} kind
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
 *   pages: any[];
 *   config: import('../index.js').ResolvedAstroAeoConfig;
 *   siteMeta: { name: string; description: string };
 *   origin: string;
 *   base: string;
 *   i18n?: import('./locale.js').LocaleSnapshot;
 *   tokenizer?: unknown;
 *   tokenizerOptions?: unknown;
 *   note?: string;
 * }} input
 * @returns {Promise<{ artifacts: CorpusTextArtifact[]; manifest?: any; manifestText?: string; diagnostics: Array<{ code: string; severity: 'warning'|'error'; message: string; pathname?: string; details?: unknown }>; tokenizer?: { name: string; version: string; approximate: boolean } }>}
 */
export async function planCorpusArtifacts(input) {
  const origin = normalizeOrigin(input.origin) ?? '';
  const mode = input.config.i18n.indexes;
  const allParticipatingPages = input.pages.filter((page) => !page.corpusExcluded);
  const allLocales = localeGroups(allParticipatingPages, input.i18n, input.config);
  const participatingPages = allParticipatingPages.filter((page) =>
    !origin || !page.origin || normalizeOrigin(page.origin) === origin);
  const locales = localeGroups(participatingPages, input.i18n, input.config);
  /** @type {Array<{ code: string; severity: 'warning'|'error'; message: string; pathname?: string; details?: unknown }>} */
  const diagnostics = [];

  if ((mode === 'locale' || mode === 'both') && locales.some((locale) => locale.locale === null)) {
    diagnostics.push(finding(
      'corpus-locale-required',
      'error',
      `i18n.indexes "${mode}" requires a concrete locale for every corpus page.`,
    ));
    return { artifacts: [], manifest: undefined, diagnostics, tokenizer: undefined };
  }

  const planned = await runCorpusPlanWithTokenizer(
    input.tokenizer,
    input.tokenizerOptions,
    async ({ tokenizer, count }) => {
      /** @type {CorpusTextArtifact[]} */
      const artifacts = [];
      /**
       * @param {string} pathname
       * @param {CorpusTextArtifact['kind']} kind
       * @param {string|null} locale
       * @param {string|null} section
       * @param {number|null} part
       * @param {string} contents
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
        const normalized = normalizePublishedText(contents);
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

      const oneLocale = allLocales.length <= 1;
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
            renderLlmsTxt(pages, input.config, input.siteMeta, { note: input.note }),
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
            renderLlmsFullTxt(pages, input.config, input.siteMeta, { note: input.note }),
            null,
            selected.map(pageId),
          );
        }
      } else if (mode === 'global') {
        const grouped = locales.map((locale) => ({ language: locale.language ?? 'und', pages: locale.pages }));
        if (input.config.corpus.index.enabled) {
          await addText('/llms.txt', 'index', null, null, null,
            renderGroupedLlmsTxt(grouped, input.config, input.siteMeta));
        }
        if (input.config.corpus.full.enabled) {
          await addText(
            '/llms-full.txt',
            'full',
            null,
            null,
            null,
            renderGroupedLlmsFullTxt(grouped, input.config, input.siteMeta),
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
              renderLlmsTxt(locale.pages, input.config, input.siteMeta));
          }
          if (input.config.corpus.full.enabled) {
            const selected = selectFullTxtPages(locale.pages, input.config);
            await addText(
              `${prefix}/llms-full.txt`,
              'full',
              locale.locale,
              null,
              null,
              renderLlmsFullTxt(locale.pages, input.config, input.siteMeta),
              null,
              selected.map(pageId),
            );
          }
        }
      }

      if (((mode === 'auto' && !oneLocale) || mode === 'both') && input.config.corpus.index.enabled) {
        await addText('/llms.txt', 'index', null, null, null, renderLanguageDirectory(
          input.siteMeta,
          allLocales.map((locale) => ({
            language: locale.language ?? 'und',
            href: localeOriginHref(
              locale,
              origin,
              input.base,
              `/${encodeURIComponent(/** @type {string} */ (locale.locale))}/llms.txt`,
            ),
          })),
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
          renderGroupedLlmsFullTxt(grouped, input.config, input.siteMeta),
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
            const result = await planSectionChunks({
              pages: section.pages.map(planPage),
              maxTokens: input.config.corpus.chunks.maxTokensPerFile,
              count,
            });
            addPlannerDiagnostics(diagnostics, result.diagnostics, locale.locale, section.title);
            const rootChunks = legacyRoot || (mode === 'global' && oneLocale);
            for (const chunk of result.chunks) {
              await addText(
                chunkPathname({
                  locale: rootChunks ? null : locale.locale,
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
        pageTokenCounts.set(pageIdentity(page), await count(page.markdown));
      }
      return { artifacts, tokenizer, pageTokenCounts };
    },
  );

  if (planned.fallback) {
    diagnostics.push(finding(
      'corpus-tokenizer-fallback',
      'warning',
      'The configured tokenizer failed; the complete corpus plan was restarted with astro-aeo-approx@1.',
    ));
  }

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
        const canonical = selectCanonicalArtifact(
          locale.locale,
          planned.result.artifacts,
          mode,
          locales.length,
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
            const paths = chunksByPage.get(id) ?? [];
            paths.push(withBase(artifact.pathname, input.base));
            chunksByPage.set(id, paths);
          }
        }
        /** @type {any[]} */
        const pageRecords = [];
        for (const locale of locales) {
          for (const section of manifestSections(locale.pages, input.config)) {
            for (const page of section.pages) {
              pageRecords.push({
                origin,
                id: page.id,
                canonicalUrl: page.canonicalUrl ?? page.url,
                markdownUrl: page.markdownUrl ?? new URL(page.mdHref, origin).href,
                locale: locale.locale,
                language: locale.language,
                section: section.title,
                tokenCount: planned.result.pageTokenCounts.get(pageIdentity(page)) ?? 0,
                sourceStrategy: page.source?.strategy ?? 'rendered',
                ...(page.lastModified ? { modified: page.lastModified } : {}),
                chunks: chunksByPage.get(page.id) ?? [],
                markdown: page.markdown,
              });
            }
          }
        }
        manifest = await createCorpusManifest({
          origin,
          base: input.base || '/',
          tokenizer: planned.tokenizer,
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
    ...(manifest ? { manifest, manifestText: serializeCorpusManifest(manifest) } : {}),
    diagnostics,
    tokenizer: planned.tokenizer,
  };
}

/**
 * Match only paths that can be owned by enabled corpus topology. This is a
 * cheap preflight; the complete plan remains authoritative for derived locale
 * and chunk names.
 * @param {string} pathname
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 */
export function isPotentialCorpusArtifactPath(pathname, config) {
  const mode = config.i18n.indexes;
  if (pathname === '/llms.txt') return config.corpus.index.enabled && mode !== 'locale';
  if (pathname === '/llms-full.txt') return config.corpus.full.enabled && mode !== 'locale';
  if (pathname === '/llms-small.txt') return config.corpus.small.enabled && mode !== 'locale';
  if (pathname === '/llms/manifest.json') return config.corpus.manifest.enabled;
  if (config.corpus.chunks.enabled && /^\/llms\/[^/]+-\d{4,}\.txt$/u.test(pathname)) return true;
  if (
    (mode === 'locale' || mode === 'both' || mode === 'auto') &&
    /^\/[^/]+\/llms(?:-full|-small)?\.txt$/u.test(pathname)
  ) {
    if (pathname.endsWith('/llms.txt')) return config.corpus.index.enabled;
    if (pathname.endsWith('/llms-full.txt')) return config.corpus.full.enabled;
    return config.corpus.small.enabled;
  }
  if (
    config.corpus.chunks.enabled &&
    mode !== 'global' &&
    /^\/[^/]+\/llms\/[^/]+-\d{4,}\.txt$/u.test(pathname)
  ) return true;
  if (mode === 'both' && /^\/llms(?:-full|-small)?-[^/]+\.txt$/u.test(pathname)) {
    if (pathname.startsWith('/llms-full-')) return config.corpus.full.enabled;
    if (pathname.startsWith('/llms-small-')) return config.corpus.small.enabled;
    return config.corpus.index.enabled;
  }
  return false;
}

/** @param {any[]} pages @param {import('./locale.js').LocaleSnapshot | undefined} i18n @param {import('../index.js').ResolvedAstroAeoConfig} config */
function localeGroups(pages, i18n, config) {
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
    markdown: page.markdown,
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

/** @param {CorpusTextArtifact['kind']} kind */
function kindOrder(kind) {
  return ({ index: 0, full: 1, small: 2, chunk: 3, alias: 4 })[kind];
}

/** @param {Array<{ code: string; severity: 'warning'|'error'; message: string; pathname?: string; details?: unknown }>} target @param {any[]} source @param {string|null} [locale] @param {string} [section] */
function addPlannerDiagnostics(target, source, locale, section) {
  for (const item of source) {
    target.push({
      code: item.code,
      severity: 'warning',
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
function pageIdentity(page) {
  return `${page.origin ?? ''}\0${page.id}`;
}

/** @param {any} page */
function pageId(page) {
  return page.id;
}

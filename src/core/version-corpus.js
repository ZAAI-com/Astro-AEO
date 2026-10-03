// @ts-check
import { localeGroups, planCorpusArtifacts } from './corpus-artifacts.js';
import { corpusPathname, corpusVersions } from './corpus-topology.js';
import { normalizeVersionPages } from './version-pages.js';
import { normalizeCorpusManifest, serializeCorpusManifest } from './corpus-manifest.js';
import { runCorpusPlanWithTokenizer } from './corpus-tokenizer.js';

/** Partition the shared corpus plan, never the Markdown/extraction pipeline.
 * One tokenizer transaction covers every version, so fallback cannot mix
 * token identities in the aggregate manifest.
 * @param {Parameters<typeof planCorpusArtifacts>[0]} input
 * @returns {ReturnType<typeof planCorpusArtifacts>}
 */
export async function planVersionCorpus(input) {
  const versions = /** @type {NonNullable<typeof input.config.corpus.versions>} */ (input.config.corpus.versions);
  const normalized = normalizeVersionPages(input.pages, versions, { base: input.base, i18n: input.i18n });
  if (normalized.diagnostics.length) return { artifacts: [], diagnostics: normalized.diagnostics };
  const labels = corpusVersions(normalized.pages, versions);
  /** @type {Map<string, any[]>} */
  const byVersion = new Map();
  for (const page of normalized.pages) {
    const group = byVersion.get(page.version) ?? [];
    group.push(page); byVersion.set(page.version, group);
  }
  const topologyLocaleCount = localeGroups(normalized.pages.filter((page) => !page.corpusExcluded), input.i18n, input.config).length;
  const planned = await runCorpusPlanWithTokenizer(input.tokenizer, input.tokenizerOptions, async (tokenContext) => {
    /** @type {import('./corpus-artifacts.js').CorpusTextArtifact[]} */
    const artifacts = [];
    /** @type {Array<{ pathname: string; manifest: any; contents: string }>} */
    const manifests = [];
    /** @type {Awaited<ReturnType<typeof planCorpusArtifacts>>['diagnostics']} */
    const diagnostics = [];
    /** @type {import('../index.js').RagRecordV1[]} */
    const ragRecords = [];
    for (const version of labels) {
      const pages = byVersion.get(version) ?? [];
      if (pages.length === 0 && version !== versions.current) continue;
      const part = await planCorpusArtifacts({ ...input, pages, topologyLocaleCount, tokenContext, deferRagHooks: true,
        artifactVersion: { version, current: versions.current },
        config: { ...input.config, corpus: { ...input.config.corpus, versions: undefined,
          manifest: { enabled: input.config.corpus.manifest.enabled && pages.some((page) => !page.corpusExcluded) } } },
      });
      ragRecords.push(...part.ragRecords ?? []);
      diagnostics.push(...part.diagnostics.filter((diagnostic) => diagnostic.code !== 'corpus-tokenizer-fallback'));
      const map = (/** @type {string} */ pathname, /** @type {string|null|undefined} */ locale) =>
        corpusPathname(pathname, { locale, version, current: versions.current });
      const deployed = (/** @type {string} */ pathname, /** @type {string|null|undefined} */ locale) => {
        const base = input.base && input.base !== '/' ? input.base.replace(/\/$/, '') : '';
        return `${base}${map(base && pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname, locale)}`;
      };
      artifacts.push(...part.artifacts.map((artifact) => ({ ...artifact, version,
        pathname: map(artifact.pathname, artifact.locale),
        sourcePathname: artifact.sourcePathname ? map(artifact.sourcePathname, artifact.locale) : null,
      })));
      if (part.manifest) {
        const manifest = normalizeCorpusManifest({ ...part.manifest,
          locales: part.manifest.locales.map((/** @type {any} */ locale) => ({ ...locale, version,
            canonicalArtifact: deployed(locale.canonicalArtifact, locale.locale) })),
          pages: part.manifest.pages.map((/** @type {any} */ page) => ({ ...page,
            chunks: page.chunks.map((/** @type {string} */ pathname) => deployed(pathname, page.locale)) })),
          artifacts: part.manifest.artifacts.map((/** @type {any} */ artifact) => ({ ...artifact, version,
            pathname: deployed(artifact.pathname, artifact.locale),
            sourcePathname: artifact.sourcePathname ? deployed(artifact.sourcePathname, artifact.locale) : null })),
        });
        manifests.push({ pathname: map('/llms/manifest.json', null), manifest, contents: '' });
      }
    }
    return { artifacts, manifests, diagnostics, ragRecords };
  }, { skipProbe: input.tokenizerProbed === true, cachedCount: input.cachedCount });
  const fallback = planned.fallback?.reason ?? input.tokenizerFallback ??
    (input.config.corpus.tokenizer && input.tokenizer === undefined ? 'preflight' : undefined);
  if (fallback) planned.result.diagnostics.push({ code: 'corpus-tokenizer-fallback', severity: 'warning',
    message: 'The configured tokenizer failed; every version was planned with astro-aeo-approx@1.' });
  if (fallback) for (const record of planned.result.ragRecords) record.tokenizerFallback = { reason: fallback };
  const parts = planned.result.manifests;
  for (const part of parts) {
    part.manifest = { ...part.manifest, ...(fallback ? { tokenizerFallback: { reason: fallback } } : {}) };
    part.contents = serializeCorpusManifest(part.manifest);
  }
  const manifest = parts.length ? normalizeCorpusManifest({ ...parts[0].manifest,
    versions: { current: versions.current, order: labels },
    locales: parts.flatMap((part) => part.manifest.locales),
    pages: parts.flatMap((part) => part.manifest.pages),
    artifacts: parts.flatMap((part) => part.manifest.artifacts),
  }) : undefined;
  if (!manifest && input.config.corpus.manifest.enabled &&
      !(input.deferEmptyManifest && !normalized.pages.some((page) => !page.corpusExcluded)) &&
      planned.result.diagnostics.length === 0) {
    planned.result.diagnostics.push({ code: 'corpus-manifest-canonical-missing', severity: 'error',
      message: 'No canonical corpus artifact exists for the versioned inventory.' });
  }
  return { artifacts: planned.result.artifacts, ...(input.config.corpus.rag.enabled ? { ragRecords: planned.result.ragRecords } : {}), diagnostics: planned.result.diagnostics, tokenizer: planned.tokenizer,
    ...(manifest ? { manifest, manifestText: serializeCorpusManifest(manifest) } : {}),
    manifests: parts.filter((part) => part.pathname !== '/llms/manifest.json'),
  };
}

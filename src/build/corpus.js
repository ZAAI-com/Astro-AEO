// @ts-check
import { gzipSync } from 'node:zlib';
import { planCorpusArtifacts } from '../core/corpus-artifacts.js';
import {
  normalizeCorpusManifest,
  serializeCorpusManifest,
  sha256Digest,
} from '../core/corpus-manifest.js';
import { normalizeOrigin } from '../core/locale.js';

/**
 * Materialize the runtime-safe logical corpus plan through the shared artifact
 * transaction. Static builds alone add deterministic gzip siblings.
 *
 * @param {any[]} inputPages
 * @param {import('../index.js').ResolvedAstroAeoConfig} config
 * @param {{ siteUrl: string; base: string; siteMeta: { name: string; description: string }; writer: any; runtime?: boolean; tokenizer?: unknown; i18n?: import('../core/locale.js').LocaleSnapshot; diagnostics: import('../index.js').Diagnostic[] }} env
 */
export async function stageCorpusArtifacts(inputPages, config, env) {
  const origin = normalizeOrigin(env.siteUrl) ?? '';
  const pages = inputPages.filter((page) =>
    !page.corpusExcluded &&
    (!origin || !page.origin || normalizeOrigin(page.origin) === origin),
  );
  const plan = await planCorpusArtifacts({
    pages,
    config,
    siteMeta: env.siteMeta,
    origin,
    base: env.base,
    i18n: env.i18n,
    tokenizer: env.tokenizer,
    tokenizerOptions: config.corpus.tokenizer?.options,
  });
  env.diagnostics.push(...plan.diagnostics.map((diagnostic) => /** @type {import('../index.js').Diagnostic} */ ({
    version: /** @type {const} */ (1),
    ...diagnostic,
  })));

  /** @type {Array<Omit<import('../core/corpus-artifacts.js').CorpusTextArtifact, 'contents'> & { contents: string | Uint8Array; encoding: 'identity'|'gzip' }>} */
  const artifacts = plan.artifacts.map((artifact) => ({ ...artifact, encoding: 'identity' }));
  if (config.corpus.compression.gzip && !env.runtime) {
    for (const source of plan.artifacts) {
      artifacts.push({
        ...source,
        pathname: `${source.pathname}.gz`,
        contents: deterministicGzip(source.contents),
        sourcePathname: source.pathname,
        encoding: 'gzip',
      });
    }
  }

  for (const artifact of artifacts) {
    env.writer.write({
      route: artifact.pathname,
      owner: { kind: 'core', name: corpusOwner(artifact) },
      contents: artifact.contents,
      ...(artifact.encoding === 'gzip' ? { contentType: 'application/gzip' } : {}),
      ...(env.runtime ? { runtime: true } : {}),
    });
  }

  let manifest = plan.manifest;
  if (manifest && config.corpus.compression.gzip && !env.runtime) {
    const gzipRecords = await Promise.all(artifacts
      .filter((artifact) => artifact.encoding === 'gzip')
      .map(async (artifact) => ({
        origin,
        pathname: withBase(artifact.pathname, env.base),
        kind: artifact.kind,
        locale: artifact.locale,
        section: artifact.section,
        part: artifact.part,
        tokenCount: artifact.tokenCount,
        hash: await sha256Digest(artifact.contents),
        encoding: /** @type {const} */ ('gzip'),
        sourcePathname: withBase(/** @type {string} */ (artifact.sourcePathname), env.base),
      })));
    manifest = normalizeCorpusManifest({
      ...manifest,
      artifacts: [...manifest.artifacts, ...gzipRecords],
    });
  }
  if (manifest) {
    env.writer.write({
      route: '/llms/manifest.json',
      owner: { kind: 'core', name: 'corpusManifest' },
      contents: serializeCorpusManifest(manifest),
      contentType: 'application/json; charset=utf-8',
      ...(env.runtime ? { runtime: true } : {}),
    });
  }
  return { artifacts, manifest, tokenizer: plan.tokenizer };
}

/** @param {{ kind: string; encoding: 'identity'|'gzip' }} artifact */
function corpusOwner(artifact) {
  if (artifact.encoding === 'gzip') return 'corpusGzip';
  return ({
    index: 'llmsTxt',
    full: 'llmsFullTxt',
    small: 'llmsSmallTxt',
    chunk: 'corpusChunk',
    alias: 'corpusAlias',
  })[artifact.kind] ?? 'corpusArtifact';
}

/** @param {string} value */
function deterministicGzip(value) {
  const bytes = gzipSync(Buffer.from(value, 'utf8'), /** @type {any} */ ({ level: 9, mtime: 0 }));
  bytes.fill(0, 4, 8);
  bytes[9] = 255;
  return new Uint8Array(bytes);
}

/** @param {string} pathname @param {string} base */
function withBase(pathname, base) {
  const prefix = base && base !== '/' ? base.replace(/\/$/, '') : '';
  return prefix ? `${prefix}${pathname}` : pathname;
}

// @ts-check
import { BUILTIN_CORPUS_TOKENIZER, countCorpusTokens, validateCorpusTokenizerModule, corpusTokenizerOptions } from './corpus-tokenizer.js';
import { serializeRagRecords } from './rag.js';
import { normalizeCorpusManifest, serializeCorpusManifest, sha256Digest } from './corpus-manifest.js';

/** @typedef {(record: import('../index.js').RagRecordV1) => Promise<{value: import('../index.js').RagRecordV1; diagnostics: import('../index.js').Diagnostic[]; isolated: boolean; dropped?: boolean}>} RagHook */

/** Hooks run after the complete raw tokenizer transaction succeeds, including
 * all versions. Partial raw plans never invoke record extensions.
 * @param {Awaited<ReturnType<typeof import('./corpus-artifacts.js').planCorpusArtifacts>>} plan
 * @param {Parameters<typeof import('./corpus-artifacts.js').planCorpusArtifacts>[0]} input
 */
export async function finishRagPlan(plan, input) {
  if (!plan.ragRecords) return plan;
  let custom;
  try { custom = input.tokenizer == null ? undefined : validateCorpusTokenizerModule(input.tokenizer, 'configured module'); } catch { custom = undefined; }
  const tokenizer = custom && custom.name === plan.tokenizer?.name && custom.version === plan.tokenizer?.version && custom.approximate === plan.tokenizer?.approximate
    ? custom : BUILTIN_CORPUS_TOKENIZER;
  const options = tokenizer === BUILTIN_CORPUS_TOKENIZER ? undefined : corpusTokenizerOptions(input.tokenizerOptions);
  const count = (/** @type {string} */ text) => input.cachedCount
    ? input.cachedCount(tokenizer, text, options, () => countCorpusTokens(tokenizer, text, options))
    : countCorpusTokens(tokenizer, text, options);
  const records = [];
  let isolated = false;
  for (const record of plan.ragRecords) {
    const result = input.ragHook ? await input.ragHook(record) : { value: record, diagnostics: [], isolated: false, dropped: false };
    plan.diagnostics.push(...result.diagnostics);
    if (result.isolated) isolated = true;
    else if (!result.dropped) records.push(result.value);
  }
  // An invalid replacement or explicit isolation is not an authorized drop.
  // Withhold the entire affected export instead of publishing a partial answer.
  if (isolated) {
    plan.ragRecords = [];
    plan.artifacts = plan.artifacts.filter((artifact) => artifact.kind !== 'rag');
  } else {
    plan.ragRecords = records;
    for (const artifact of plan.artifacts.filter((artifact) => artifact.kind === 'rag')) {
      const contents = serializeRagRecords(records.filter((record) =>
        (artifact.version === undefined || record.metadata.contentVersion === artifact.version) &&
        (artifact.locale === null || record.metadata.locale === artifact.locale)));
      if (contents !== artifact.contents) artifact.tokenCount = await count(contents);
      artifact.contents = contents;
    }
  }
  // RAG hooks cannot alter measured text. Artifact JSONL hashes do change with
  // metadata/drop operations; recount complete serialized artifacts as well.
  const update = async (/** @type {any} */ manifest) => {
    const base = input.base && input.base !== '/' ? input.base.replace(/\/$/, '') : '';
    /** @type {any[]} */
    const artifacts = [];
    for (const entry of manifest.artifacts) {
      if (entry.kind !== 'rag') { artifacts.push(entry); continue; }
      const source = plan.artifacts.find((artifact) => `${base}${artifact.pathname}` === entry.pathname);
      if (source) artifacts.push({ ...entry, hash: await sha256Digest(source.contents), tokenCount: source.tokenCount });
    }
    if (manifest.locales.some((/** @type {any} */ locale) => !artifacts.some((entry) => entry.pathname === locale.canonicalArtifact))) return undefined;
    return normalizeCorpusManifest({ ...manifest, artifacts });
  };
  if (plan.manifest) {
    plan.manifest = await update(plan.manifest);
    plan.manifestText = plan.manifest ? serializeCorpusManifest(plan.manifest) : undefined;
  }
  for (const scoped of plan.manifests ?? []) {
    scoped.manifest = await update(scoped.manifest);
    scoped.contents = scoped.manifest ? serializeCorpusManifest(scoped.manifest) : '';
  }
  plan.manifests = plan.manifests?.filter((scoped) => scoped.manifest);
  return plan;
}

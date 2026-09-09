// @ts-check
import {
  BUILTIN_CORPUS_TOKENIZER,
  corpusTokenizerOptions,
  probeCorpusTokenizer,
  validateCorpusTokenizerModule,
} from '../core/corpus-tokenizer.js';

/**
 * @typedef {{ module: string; name: string; version: string; approximate: boolean; options?: import('../index.js').JsonValue; load: () => Promise<unknown> }} RuntimeCorpusTokenizerLoader
 */

/** @type {WeakMap<object, Promise<{ implementation: any; options?: import('../index.js').JsonValue }>>} */
const cache = new WeakMap();

/** @param {RuntimeCorpusTokenizerLoader | undefined} loader */
export function loadRuntimeCorpusTokenizer(loader) {
  if (!loader) return Promise.resolve({ implementation: BUILTIN_CORPUS_TOKENIZER });
  let pending = cache.get(loader);
  if (!pending) {
    pending = load(loader);
    cache.set(loader, pending);
  }
  return pending;
}

/** @param {RuntimeCorpusTokenizerLoader} loader */
async function load(loader) {
  try {
    const implementation = validateCorpusTokenizerModule(await loader.load(), loader.module);
    if (
      implementation.name !== loader.name ||
      implementation.version !== loader.version ||
      implementation.approximate !== loader.approximate
    ) throw new TypeError('Corpus tokenizer identity changed after preflight.');
    const options = corpusTokenizerOptions(loader.options);
    await probeCorpusTokenizer(implementation, options);
    return { implementation, ...(options === undefined ? {} : { options }) };
  } catch {
    console.warn(`astro-aeo: corpus tokenizer "${loader.module}" failed at runtime; astro-aeo-approx@1 was used.`);
    return { implementation: BUILTIN_CORPUS_TOKENIZER };
  }
}

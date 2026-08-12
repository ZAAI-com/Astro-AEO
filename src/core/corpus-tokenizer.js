// @ts-check
import { immutableJsonValue } from './json-value.js';

/** The identity recorded for the built-in deterministic approximation. */
export const BUILTIN_TOKENIZER_IDENTITY = Object.freeze({
  name: 'astro-aeo-approx',
  version: '1',
  approximate: true,
});

/**
 * Frozen probes exercise empty input, decomposed Latin marks, non-Latin text,
 * punctuation, symbols, and fenced Markdown. They are deliberately part of
 * the contract rather than an implementation detail so build and runtime
 * preflight the same module in the same way.
 */
export const CORPUS_TOKENIZER_PROBES = Object.freeze([
  '',
  'Astro AEO_123',
  'Cafe\u0301 déjà vu. 東京 مرحبًا، 🌍',
  '## Heading\n\n```js\nconst answer = 42;\n```',
]);

const LATIN_RUN_CODE_POINT = /[\p{Script=Latin}\p{Mark}0-9_]/u;
const COUNTED_NON_LATIN_CODE_POINT = /[\p{Letter}\p{Number}\p{Punctuation}\p{Symbol}]/u;

/** A failure attributable specifically to a tokenizer load, probe, or count. */
export class CorpusTokenizerError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'CorpusTokenizerError';
  }
}

/**
 * Published text uses LF regardless of the source platform.
 * @param {string} text
 */
export function normalizePublishedText(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Count tokens with the built-in `astro-aeo-approx@1` algorithm.
 * @param {string} text
 */
export function countApproximateTokens(text) {
  let total = 0;
  let latinRun = 0;

  const finishLatinRun = () => {
    if (latinRun > 0) total += Math.ceil(latinRun / 4);
    latinRun = 0;
  };

  for (const codePoint of normalizePublishedText(text)) {
    if (LATIN_RUN_CODE_POINT.test(codePoint)) {
      latinRun++;
      continue;
    }
    finishLatinRun();
    if (COUNTED_NON_LATIN_CODE_POINT.test(codePoint)) total++;
  }
  finishLatinRun();
  return total;
}

/** @type {Readonly<{ apiVersion: 1; name: string; version: string; approximate: boolean; count: (text: string) => number }>} */
export const BUILTIN_CORPUS_TOKENIZER = Object.freeze({
  apiVersion: 1,
  ...BUILTIN_TOKENIZER_IDENTITY,
  count: countApproximateTokens,
});

/**
 * Validate a tokenizer module without retaining its module namespace.
 * @param {unknown} value
 * @param {string} source
 * @returns {{ apiVersion: 1; name: string; version: string; approximate: boolean; count: (text: string, options?: import('../index.js').JsonValue) => number | Promise<number> }}
 */
export function validateCorpusTokenizerModule(value, source) {
  if (!isPlainObject(value)) {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must default-export an object.`);
  }
  const module = /** @type {Record<string, unknown>} */ (value);
  if (module.apiVersion !== 1) {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must declare apiVersion: 1.`);
  }
  if (typeof module.name !== 'string' || module.name.trim() === '') {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must have a non-empty name.`);
  }
  if (typeof module.version !== 'string' || module.version.trim() === '') {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must have a non-empty version.`);
  }
  if (typeof module.approximate !== 'boolean') {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must declare approximate as a boolean.`);
  }
  if (typeof module.count !== 'function') {
    throw new CorpusTokenizerError(`Corpus tokenizer "${source}" must provide count().`);
  }
  return Object.freeze({
    apiVersion: /** @type {1} */ (1),
    name: module.name.trim(),
    version: module.version.trim(),
    approximate: module.approximate,
    count: /** @type {(text: string, options?: import('../index.js').JsonValue) => number | Promise<number>} */ (module.count),
  });
}

/**
 * Clone tokenizer options once and freeze them before extension code receives
 * them. Undefined remains undefined rather than becoming JSON null.
 * @param {unknown} options
 */
export function corpusTokenizerOptions(options) {
  return options === undefined
    ? undefined
    : immutableJsonValue(options, 'corpus tokenizer options');
}

/**
 * Count normalized text and enforce the public result contract.
 * @param {{ name: string; count: (text: string, options?: import('../index.js').JsonValue) => number | Promise<number> }} tokenizer
 * @param {string} text
 * @param {import('../index.js').JsonValue | undefined} [options]
 */
export async function countCorpusTokens(tokenizer, text, options) {
  let count;
  try {
    count = await tokenizer.count(normalizePublishedText(text), options);
  } catch (cause) {
    throw new CorpusTokenizerError(`Corpus tokenizer "${tokenizer.name}" failed while counting text.`, { cause });
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new CorpusTokenizerError(
      `Corpus tokenizer "${tokenizer.name}" returned a count that is not a non-negative safe integer.`,
    );
  }
  return count;
}

/**
 * Run the frozen probe set twice and require exact repeatability.
 * @param {{ name: string; count: (text: string, options?: import('../index.js').JsonValue) => number | Promise<number> }} tokenizer
 * @param {import('../index.js').JsonValue | undefined} [options]
 */
export async function probeCorpusTokenizer(tokenizer, options) {
  const first = [];
  /** @type {number[]} */
  const second = [];
  for (const text of CORPUS_TOKENIZER_PROBES) {
    first.push(await countCorpusTokens(tokenizer, text, options));
  }
  for (const text of CORPUS_TOKENIZER_PROBES) {
    second.push(await countCorpusTokens(tokenizer, text, options));
  }
  if (first.some((count, index) => count !== second[index])) {
    throw new CorpusTokenizerError(`Corpus tokenizer "${tokenizer.name}" is not deterministic on the contract probes.`);
  }
  return Object.freeze(first);
}

/**
 * Run a complete asynchronous corpus plan with a validated tokenizer. A custom
 * probe or count failure discards the result and repeats the entire callback
 * with the built-in tokenizer. Non-tokenizer exceptions remain visible.
 *
 * @template T
 * @param {unknown} customModule validated module value, raw module value, or undefined
 * @param {unknown} rawOptions
 * @param {(context: { tokenizer: { name: string; version: string; approximate: boolean }; count: (text: string) => Promise<number> }) => Promise<T>} plan
 * @returns {Promise<{ result: T; tokenizer: { name: string; version: string; approximate: boolean }; fallback?: { name?: string; message: string } }>}
 */
export async function runCorpusPlanWithTokenizer(customModule, rawOptions, plan) {
  const options = corpusTokenizerOptions(rawOptions);
  let custom;
  if (customModule !== undefined) {
    try {
      custom = validateCorpusTokenizerModule(customModule, 'configured module');
      await probeCorpusTokenizer(custom, options);
    } catch (error) {
      if (!(error instanceof CorpusTokenizerError)) throw error;
      const result = await executePlan(BUILTIN_CORPUS_TOKENIZER, undefined, plan);
      return {
        result,
        tokenizer: BUILTIN_TOKENIZER_IDENTITY,
        fallback: { ...(custom ? { name: custom.name } : {}), message: error.message },
      };
    }
  }

  const tokenizer = custom ?? BUILTIN_CORPUS_TOKENIZER;
  try {
    const result = await executePlan(tokenizer, custom ? options : undefined, plan);
    return {
      result,
      tokenizer: tokenizerIdentity(tokenizer),
    };
  } catch (error) {
    if (!custom || !(error instanceof CorpusTokenizerError)) throw error;
    const result = await executePlan(BUILTIN_CORPUS_TOKENIZER, undefined, plan);
    return {
      result,
      tokenizer: BUILTIN_TOKENIZER_IDENTITY,
      fallback: { name: custom.name, message: error.message },
    };
  }
}

/**
 * @template T
 * @param {{ name: string; version: string; approximate: boolean; count: (text: string, options?: import('../index.js').JsonValue) => number | Promise<number> }} tokenizer
 * @param {import('../index.js').JsonValue | undefined} options
 * @param {(context: { tokenizer: { name: string; version: string; approximate: boolean }; count: (text: string) => Promise<number> }) => Promise<T>} plan
 */
async function executePlan(tokenizer, options, plan) {
  return plan({
    tokenizer: tokenizerIdentity(tokenizer),
    count: (text) => countCorpusTokens(tokenizer, text, options),
  });
}

/** @param {{ name: string; version: string; approximate: boolean }} tokenizer */
function tokenizerIdentity(tokenizer) {
  return Object.freeze({
    name: tokenizer.name,
    version: tokenizer.version,
    approximate: tokenizer.approximate,
  });
}

/** @param {unknown} value */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

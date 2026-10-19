// @ts-check

/** @typedef {{ key: (stage: string, inputs: unknown) => string; get: (key: string) => unknown; put: (key: string, value: unknown, dependencies?: string[]) => void; capture?: () => () => string[] }} StageCache */

/** Functions cannot be represented by a trustworthy persistent identity.
 * @param {unknown} value @param {Set<object>} [seen]
 * @returns {boolean}
 */
export function hasFunction(value, seen = new Set()) {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => hasFunction(item, seen));
}

/** Reuse a single stage without suppressing other pipeline stages.
 * @template T
 * @param {StageCache | undefined} cache
 * @param {string} stage
 * @param {unknown} inputs
 * @param {() => T | Promise<T>} produce
 * @param {(value: unknown) => boolean} validate
 * @param {(outcome: 'hit'|'miss'|'bypass') => void} [observe]
 * @returns {Promise<T>}
 */
export async function cachedStage(cache, stage, inputs, produce, validate, observe) {
  const key = cache && !hasFunction(inputs) ? cache.key(stage, inputs) : undefined;
  const cached = key ? cache?.get(key) : undefined;
  if (cached !== undefined && validate(cached)) {
    observe?.('hit');
    return /** @type {T} */ (cached);
  }
  observe?.(key ? 'miss' : 'bypass');
  const finish = key ? cache?.capture?.() : undefined;
  let result;
  /** @type {string[] | undefined} */
  let dependencies;
  try { result = await produce(); }
  finally { dependencies = finish?.(); }
  if (key && validate(result)) cache?.put(key, result, dependencies);
  return result;
}

/** Cache a declared pure/versioned plugin stage, never transient failures.
 * @template T
 * @param {ReturnType<typeof import('../plugins/dispatcher.js').createPluginDispatcher> extends Promise<infer D> ? D : never} dispatcher
 * @param {StageCache} cache
 * @param {import('../index.js').AstroAeoPluginStage} stage
 * @param {T} initial
 * @param {{ pathname?: string; mode?: 'build'|'runtime'; validate?: (value: unknown) => boolean }} context
 * @param {unknown} [dependencies]
 * @param {(outcome: 'hit'|'miss'|'bypass') => void} [observe]
 */
export async function runCachedPluginStage(dispatcher, cache, stage, initial, context, dependencies, observe) {
  const identity = dispatcher.cacheIdentity(stage);
  if (identity?.length === 0) return dispatcher.run(stage, initial, context);
  const validate = (/** @type {any} */ result) => Boolean(result && !result.isolated &&
    !result.dropped && Array.isArray(result.diagnostics) && result.diagnostics.length === 0 &&
    (!context.validate || context.validate(result.value)));
  return cachedStage(identity === null ? undefined : cache, `${stage}-v1`,
    { initial, pathname: context.pathname, mode: context.mode, identity, dependencies },
    () => dispatcher.run(stage, initial, context), validate, observe);
}

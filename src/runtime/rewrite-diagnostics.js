// @ts-check
/**
 * Development diagnostics for internal rewrites that fail.
 *
 * Astro's `findRouteToRewrite` commits to the first route whose pattern matches
 * the requested path, and its only rejection branch reads `route.distURL`,
 * which is populated only while a build writes files. In `astro dev` a dynamic
 * route that matches the pattern but owns no path therefore shadows the route
 * that does, and the rewrite throws. The corpus fetchers have always answered
 * `null` for that, which drops the page from an aggregate corpus and 404s its
 * `.md` companion with nothing written to the terminal.
 *
 * Nothing here changes what a request returns in production: failures stay
 * swallowed and fail closed. The sink only remembers what was already thrown
 * so development can name it.
 */

/** @typedef {{ pathname: string; error: unknown }} FetchFailure */
/** @typedef {{ record(pathname: string, error: unknown): void; readonly count: number; readonly first: FetchFailure | null }} FetchFailureSink */

// Registered symbols, not module state: Vite can re-execute a module during a
// development session, and one warning per dev process is the goal.
const CORPUS_WARNING_KEY = 'astro-aeo:development-corpus-rewrite-warning';
const COMPANION_WARNING_KEY = 'astro-aeo:development-companion-rewrite-warning';

/** @returns {FetchFailureSink} */
export function createFetchFailureSink() {
  /** @type {FetchFailure | null} */
  let first = null;
  let count = 0;
  return {
    record(pathname, error) {
      count += 1;
      if (first === null) first = { pathname, error };
    },
    get count() {
      return count;
    },
    get first() {
      return first;
    },
  };
}

/**
 * Astro throws an `AstroError` carrying a stable `title`. The message is matched
 * only as a fallback, so a reworded Astro release degrades to the generic
 * diagnostic instead of to silence.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNoMatchingStaticPathError(error) {
  if (!error || typeof error !== 'object') return false;
  const candidate = /** @type {{ title?: unknown; name?: unknown; message?: unknown }} */ (error);
  if (candidate.title === 'No static path found for requested path.') return true;
  if (candidate.name === 'NoMatchingStaticPathFound') return true;
  return typeof candidate.message === 'string' &&
    candidate.message.includes('no matching static path was found');
}

/** @param {unknown} error @returns {string} */
function errorSummary(error) {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'the rewrite failed without an error message.';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function rewriteFailureCause(error) {
  if (!isNoMatchingStaticPathError(error)) return errorSummary(error);
  return (
    "Astro's development server selected the wrong route for the internal rewrite. That happens " +
    'when two dynamic route patterns both match a path and the one Astro sorts first does not ' +
    'produce it. The build output is unaffected: run `astro build && astro preview` to inspect ' +
    'the complete corpus.'
  );
}

/**
 * @param {FetchFailureSink} sink
 * @returns {string}
 */
export function corpusRewriteWarning(sink) {
  const first = sink.first;
  const pathname = first ? first.pathname : 'an unknown path';
  const others = sink.count > 1 ? ` and ${sink.count - 1} other page(s)` : '';
  return `astro-aeo: ${pathname}${others} could not be rendered for the development corpus. ` +
    rewriteFailureCause(first?.error);
}

/**
 * @param {string} pathname
 * @param {FetchFailureSink} sink
 * @returns {string}
 */
export function companionRewriteWarning(pathname, sink) {
  return `astro-aeo: the Markdown companion for ${pathname} could not be rendered. ` +
    rewriteFailureCause(sink.first?.error);
}

/** @param {string} key @returns {boolean} true when this process has not warned yet */
function claimWarning(key) {
  const scope = /** @type {Record<symbol, boolean>} */ (/** @type {unknown} */ (globalThis));
  const symbol = Symbol.for(key);
  if (scope[symbol]) return false;
  scope[symbol] = true;
  return true;
}

/**
 * @param {FetchFailureSink | null} sink
 * @param {'dev'|'build'|'preview'} command
 */
export function warnDevCorpusRewriteFailure(sink, command) {
  if (command !== 'dev' || !sink || sink.count === 0) return;
  if (!claimWarning(CORPUS_WARNING_KEY)) return;
  console.warn(corpusRewriteWarning(sink));
}

/**
 * @param {string} pathname
 * @param {FetchFailureSink | null} sink
 * @param {'dev'|'build'|'preview'} command
 */
export function warnDevCompanionRewriteFailure(pathname, sink, command) {
  if (command !== 'dev' || !sink || sink.count === 0) return;
  if (!claimWarning(COMPANION_WARNING_KEY)) return;
  console.warn(companionRewriteWarning(pathname, sink));
}

/** Test seam: forget both per-process warning latches. */
export function resetRewriteWarningsForTest() {
  const scope = /** @type {Record<symbol, boolean>} */ (/** @type {unknown} */ (globalThis));
  delete scope[Symbol.for(CORPUS_WARNING_KEY)];
  delete scope[Symbol.for(COMPANION_WARNING_KEY)];
}

// @ts-check
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  companionRewriteWarning,
  corpusRewriteWarning,
  createFetchFailureSink,
  isForbiddenPrerenderedRewriteError,
  isNoMatchingStaticPathError,
  resetRewriteWarningsForTest,
  rewriteFailureCause,
  warnDevCompanionRewriteFailure,
  warnDevCorpusRewriteFailure,
} from './rewrite-diagnostics.js';

/** The shape Astro throws: an AstroError carrying a stable `title`. */
function noMatchingStaticPath(pathname = '/alpha/') {
  const error = new Error(
    'A `getStaticPaths()` route pattern was matched, but no matching static path ' +
      `was found for requested path \`${pathname}\`.`,
  );
  error.name = 'NoMatchingStaticPathFound';
  // @ts-expect-error AstroError carries a title; plain Errors do not.
  error.title = 'No static path found for requested path.';
  return error;
}

/** The shape Astro throws when an on-demand route rewrites to a prerendered one. */
function forbiddenRewrite(pathname = '/about/') {
  const error = new Error(
    `You tried to rewrite the on-demand route '/about.md' with the static route ` +
      `'${pathname}', when using the 'server' output. The component ` +
      "'src/pages/about.astro' is marked as prerendered.",
  );
  error.name = 'ForbiddenRewrite';
  // @ts-expect-error AstroError carries a title; plain Errors do not.
  error.title = 'Forbidden rewrite to a static route.';
  return error;
}

afterEach(() => {
  resetRewriteWarningsForTest();
  vi.restoreAllMocks();
});

describe('createFetchFailureSink', () => {
  test('counts every failure but keeps the first for the message', () => {
    const sink = createFetchFailureSink();
    expect(sink.count).toBe(0);
    expect(sink.first).toBeNull();
    const first = new Error('first');
    sink.record('/a/', first);
    sink.record('/b/', new Error('second'));
    expect(sink.count).toBe(2);
    expect(sink.first).toEqual({ pathname: '/a/', error: first });
  });

  test('forgives a rescued suffix without forgetting what came before it', () => {
    const sink = createFetchFailureSink();
    const first = new Error('first');
    sink.record('/a/', first);
    sink.forgive(1);
    expect(sink.count).toBe(1);
    expect(sink.first).toEqual({ pathname: '/a/', error: first });
    sink.record('/b/', new Error('second'));
    sink.forgive(1);
    expect(sink.count).toBe(1);
    expect(sink.first).toEqual({ pathname: '/a/', error: first });
    sink.forgive(0);
    expect(sink.count).toBe(0);
    expect(sink.first).toBeNull();
  });

  test('never invents failures from a larger count', () => {
    const sink = createFetchFailureSink();
    sink.forgive(5);
    expect(sink.count).toBe(0);
    sink.record('/a/', new Error('boom'));
    sink.forgive(5);
    expect(sink.count).toBe(1);
  });
});

describe('isNoMatchingStaticPathError', () => {
  test('recognizes the error by title, by name, and by message', () => {
    expect(isNoMatchingStaticPathError(noMatchingStaticPath())).toBe(true);
    expect(isNoMatchingStaticPathError({ name: 'NoMatchingStaticPathFound' })).toBe(true);
    expect(
      isNoMatchingStaticPathError({ message: 'no matching static path was found for /x/' }),
    ).toBe(true);
  });

  test('does not claim unrelated failures', () => {
    expect(isNoMatchingStaticPathError(new Error('boom'))).toBe(false);
    expect(isNoMatchingStaticPathError(null)).toBe(false);
    expect(isNoMatchingStaticPathError('no matching static path was found')).toBe(false);
  });
});

describe('isForbiddenPrerenderedRewriteError', () => {
  // Read out of the installed Astro so a reworded release fails here instead of
  // silently turning the development companion fallback into a 404.
  test('recognizes the error Astro throws for a rewrite to a prerendered route', async () => {
    const { readFileSync } = await import('node:fs');
    const errorsData = readFileSync(
      new URL('../../node_modules/astro/dist/core/errors/errors-data.js', import.meta.url),
      'utf8',
    );
    expect(errorsData).toContain('name: "ForbiddenRewrite"');
    expect(errorsData).toContain('title: "Forbidden rewrite to a static route."');
    // The module, not the `astro/errors` entrypoint: Astro 5 exports only
    // `AstroError` from there, and this pin has to hold on every supported major.
    const { ForbiddenRewrite } = await import(
      '../../node_modules/astro/dist/core/errors/errors-data.js'
    );

    const error = new Error(
      "You tried to rewrite the on-demand route '/about.md' with the static route " +
        "'/about/', when using the 'server' output. The component 'src/pages/about.astro' " +
        'is marked as prerendered.',
    );
    error.name = 'ForbiddenRewrite';
    // @ts-expect-error AstroError carries a title; plain Errors do not.
    error.title = 'Forbidden rewrite to a static route.';
    expect(isForbiddenPrerenderedRewriteError(error)).toBe(true);
    expect(isForbiddenPrerenderedRewriteError({ name: 'ForbiddenRewrite' })).toBe(true);
    expect(
      isForbiddenPrerenderedRewriteError({ title: 'Forbidden rewrite to a static route.' }),
    ).toBe(true);
    // The message fallback needs the whole sentence, so it cannot be satisfied by
    // the prerendered phrase alone. Pin the two other parts against the installed
    // Astro, because a release that rewords them turns this branch off.
    const message = ForbiddenRewrite.message('/a.md', '/a/', 'src/pages/a.astro');
    expect(message).toContain('tried to rewrite the on-demand route');
    expect(message).toContain('with the static route');
    expect(isForbiddenPrerenderedRewriteError({ message })).toBe(true);
  });

  // A true answer here sends the request to the anonymous development loopback, so
  // an application error that happens to mention prerendering must not reach it.
  test('does not claim an application error that merely says prerendered', () => {
    expect(
      isForbiddenPrerenderedRewriteError(
        new Error("the cache entry for '/a.astro' is marked as prerendered"),
      ),
    ).toBe(false);
    expect(
      isForbiddenPrerenderedRewriteError({ message: 'is marked as prerendered' }),
    ).toBe(false);
  });

  // Astro only throws this error when the rewrite target is prerendered, and it
  // builds a prerendered render's request with blank headers and no query. So a
  // forbidden rewrite proves the in-process render would have been anonymous too,
  // which is what lets `htmlFetcher` answer a direct `.md` through the anonymous
  // development loopback without dropping anything Astro would have kept. Pinned
  // against the installed Astro: if a release changes either half, the loopback
  // branch stops being equivalent and this fails instead of leaking headers.
  test('is thrown only for a prerendered target, whose render Astro makes anonymous', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (/** @type {string} */ relative) =>
      readFileSync(new URL(`../../node_modules/astro/dist/core/${relative}`, import.meta.url), 'utf8');

    // The throw site: guarded by the target route's own `prerender` flag.
    expect(read('middleware/sequence.js')).toContain('routeData.prerender === true');

    // The request that target would have received: headers replaced wholesale.
    expect(read('routing/rewrite.js')).toContain('headers: isPrerendered ? {} : oldRequest.headers');

    // And the query string dropped, so the loopback's preserved query cannot make
    // the loopback render see more than the in-process render would have.
    const request = read('request.js');
    expect(request).toContain('const headersObj = isPrerendered ? void 0');
    expect(request).toContain('url.search = ""');
  });

  test('does not claim unrelated failures', () => {
    expect(isForbiddenPrerenderedRewriteError(noMatchingStaticPath())).toBe(false);
    expect(isForbiddenPrerenderedRewriteError(new Error('boom'))).toBe(false);
    expect(isForbiddenPrerenderedRewriteError(null)).toBe(false);
    expect(isForbiddenPrerenderedRewriteError('is marked as prerendered')).toBe(false);
  });
});

describe('rewriteFailureCause', () => {
  test('explains the overlapping-route cause and points at the build', () => {
    const cause = rewriteFailureCause(noMatchingStaticPath());
    expect(cause).toContain('two dynamic route patterns both match');
    expect(cause).toContain('astro build && astro preview');
  });

  test('falls back to the underlying message for anything else', () => {
    expect(rewriteFailureCause(new Error('session provider exploded'))).toBe(
      'session provider exploded',
    );
  });
});

describe('warnDevCorpusRewriteFailure', () => {
  test('names the first path, counts the rest, and warns once per process', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = createFetchFailureSink();
    sink.record('/alpha/', noMatchingStaticPath());
    sink.record('/beta/', noMatchingStaticPath('/beta/'));

    warnDevCorpusRewriteFailure(sink, 'dev');
    warnDevCorpusRewriteFailure(sink, 'dev');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('/alpha/');
    expect(message).toContain('1 other page(s)');
    expect(message).toContain('astro build && astro preview');
  });

  test('stays silent outside development and when nothing failed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = createFetchFailureSink();
    sink.record('/alpha/', noMatchingStaticPath());

    warnDevCorpusRewriteFailure(sink, 'build');
    warnDevCorpusRewriteFailure(sink, 'preview');
    warnDevCorpusRewriteFailure(createFetchFailureSink(), 'dev');
    warnDevCorpusRewriteFailure(null, 'dev');

    expect(warn).not.toHaveBeenCalled();
  });

  test('the companion latch is independent of the corpus latch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = createFetchFailureSink();
    sink.record('/alpha/', noMatchingStaticPath());

    warnDevCorpusRewriteFailure(sink, 'dev');
    warnDevCompanionRewriteFailure('/alpha/', sink, 'dev');

    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('Markdown companion for /alpha/');
  });
});

describe('message builders', () => {
  test('omit the "other pages" clause for a single failure', () => {
    const sink = createFetchFailureSink();
    sink.record('/only/', noMatchingStaticPath('/only/'));
    expect(corpusRewriteWarning(sink)).toContain('/only/ could not be rendered');
    expect(corpusRewriteWarning(sink)).not.toContain('other page(s)');
  });

  // The middleware records a forbidden prerendered rewrite and forgives it only once
  // the development loopback has answered. A loopback that never answers leaves the
  // record standing, and that is the only thing between the developer and a silent 404.
  test('name the forbidden-rewrite cause when the loopback never rescued the page', () => {
    const sink = createFetchFailureSink();
    sink.record('/about/', forbiddenRewrite());
    expect(companionRewriteWarning('/about.md', sink)).toContain(
      'the Markdown companion for /about.md could not be rendered',
    );
    expect(companionRewriteWarning('/about.md', sink)).toContain('is marked as prerendered');
  });

  test('describe a failure with no error object without throwing', () => {
    const sink = createFetchFailureSink();
    sink.record('/odd/', undefined);
    expect(companionRewriteWarning('/odd/', sink)).toContain(
      'the rewrite failed without an error message.',
    );
  });
});

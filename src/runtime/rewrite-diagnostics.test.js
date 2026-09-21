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
    expect(
      isForbiddenPrerenderedRewriteError({ message: "'/a.astro', which is marked as prerendered" }),
    ).toBe(true);
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

// @ts-check
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  companionRewriteWarning,
  corpusRewriteWarning,
  createFetchFailureSink,
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

  test('describe a failure with no error object without throwing', () => {
    const sink = createFetchFailureSink();
    sink.record('/odd/', undefined);
    expect(companionRewriteWarning('/odd/', sink)).toContain(
      'the rewrite failed without an error message.',
    );
  });
});

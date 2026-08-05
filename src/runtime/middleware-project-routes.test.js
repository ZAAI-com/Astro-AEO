import { describe, expect, test, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const { resolveConfig } = await import('../config.js');
  return {
    RUNTIME: {
      command: 'preview',
      config: resolveConfig(),
      site: { siteUrl: 'https://example.test', base: '', trailingSlash: 'ignore' },
      staticPaths: [],
      projectPaths: ['/feed.md', '/legacy.md', '/llms.txt'],
      projectPatterns: [/^\/project\/[^/]+\.md$/, /^\/(?:llms|robots)\.txt$/],
      internalRequestToken: 'opaque-test-token',
      standaloneSources: {},
    },
    RUNTIME_CATALOGS: [],
  };
});

const { onRequest } = await import('./middleware.js');

describe('literal project route ownership', () => {
  test.each(['/feed.md', '/legacy.md', '/llms.txt', '/project/example.md', '/robots.txt'])(
    '%s reaches the application unchanged',
    async (pathname) => {
    const url = new URL(pathname, 'https://example.test');
    const expected = new Response('project route', { headers: { 'x-owner': 'project' } });
    const next = vi.fn(async () => expected);
    const rewrite = vi.fn();

    const response = await onRequest(
      { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite },
      next,
    );

    expect(response).toBe(expected);
    expect(next).toHaveBeenCalledOnce();
    expect(rewrite).not.toHaveBeenCalled();
    },
  );

  test.each(['/..%2fprivate/secret.md', '/foo%2f..%2fprivate/secret.md'])(
    'rejects ambiguous path %s before invoking the application',
    async (pathname) => {
      const url = new URL(pathname, 'https://example.test');
      const next = vi.fn();
      const rewrite = vi.fn();
      const response = await onRequest(
        { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite },
        next,
      );

      expect(response.status).toBe(400);
      expect(next).not.toHaveBeenCalled();
      expect(rewrite).not.toHaveBeenCalled();
    },
  );
});

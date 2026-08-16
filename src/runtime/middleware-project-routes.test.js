import { beforeEach, describe, expect, test, vi } from 'vitest';

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
      standaloneSources: {},
    },
    RUNTIME_CATALOG_LOADERS: [],
    RUNTIME_MARKDOWN_RENDERER_LOADERS: [],
    RUNTIME_PLUGIN_LOADERS: [],
  };
});

const { onRequest } = await import('./middleware.js');
const { RUNTIME } = await import('./config.js');
const { resolveConfig } = await import('../config.js');

beforeEach(() => {
  RUNTIME.config = resolveConfig();
  RUNTIME.site.base = '';
  RUNTIME.projectPaths = ['/feed.md', '/legacy.md', '/llms.txt'];
  RUNTIME.projectPatterns = [/^\/project\/[^/]+\.md$/, /^\/(?:llms|robots)\.txt$/];
});

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

  test('accepts an encoded literal percent in an ordinary project path', async () => {
    const url = new URL('/sale-100%25', 'https://example.test');
    const expected = new Response('sale page');
    const next = vi.fn(async () => expected);
    const response = await onRequest(
      { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite: vi.fn() },
      next,
    );

    expect(response).toBe(expected);
    expect(next).toHaveBeenCalledOnce();
  });

  test('matches requests beneath an encoded configured base', async () => {
    RUNTIME.site.base = '/docs%20space';
    RUNTIME.config = resolveConfig({ discovery: { robots: { enabled: true } } });
    RUNTIME.projectPaths = [];
    RUNTIME.projectPatterns = [];
    const url = new URL('/docs%20space/robots.txt', 'https://example.test');
    const next = vi.fn(async () => new Response('application fallback'));

    const response = await onRequest(
      { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite: vi.fn() },
      next,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('User-agent: *');
    expect(next).not.toHaveBeenCalled();
  });

  test('an exact replacement authorization overrides a literal project Markdown route', async () => {
    RUNTIME.config = resolveConfig({ artifacts: { replace: ['/docs/feed.md'] } });
    RUNTIME.site.base = '/docs';
    const url = new URL('/docs/feed.md', 'https://example.test');
    const context = {
      request: new Request(url),
      url,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(async () => new Response(
        '<html><head><title>Replacement</title></head><body><main><h1>Replacement</h1></main></body></html>',
        { headers: { 'content-type': 'text/html' } },
      )),
    };
    const next = vi.fn(async () => new Response('project literal'));
    const response = await onRequest(context, next);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Replacement');
    expect(next).not.toHaveBeenCalled();
    expect(context.rewrite).toHaveBeenCalled();
  });

  test('an encoded replacement authorization matches the decoded request pathname', async () => {
    RUNTIME.config = resolveConfig({ artifacts: { replace: ['/sale-100%25.md'] } });
    RUNTIME.projectPaths.push('/sale-100%.md');
    const url = new URL('/sale-100%25.md', 'https://example.test');
    const context = {
      request: new Request(url),
      url,
      locals: {},
      isPrerendered: false,
      rewrite: vi.fn(async () => new Response(
        '<html><head><title>Percent sale</title></head><body><main><h1>Percent sale</h1></main></body></html>',
        { headers: { 'content-type': 'text/html' } },
      )),
    };
    const next = vi.fn(async () => new Response('project literal'));

    const response = await onRequest(context, next);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('# Percent sale');
    expect(next).not.toHaveBeenCalled();
    expect(context.rewrite).toHaveBeenCalled();
  });

  test('an exact replacement authorization overrides a project artifact route', async () => {
    RUNTIME.config = resolveConfig({
      artifacts: { replace: ['/robots.txt'] },
      discovery: { robots: { enabled: true } },
    });
    const url = new URL('/robots.txt', 'https://example.test');
    const next = vi.fn(async () => new Response('project robots'));
    const response = await onRequest(
      { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite: vi.fn() },
      next,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('User-agent:');
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects percent encodings beyond the bounded validation depth', async () => {
    const url = new URL('/%252525252e%252525252e/secret.md', 'https://example.test');
    const next = vi.fn();
    const response = await onRequest(
      { request: new Request(url), url, locals: {}, isPrerendered: false, rewrite: vi.fn() },
      next,
    );

    expect(response.status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

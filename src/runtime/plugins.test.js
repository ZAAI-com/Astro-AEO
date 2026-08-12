import { describe, expect, test, vi } from 'vitest';
import {
  createRuntimePluginPageHandles,
  loadRuntimePlugins,
  runtimePluginArtifactFor,
  serveRuntimePluginArtifact,
} from './plugins.js';

function loader(overrides = {}) {
  const claim = { id: 'feed', pathname: '/feed.txt' };
  return {
    name: 'feed',
    module: './feed-runtime.js',
    options: { label: 'Answers' },
    stages: ['artifact:generate', 'artifact:validate'],
    claims: [claim],
    load: async () => ({
      name: 'feed',
      apiVersion: 1,
      setup(api) {
        api.claimArtifact(claim);
        api.on('artifact:generate', async ({ value, pages }) => {
          const page = await pages[0].read();
          return {
            action: 'replace',
            value: {
              claim: value.claim,
              representation: {
                body: `${api.options.label}: ${page.metadata.title}\n`,
                contentType: 'text/plain; charset=utf-8',
              },
            },
          };
        });
        api.on('artifact:validate', () => ({ action: 'keep' }));
      },
    }),
    ...overrides,
  };
}

describe('runtime plugin artifacts', () => {
  test('uses exact claims and respects external ownership unless replacement is explicit', () => {
    const ordinary = loader();
    expect(runtimePluginArtifactFor('/other.txt', [ordinary])).toBeNull();
    expect(runtimePluginArtifactFor('/feed.txt', [ordinary], { projectOwned: true })).toBeNull();

    const replacing = loader({ claims: [{ id: 'feed', pathname: '/feed.txt', replace: true }] });
    expect(runtimePluginArtifactFor('/feed.txt', [replacing], { projectOwned: true }))
      .toMatchObject({ plugin: 'feed', claim: { replace: true }, conflict: false });
  });

  test('preserves replacement authorization through both artifact hooks', async () => {
    const claim = { id: 'replacing-feed', pathname: '/feed.txt', replace: true };
    const observed = [];
    const replacing = loader({
      claims: [claim],
      load: async () => ({
        name: 'feed',
        apiVersion: 1,
        setup(api) {
          api.claimArtifact(claim);
          api.on('artifact:generate', ({ value }) => {
            observed.push({ stage: 'generate', claim: value.claim });
            return {
              action: 'replace',
              value: {
                claim: value.claim,
                representation: { body: 'feed', contentType: 'text/plain' },
              },
            };
          });
          api.on('artifact:validate', ({ value }) => {
            observed.push({ stage: 'validate', claim: value.claim });
          });
        },
      }),
    });
    const target = runtimePluginArtifactFor('/feed.txt', [replacing]);
    const response = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      [replacing],
    );

    expect(response.status).toBe(200);
    expect(observed).toEqual([
      { stage: 'generate', claim },
      { stage: 'validate', claim },
    ]);
  });

  test('matches encoded claims to decoded runtime pathnames', () => {
    const encoded = loader({
      claims: [{ id: 'feed', pathname: '/caf%C3%A9%25.txt', replace: true }],
    });

    expect(runtimePluginArtifactFor('/café%.txt', [encoded], { projectOwned: true }))
      .toMatchObject({
        pathname: '/caf%C3%A9%25.txt',
        plugin: 'feed',
        claim: { pathname: '/caf%C3%A9%25.txt' },
      });
  });

  test('fails duplicate generated claims closed regardless of owner or replacement', async () => {
    const target = runtimePluginArtifactFor('/feed.txt', [loader(), loader({ name: 'other' })]);
    expect(target).toMatchObject({ conflict: true });
    const response = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      [],
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error\n');

    expect(runtimePluginArtifactFor('/feed.txt', [loader()], { coreOwned: true }))
      .toMatchObject({ conflict: true });
  });

  test('provides frozen lazy page access and core GET, HEAD, ETag, and 304 behavior', async () => {
    const read = vi.fn(async () => ({
      id: '/guide',
      pathname: '/guide',
      metadata: { title: 'Guide', canonicalSource: 'authored' },
      source: { kind: 'cms', body: 'private source payload' },
      representations: {
        html: '<p>private rendered payload</p>',
        markdown: '# Guide',
        plainText: 'Guide',
      },
      authors: [],
      entities: [],
      directives: {
        index: true,
        includeInLlms: true,
        includeInLlmsFull: true,
        generateMarkdown: true,
      },
    }));
    const pages = createRuntimePluginPageHandles([{ pathname: '/guide' }], read);
    expect(Object.isFrozen(pages)).toBe(true);
    expect(Object.isFrozen(pages[0])).toBe(true);
    expect(pages[0].read.length).toBe(0);

    const loaded = await pages[0].read();
    expect(loaded).not.toHaveProperty('source');
    expect(loaded.representations).toEqual({ markdown: '# Guide', plainText: 'Guide' });
    expect(loaded.representations).not.toHaveProperty('html');
    expect(Object.isFrozen(loaded)).toBe(true);

    const configured = loader();
    const target = runtimePluginArtifactFor('/feed.txt', [configured]);
    const get = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      [configured],
      pages,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('Answers: Guide\n');
    expect(get.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(get.headers.get('etag')).toMatch(/^"[a-f\d]{64}"$/);

    const head = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt', { method: 'HEAD' }),
      [configured],
      pages,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));

    const notModified = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt', {
        headers: { 'if-none-match': get.headers.get('etag') },
      }),
      [configured],
      pages,
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('includes the root page in fixed runtime handles', async () => {
    const read = vi.fn(async (page) => ({
      id: page.pathname,
      pathname: page.pathname,
      metadata: { title: 'Home' },
      representations: { markdown: '# Home' },
    }));
    const pages = createRuntimePluginPageHandles([
      { pathname: '/' },
      { pathname: '/guide' },
    ], read);

    expect(pages.map((page) => page.pathname)).toEqual(['/', '/guide']);
    expect(await pages[0].read()).toMatchObject({ pathname: '/', metadata: { title: 'Home' } });
  });

  test.each([
    '/%2e%2e/secret',
    '/safe%2Fsecret',
    '/%252e%252e/secret',
    '/safe%252Fsecret',
  ])('rejects unsafe encoded runtime page handle %s', (pathname) => {
    const pages = createRuntimePluginPageHandles(
      [{ pathname: '/' }, { pathname }, { pathname: '/guide' }],
      async () => null,
    );

    expect(pages.map((page) => page.pathname)).toEqual(['/', '/guide']);
  });

  test('compares runtime module names using configured trimming', async () => {
    let seenOptions;
    const trimmed = loader({
      name: ' feed ',
      options: undefined,
      stages: [],
      claims: [],
      load: async () => ({
        name: 'feed',
        apiVersion: 1,
        setup(api) { seenOptions = api.options; },
      }),
    });

    const runtime = await loadRuntimePlugins([trimmed]);
    expect(runtime.failed).not.toContain(' feed ');
    expect(seenOptions).toBeUndefined();
  });

  test('rejects invalid runtime modules and hook failures with a generic no-store response', async () => {
    const invalid = loader({
      load: async () => ({ name: 'wrong', apiVersion: 1, setup() {} }),
    });
    const invalidResponse = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [invalid]),
      new Request('https://example.com/feed.txt'),
      [invalid],
    );
    expect(invalidResponse.status).toBe(500);
    expect(invalidResponse.headers.get('cache-control')).toBe('no-store');
    expect(await invalidResponse.text()).toBe('Internal Server Error\n');

    const broken = loader({
      load: async () => ({
        name: 'feed', apiVersion: 1,
        setup(api) {
          api.on('artifact:generate', () => { throw new Error('SECRET'); });
          api.on('artifact:validate', () => undefined);
        },
      }),
    });
    const brokenResponse = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [broken]),
      new Request('https://example.com/feed.txt'),
      [broken],
    );
    expect(brokenResponse.status).toBe(500);
    expect(await brokenResponse.text()).not.toContain('SECRET');
  });

  test('requires runtime stage and claim registrations to match the build manifest', async () => {
    const mismatched = loader({
      load: async () => ({
        name: 'feed', apiVersion: 1,
        setup(api) {
          api.claimArtifact({ id: 'other', pathname: '/other.txt' });
          api.on('artifact:generate', () => undefined);
          api.on('artifact:validate', () => undefined);
        },
      }),
    });
    const response = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [mismatched]),
      new Request('https://example.com/feed.txt'),
      [mismatched],
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error\n');

    const omitted = loader({
      load: async () => ({
        name: 'feed', apiVersion: 1,
        setup(api) {
          api.on('artifact:generate', () => undefined);
          api.on('artifact:validate', () => undefined);
        },
      }),
    });
    const omittedResponse = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [omitted]),
      new Request('https://example.com/feed.txt'),
      [omitted],
    );
    expect(omittedResponse.status).toBe(500);
  });

  test('isolates invalid hook results without exposing plugin payloads', async () => {
    const malformed = loader({
      load: async () => ({
        name: 'feed', apiVersion: 1,
        setup(api) {
          api.on('artifact:generate', () => ({
            action: 'keep',
            diagnostics: { message: 'SECRET' },
          }));
          api.on('artifact:validate', () => undefined);
        },
      }),
    });
    const response = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [malformed]),
      new Request('https://example.com/feed.txt'),
      [malformed],
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error\n');
  });

  test('redacts valid runtime diagnostic messages while retaining lifecycle context', async () => {
    const configured = loader({
      stages: ['artifact:generate'],
      load: async () => ({
        name: 'feed', apiVersion: 1,
        setup(api) {
          api.claimArtifact({ id: 'feed', pathname: '/feed.txt' });
          api.on('artifact:generate', () => ({
            action: 'keep',
            diagnostics: [{
              code: 'runtime-source-warning',
              message: 'Cookie: session=SECRET <script data-astro-aeo-head>PRIVATE</script>',
            }],
          }));
        },
      }),
    });
    const runtime = await loadRuntimePlugins([configured]);
    const result = await runtime.run('artifact:generate', { value: true }, {
      pathname: '/feed.txt',
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'runtime-source-warning',
        pathname: '/feed.txt',
        message: 'Plugin "feed" reported runtime-source-warning during artifact:generate.',
      }),
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/SECRET|PRIVATE|Cookie|script/);
  });

  test('does not handle methods outside the shared GET and HEAD contract', async () => {
    const configured = loader();
    const response = await serveRuntimePluginArtifact(
      runtimePluginArtifactFor('/feed.txt', [configured]),
      new Request('https://example.com/feed.txt', { method: 'POST' }),
      [configured],
    );
    expect(response).toBeNull();
  });

  test('uses the request runtime command and keeps command-specific loader caches separate', async () => {
    const setupCommands = [];
    const commandLoader = loader({
      load: vi.fn(async () => ({
        name: 'feed',
        apiVersion: 1,
        setup(api) {
          setupCommands.push(api.command);
          api.claimArtifact({ id: 'feed', pathname: '/feed.txt' });
          api.on('artifact:generate', ({ value }) => ({
            action: 'replace',
            value: {
              claim: value.claim,
              representation: {
                body: `${api.command}\n`,
                contentType: 'text/plain; charset=utf-8',
              },
            },
          }));
          api.on('artifact:validate', () => undefined);
        },
      })),
    });
    const loaders = [commandLoader];
    const target = runtimePluginArtifactFor('/feed.txt', loaders);

    const preview = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      loaders,
      [],
      'preview',
    );
    const repeatedPreview = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      loaders,
      [],
      'preview',
    );
    const development = await serveRuntimePluginArtifact(
      target,
      new Request('https://example.com/feed.txt'),
      loaders,
      [],
      'dev',
    );

    expect(await preview.text()).toBe('preview\n');
    expect(await repeatedPreview.text()).toBe('preview\n');
    expect(await development.text()).toBe('dev\n');
    expect(setupCommands).toEqual(['preview', 'dev']);
    expect(commandLoader.load).toHaveBeenCalledTimes(2);
  });
});

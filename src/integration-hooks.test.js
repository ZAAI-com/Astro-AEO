import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import aeo from './index.js';

/**
 * @param {{ publicSitemap?: boolean; routes?: any[] }} [options]
 * @returns {string}
 */
function runtimeConfigSource(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeo-runtime-sitemap-'));
  const publicRoot = join(root, 'public');
  mkdirSync(publicRoot, { recursive: true });
  if (options.publicSitemap) {
    writeFileSync(join(publicRoot, 'sitemap-index.xml'), '<urlset/>');
  }

  try {
    let updated;
    const integration = aeo({ discovery: { robots: { enabled: true } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    integration.hooks['astro:config:setup']({
      config: { integrations: [], site: new URL('https://example.test') },
      command: 'dev',
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: pathToFileURL(`${root}/`),
        publicDir: pathToFileURL(`${publicRoot}/`),
      },
      logger,
      injectTypes() {},
    });
    integration.hooks['astro:routes:resolved']({ routes: options.routes ?? [] });

    const plugin = updated.vite.plugins[0];
    const id = plugin.resolveId('astro-aeo:runtime-config');
    return plugin.load(id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('integration diagnostics and declarations', () => {
  test('warns for uncataloged dynamic pages and prerendered custom 404s', () => {
    const warnings = [];
    const injected = [];
    const integration = aeo({
      markdown: { negotiation: 'response' },
      discovery: { sitemap: { mode: 'disabled' } },
    });
    const logger = { warn: (message) => warnings.push(message), info() {}, error() {}, debug() {} };
    integration.hooks['astro:config:setup']({
      config: { integrations: [], site: new URL('https://example.test') },
      command: 'build',
      addMiddleware() {},
      updateConfig() {},
      logger,
    });
    integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: new URL('file:///tmp/astro-aeo-hooks/'),
        publicDir: new URL('file:///tmp/astro-aeo-hooks/public/'),
        adapter: { name: 'test' },
      },
      logger,
      injectTypes: (declaration) => injected.push(declaration),
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        { type: 'page', origin: 'project', pathname: undefined, prerender: false },
        { type: 'page', origin: 'project', pathname: '/404', prerender: true },
        { type: 'page', origin: 'internal', pathname: undefined, prerender: false },
      ],
    });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('dynamic page routes are not included'),
      expect.stringContaining('custom /404 route is prerendered'),
    ]));
    expect(injected[0].content).toContain('astroAeoCollect?: boolean');
  });

  test('does not diagnose Astro internal dynamic routes', () => {
    const warnings = [];
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn: (message) => warnings.push(message), info() {}, error() {}, debug() {} };
    integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware() {},
      updateConfig() {},
      logger,
    });
    integration.hooks['astro:routes:resolved']({
      routes: [{ type: 'page', origin: 'internal', pathname: undefined, prerender: false }],
    });
    expect(warnings.some((message) => message.includes('dynamic page routes'))).toBe(false);
  });

  test('runtime corpus candidates contain project pages, not endpoints or error routes', () => {
    let updated;
    const integration = aeo({ discovery: { sitemap: { mode: 'disabled' } } });
    const logger = { warn() {}, info() {}, error() {}, debug() {} };
    integration.hooks['astro:config:setup']({
      config: { integrations: [] },
      command: 'build',
      addMiddleware() {},
      updateConfig: (value) => { updated = value; },
      logger,
    });
    integration.hooks['astro:config:done']({
      config: {
        site: new URL('https://example.test'),
        base: '/',
        trailingSlash: 'ignore',
        build: { format: 'directory' },
        root: new URL('file:///tmp/astro-aeo-route-filter/'),
        publicDir: new URL('file:///tmp/astro-aeo-route-filter/public/'),
        adapter: { name: 'test' },
      },
      logger,
      injectTypes() {},
    });
    integration.hooks['astro:routes:resolved']({
      routes: [
        { type: 'page', origin: 'project', pathname: '/about', prerender: false },
        { type: 'endpoint', origin: 'project', pathname: '/api', prerender: false },
        { type: 'redirect', origin: 'project', pathname: '/old', prerender: false },
        { type: 'page', origin: 'project', pathname: '/404', prerender: true },
        { type: 'page', origin: 'project', pathname: '/500', prerender: false },
        {
          type: 'endpoint',
          origin: 'project',
          pathname: undefined,
          pattern: '/project/[slug].md',
          patternRegex: /^\/project\/([^/]+?)\.md$/,
          isPrerendered: false,
        },
        {
          type: 'page',
          origin: 'project',
          pathname: undefined,
          pattern: '/[slug]',
          patternRegex: /^\/([^/]+?)\/?$/,
          isPrerendered: false,
        },
        { type: 'page', origin: 'internal', pathname: '/_image', prerender: false },
      ],
    });

    const plugin = updated.vite.plugins[0];
    const id = plugin.resolveId('astro-aeo:runtime-config');
    const source = plugin.load(id);
    expect(source).toContain('"staticPaths": ["/about"]');
    expect(source).toContain(
      '"projectPaths": ["/about", "/api", "/old", "/404", "/500"]',
    );
    expect(source).not.toContain('"projectPaths": ["/_image"]');
    expect(source).toContain(
      '"projectPatterns": [new RegExp("^\\\\/project\\\\/([^/]+?)\\\\.md$", "")]',
    );
    expect(source).not.toContain('new RegExp("^\\\\/([^/]+?)\\\\/?$", "")');
  });

  test('runtime sitemap availability recognizes public files and concrete routes', () => {
    expect(runtimeConfigSource({ publicSitemap: true })).toContain(
      '"sitemapAvailable": true',
    );
    expect(runtimeConfigSource({
      routes: [
        {
          type: 'endpoint',
          origin: 'project',
          pathname: '/sitemap-index.xml',
          prerender: false,
        },
      ],
    })).toContain('"sitemapAvailable": true');
    expect(runtimeConfigSource()).toContain('"sitemapAvailable": false');
  });
});

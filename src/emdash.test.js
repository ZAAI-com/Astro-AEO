// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import emdashAeo, { emdashDefaults } from './emdash.js';

const EMDASH = { name: 'emdash', hooks: {} };
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** @param {{ manifest?: object; seed?: object }} [files] */
function projectRoot(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'astro-aeo-emdash-'));
  roots.push(root);
  if (files.manifest) writeFileSync(join(root, 'package.json'), JSON.stringify(files.manifest));
  if (files.seed) {
    mkdirSync(join(root, 'seed'));
    writeFileSync(join(root, 'seed', 'seed.json'), JSON.stringify(files.seed));
  }
  return pathToFileURL(`${root}/`);
}

/**
 * @param {unknown[]} integrations
 * @param {import('./emdash.js').EmDashAeoOptions} [options]
 * @param {URL} [root]
 */
function setup(integrations = [EMDASH], options = {}, root = projectRoot()) {
  /** @type {any} */
  let update;
  const warn = vi.fn();
  const hook = /** @type {any} */ (emdashAeo(options).hooks['astro:config:setup']);
  hook({ config: { integrations, root }, updateConfig: (/** @type {any} */ value) => (update = value), logger: { warn } });
  return { update, warn };
}

describe('emdashAeo', () => {
  it('registers aeo() and the EmDash bridge module', () => {
    const { update } = setup([{ name: 'react', hooks: {} }, EMDASH]);
    expect(update.integrations.map((/** @type {any} */ integration) => integration.name)).toEqual(['astro-aeo']);
    const plugin = update.vite.plugins[0];
    const id = plugin.resolveId('virtual:astro-aeo/emdash');
    expect(plugin.resolveId('emdash')).toBeUndefined();
    const source = plugin.load(id);
    expect(source).toContain("export { getDb } from 'emdash/runtime';");
    expect(source).toContain("from 'emdash';");
    expect(source).toContain('export const options = {"collections":{},"taxonomies":{},"maxEntries":50000};');
  });

  it('serializes only the catalog-relevant options into the bridge', () => {
    const { update } = setup([EMDASH], {
      collections: { legal: false, posts: { section: { title: 'Blog', match: '/blog/**' } } },
      taxonomies: { tag: '/tag/{slug}' },
      maxEntries: 10,
    });
    const plugin = update.vite.plugins[0];
    expect(plugin.load(plugin.resolveId('virtual:astro-aeo/emdash'))).toContain(
      'export const options = {"collections":{"legal":false,"posts":{}},"taxonomies":{"tag":"/tag/{slug}"},"maxEntries":10};',
    );
  });

  it('rejects a standalone aeo() integration, including a nested one', () => {
    expect(() => setup([EMDASH, { name: 'astro-aeo', hooks: {} }])).toThrow(/Remove aeo\(\) from `integrations`/);
    expect(() => setup([[EMDASH, [{ name: 'astro-aeo', hooks: {} }]]])).toThrow(/registers the Astro-AEO integration itself/);
  });

  it('requires the EmDash integration, wherever it is listed', () => {
    expect(() => setup([{ name: 'react', hooks: {} }])).toThrow(/needs the EmDash integration/);
    expect(() => setup([[null, false, [EMDASH]]])).not.toThrow();
  });

  it('names llms.txt sections from the seed URL patterns', () => {
    const root = projectRoot({
      manifest: { emdash: { seed: 'seed/seed.json' } },
      seed: {
        collections: [
          { slug: 'posts', urlPattern: '/posts/{slug}' },
          { slug: 'pages', urlPattern: '/{slug}' },
        ],
      },
    });
    const { update, warn } = setup([EMDASH], { collections: { posts: { section: 'Blog' }, pages: { section: 'Pages' } } }, root);
    const aeoIntegration = update.integrations[0];
    expect(aeoIntegration.name).toBe('astro-aeo');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('"pages" collection');
  });

  it.each([
    [{ revalidate: -1 }, /revalidate/],
    [{ revalidate: '10' }, /revalidate/],
    [{ maxEntries: 0 }, /maxEntries/],
    [{ collections: { posts: true } }, /collections\.posts/],
    [{ collections: { posts: { section: { title: 'Blog' } } } }, /collections\.posts/],
    [{ taxonomies: { tag: '/tag/' } }, /taxonomies\.tag/],
  ])('rejects invalid options %o', (options, message) => {
    expect(() => emdashAeo(/** @type {any} */ (options))).toThrow(message);
  });
});

describe('emdashDefaults', () => {
  it('excludes the admin, lists the EmDash catalog, and leaves robots and sitemaps to EmDash', () => {
    expect(emdashDefaults()).toEqual({
      pages: {
        exclude: ['/_emdash/**', '/404'],
        catalogs: [{ module: 'astro-aeo/emdash/catalog', revalidate: 10 }],
      },
      markdown: { negotiation: 'response' },
      corpus: { index: { sections: [] } },
      discovery: { robots: { enabled: false }, sitemap: { mode: 'disabled' } },
    });
  });

  it('yields to the project and appends to its lists', () => {
    expect(emdashDefaults({
      revalidate: false,
      aeo: {
        site: { name: 'Field Station' },
        pages: { exclude: ['/search'], catalogs: [{ module: './extra.js' }] },
        markdown: { negotiation: 'off', frontmatter: true },
        corpus: { index: { sections: [{ title: 'Guides', match: '/guides/**' }] } },
        discovery: { robots: { enabled: true }, sitemap: { mode: 'auto' } },
      },
    })).toEqual({
      site: { name: 'Field Station' },
      pages: {
        exclude: ['/search', '/_emdash/**', '/404'],
        catalogs: [{ module: './extra.js' }, { module: 'astro-aeo/emdash/catalog', revalidate: false }],
      },
      markdown: { negotiation: 'off', frontmatter: true },
      corpus: { index: { sections: [{ title: 'Guides', match: '/guides/**' }] } },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'auto' } },
    });
  });

  it('appends one section per collection that names one', () => {
    const config = emdashDefaults(
      {
        collections: {
          posts: { section: 'Blog' },
          customers: { section: { title: 'Customers', match: ['/customers/**'] } },
          legal: false,
          projects: {},
        },
      },
      { patterns: { posts: '/blog/{year}/{month}/{slug}' } },
    );
    expect(config.corpus?.index?.sections).toEqual([
      { title: 'Blog', match: '/blog/**' },
      { title: 'Customers', match: ['/customers/**'] },
    ]);
  });

  it('rejects legacy option names and IndexNow', () => {
    expect(() => emdashDefaults({ aeo: /** @type {any} */ ({ exclude: ['/x'] }) })).toThrow(/Replace exclude/);
    expect(() => emdashDefaults({ aeo: /** @type {any} */ ({ llmsTxt: {}, robotsTxt: {} }) })).toThrow(/llmsTxt, robotsTxt/);
    expect(() => emdashDefaults({ aeo: { discovery: { indexNow: { enabled: true } } } })).toThrow(/IndexNow/);
  });
});

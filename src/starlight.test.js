// @ts-check
import { describe, expect, it } from 'vitest';
import starlightAeo, { starlightDefaults } from './starlight.js';

/** @param {unknown[]} integrations */
function setup(integrations = [], options = {}) {
  /** @type {any[]} */
  const added = [];
  /** @type {any[]} */
  const middleware = [];
  starlightAeo(options).hooks['config:setup']({
    addIntegration: (integration) => added.push(integration),
    addRouteMiddleware: (config) => middleware.push(config),
    astroConfig: { integrations },
  });
  return { added, middleware };
}

describe('starlightAeo', () => {
  it('registers the integration, the options module and a post route middleware', () => {
    const { added, middleware } = setup();
    expect(added.map((integration) => integration.name)).toEqual(['astro-aeo', 'astro-aeo/starlight-options']);
    expect(middleware).toEqual([{ entrypoint: 'astro-aeo/starlight/route-data', order: 'post' }]);
  });

  it('serves the resolved options through a virtual module', () => {
    const { added } = setup([], { links: { edit: true, pagination: false }, techArticle: false });
    /** @type {any} */
    let config;
    added[1].hooks['astro:config:setup']({ updateConfig: (/** @type {any} */ value) => (config = value) });
    const plugin = config.vite.plugins[0];
    const id = plugin.resolveId('virtual:astro-aeo/starlight-options');
    expect(plugin.resolveId('other')).toBeUndefined();
    expect(plugin.load(id)).toBe('export default {"links":{"pagination":false,"edit":true},"techArticle":false};');
  });

  it('rejects a second, standalone aeo() integration, including a nested one', () => {
    expect(() => setup([{ name: 'astro-aeo', hooks: {} }])).toThrow(/Remove aeo\(\) from `integrations`/);
    expect(() => setup([[{ name: 'astro-aeo', hooks: {} }]])).toThrow(/registers the Astro-AEO integration itself/);
    expect(() => setup([{ name: 'other', hooks: {} }, null, false])).not.toThrow();
  });
});

describe('starlightDefaults', () => {
  it('defaults the sitemap to external, extraction to the content region, and excludes the 404 page', () => {
    expect(starlightDefaults()).toEqual({
      pages: { exclude: ['/404'] },
      markdown: { extraction: { selectors: ['.sl-markdown-content', 'main'] } },
      discovery: { sitemap: { mode: 'external' } },
    });
  });

  it('yields to the project for every default', () => {
    expect(starlightDefaults({
      pages: { exclude: ['/drafts/**'] },
      markdown: { frontmatter: true, extraction: { selectors: ['article'] } },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'auto' } },
    })).toEqual({
      pages: { exclude: ['/drafts/**', '/404'] },
      markdown: { frontmatter: true, extraction: { selectors: ['article'] } },
      discovery: { robots: { enabled: true }, sitemap: { mode: 'auto' } },
    });
  });

  it('adds no canonical key next to its deprecated spelling', () => {
    const resolved = /** @type {any} */ (starlightDefaults(/** @type {any} */ ({ exclude: ['/x'], sitemap: { enabled: true } })));
    expect(resolved.pages).toBeUndefined();
    expect(resolved.discovery).toBeUndefined();
    expect(resolved.exclude).toEqual(['/x']);
  });
});

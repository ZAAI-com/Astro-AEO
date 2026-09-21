import type { AstroAeoConfig } from './index.js';

export interface StarlightAeoOptions {
  /**
   * Options for the Astro-AEO integration, which this plugin registers for you.
   * Do not also add `aeo()` to `integrations`. Two defaults differ from a plain
   * Astro project: `discovery.sitemap.mode` is `'external'` because Starlight
   * registers `@astrojs/sitemap` itself, and `markdown.extraction.selectors`
   * starts with `.sl-markdown-content`.
   */
  aeo?: AstroAeoConfig;
  links?: {
    /** Append Starlight's previous and next page links to each companion. Default `true`. */
    pagination?: boolean;
    /** Append the "edit this page" URL when Starlight resolved one. Default `false`. */
    edit?: boolean;
  };
  /**
   * Add a minimal `TechArticle` entity (headline, description, language, modified
   * date) from the page's own frontmatter. Nothing is inferred. Default `true`.
   */
  techArticle?: boolean;
}

/** Structurally a Starlight plugin, declared here so the types load without Starlight installed. */
export interface StarlightAeoPlugin {
  name: string;
  hooks: {
    'config:setup'(context: {
      addIntegration(integration: import('astro').AstroIntegration): void;
      addRouteMiddleware(config: { entrypoint: string; order?: 'pre' | 'post' | 'default' }): void;
      astroConfig: { integrations?: unknown[] };
    }): void;
  };
}

export default function starlightAeo(options?: StarlightAeoOptions): StarlightAeoPlugin;

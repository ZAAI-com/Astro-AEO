// @ts-check
import { readFileSync } from 'node:fs';
import aeo from './index.js';
import { DEFAULT_SECTIONS } from './config.js';
import { DEFAULT_MAX_ENTRIES } from './emdash/inventory.js';
import { urlPatternGlob } from './emdash/url-pattern.js';

const BRIDGE_MODULE = 'virtual:astro-aeo/emdash';
const RESOLVED_BRIDGE_MODULE = `\0${BRIDGE_MODULE}`;
const CATALOG_MODULE = 'astro-aeo/emdash/catalog';
const DEFAULT_REVALIDATE = 10;
const LEGACY_KEYS = ['exclude', 'llmsTxt', 'sitemap', 'robotsTxt'];

/**
 * EmDash integration. It registers the Astro-AEO integration itself with
 * defaults for an EmDash site and a page catalog that lists every published
 * entry with a public URL, so a project adds `emdashAeo()` next to `emdash()`
 * and does not add `aeo()`.
 *
 * The catalog reads EmDash through its public plugin read API, imported from
 * the project's own `emdash` install by a virtual module, so Astro-AEO has no
 * dependency on EmDash and works with every EmDash database.
 *
 * @param {import('./emdash.js').EmDashAeoOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function emdashAeo(options = {}) {
  validateOptions(options);
  const bridgeOptions = {
    collections: Object.fromEntries(
      Object.entries(options.collections ?? {}).map(([slug, setting]) => [slug, setting === false ? false : {}]),
    ),
    taxonomies: { ...options.taxonomies },
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
  };
  return {
    name: 'astro-aeo/emdash',
    hooks: {
      'astro:config:setup'({ config, updateConfig, logger }) {
        const integrations = /** @type {any[]} */ (config.integrations ?? []).flat(Infinity);
        if (integrations.some((integration) => integration?.name === 'astro-aeo')) {
          throw new Error(
            'astro-aeo: emdashAeo() registers the Astro-AEO integration itself. ' +
            'Remove aeo() from `integrations` and pass its options as emdashAeo({ aeo: { ... } }).',
          );
        }
        if (!integrations.some((integration) => integration?.name === 'emdash')) {
          throw new Error(
            'astro-aeo: emdashAeo() needs the EmDash integration. Add emdash() from "emdash/astro" to `integrations`.',
          );
        }
        const patterns = seedUrlPatterns(config.root, (message) => logger.warn(message));
        updateConfig({
          integrations: [aeo(emdashDefaults(options, { patterns, warn: (message) => logger.warn(message) }))],
          vite: { plugins: [bridgePlugin(bridgeOptions)] },
        });
      },
    },
  };
}

/**
 * The Astro-AEO configuration for an EmDash site. EmDash serves its admin and
 * API under `/_emdash/` and its own `robots.txt` and sitemaps, and renders every
 * page on demand. Anything the project sets in `options.aeo` wins; the two
 * exclusions and the EmDash catalog are added to the project's own lists.
 *
 * @param {import('./emdash.js').EmDashAeoOptions} [options]
 * @param {{ patterns?: Record<string, string>; warn?: (message: string) => void }} [facts]
 * @returns {import('./index.js').AstroAeoConfig}
 */
export function emdashDefaults(options = {}, facts = {}) {
  const input = /** @type {any} */ (options.aeo ?? {});
  const legacy = LEGACY_KEYS.filter((key) => input[key] !== undefined);
  if (legacy.length > 0) {
    throw new Error(
      `astro-aeo: emdashAeo() merges its defaults into the current option names. Replace ${legacy.join(', ')} ` +
      'with pages.exclude, corpus.index, and discovery (see "Migrating from 1.0" in the README).',
    );
  }
  if (input.discovery?.indexNow?.enabled === true) {
    throw new Error(
      'astro-aeo: emdashAeo() cannot enable IndexNow. An EmDash site lists its pages at request time, ' +
      'so the build has no page inventory to compare and would report every page as removed.',
    );
  }
  const revalidate = options.revalidate === undefined ? DEFAULT_REVALIDATE : options.revalidate;
  return {
    ...input,
    pages: {
      ...input.pages,
      exclude: [...(input.pages?.exclude ?? []), '/_emdash/**', '/404'],
      catalogs: [...(input.pages?.catalogs ?? []), { module: CATALOG_MODULE, revalidate }],
    },
    markdown: {
      negotiation: 'response',
      ...input.markdown,
    },
    corpus: {
      ...input.corpus,
      index: {
        ...input.corpus?.index,
        // Without the project's own sections, keep the default Home rule ahead of the collections.
        sections: [
          ...(input.corpus?.index?.sections ?? DEFAULT_SECTIONS),
          ...collectionSections(options.collections ?? {}, facts.patterns ?? {}, facts.warn),
        ],
      },
    },
    discovery: {
      ...input.discovery,
      robots: { enabled: false, ...input.discovery?.robots },
      sitemap: { mode: 'disabled', ...input.discovery?.sitemap },
    },
  };
}

/**
 * @param {NonNullable<import('./emdash.js').EmDashAeoOptions['collections']>} collections
 * @param {Record<string, string>} patterns
 * @param {((message: string) => void) | undefined} warn
 * @returns {{ title: string; match: string | string[] }[]}
 */
function collectionSections(collections, patterns, warn) {
  /** @type {{ title: string; match: string | string[] }[]} */
  const sections = [];
  for (const [slug, setting] of Object.entries(collections)) {
    if (setting === false || setting.section === undefined) continue;
    if (typeof setting.section !== 'string') {
      sections.push({ title: setting.section.title, match: setting.section.match });
      continue;
    }
    const glob = patterns[slug] ? urlPatternGlob(patterns[slug]) : null;
    if (!glob) {
      warn?.(
        `astro-aeo: emdashAeo() could not derive the URLs of the "${slug}" collection from its seed urlPattern, ` +
        `so its section was skipped. Pass collections.${slug}.section as { title, match }.`,
      );
      continue;
    }
    sections.push({ title: setting.section, match: glob });
  }
  return sections;
}

/**
 * Collection URL patterns from the seed file named by `package.json`
 * (`"emdash": { "seed": "seed/seed.json" }`), used only to name llms.txt
 * sections. The runtime catalog reads the live patterns from the database.
 *
 * @param {URL} root the Astro project root, which always ends in a slash.
 * @param {(message: string) => void} warn
 * @returns {Record<string, string>}
 */
function seedUrlPatterns(root, warn) {
  /** @type {Record<string, string>} */
  const patterns = {};
  let seedPath;
  try {
    const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    seedPath = manifest?.emdash?.seed;
  } catch {
    return patterns;
  }
  if (typeof seedPath !== 'string' || !seedPath) return patterns;
  try {
    const seed = JSON.parse(readFileSync(new URL(seedPath, root), 'utf8'));
    for (const collection of Array.isArray(seed?.collections) ? seed.collections : []) {
      if (typeof collection?.slug === 'string' && typeof collection.urlPattern === 'string') {
        patterns[collection.slug] = collection.urlPattern;
      }
    }
  } catch {
    warn(`astro-aeo: emdashAeo() could not read the EmDash seed file "${seedPath}".`);
  }
  return patterns;
}

/**
 * Serves `virtual:astro-aeo/emdash`. Its imports resolve from the project root,
 * so they reach the project's own `emdash` install and share its modules.
 *
 * @param {{ collections: Record<string, false | object>; taxonomies: Record<string, string>; maxEntries: number }} bridgeOptions
 */
function bridgePlugin(bridgeOptions) {
  return {
    name: 'astro-aeo:emdash-bridge',
    /** @param {string} id */
    resolveId: (id) => (id === BRIDGE_MODULE ? RESOLVED_BRIDGE_MODULE : undefined),
    /** @param {string} id */
    load: (id) =>
      id === RESOLVED_BRIDGE_MODULE
        ? `export { getDb } from 'emdash/runtime';\n` +
          `export { createContentAccess, createSchemaAccess, getI18nConfig, getTaxonomyTerms, isI18nEnabled } from 'emdash';\n` +
          `export const options = ${JSON.stringify(bridgeOptions)};\n`
        : undefined,
  };
}

/** @param {import('./emdash.js').EmDashAeoOptions} options */
function validateOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('astro-aeo: emdashAeo() options must be an object.');
  }
  const { revalidate, maxEntries, collections, taxonomies } = options;
  if (
    revalidate !== undefined &&
    revalidate !== false &&
    !(typeof revalidate === 'number' && Number.isFinite(revalidate) && revalidate >= 0)
  ) {
    throw new TypeError('astro-aeo: emdashAeo() revalidate must be a non-negative number of seconds or false.');
  }
  if (maxEntries !== undefined && !(Number.isInteger(maxEntries) && maxEntries > 0)) {
    throw new TypeError('astro-aeo: emdashAeo() maxEntries must be a positive integer.');
  }
  for (const [slug, setting] of Object.entries(collections ?? {})) {
    if (setting === false) continue;
    const section = setting?.section;
    const valid =
      setting !== null &&
      typeof setting === 'object' &&
      (section === undefined ||
        (typeof section === 'string' && section.trim() !== '') ||
        (section !== null &&
          typeof section === 'object' &&
          typeof section.title === 'string' &&
          (typeof section.match === 'string' || (Array.isArray(section.match) && section.match.every((glob) => typeof glob === 'string')))));
    if (!valid) {
      throw new TypeError(
        `astro-aeo: emdashAeo() collections.${slug} must be false or { section?: string | { title, match } }.`,
      );
    }
  }
  for (const [name, pattern] of Object.entries(taxonomies ?? {})) {
    if (typeof pattern !== 'string' || !pattern.includes('{slug}')) {
      throw new TypeError(
        `astro-aeo: emdashAeo() taxonomies.${name} must be a URL pattern containing {slug}, such as "/${name}/{slug}".`,
      );
    }
  }
}

// @ts-check
// The 1.0 configuration spelling, removed in 2.0. The table stays so a 1.0 config
// fails with the exact canonical replacement instead of being silently ignored.
import { AeoConfigError } from './errors.js';
import { getPath, isPlainObject, setPath } from './object-path.js';

/**
 * @typedef {object} LegacyMove
 * @property {string} from            Dotted path in the 1.0 config.
 * @property {string} to              Dotted path in the canonical config.
 * @property {string} section         Canonical section the key belongs to.
 * @property {string} group           1.0 block name, or '' for the top-level scalars.
 * @property {(v: any) => any} [map]  Value conversion when the shape changed, not just the name.
 * @property {string} [supersededBy]  A 1.0 alias that wins over this one when both are set.
 */

/** @type {LegacyMove[]} */
export const LEGACY_MOVES = [
  { from: 'include', to: 'pages.include', section: 'pages', group: '' },
  { from: 'exclude', to: 'pages.exclude', section: 'pages', group: '' },
  { from: 'respectNoindex', to: 'pages.respectNoindex', section: 'pages', group: '' },
  { from: 'stripTitleSuffix', to: 'pages.stripTitleSuffix', section: 'pages', group: '' },

  { from: 'dotmd.enabled', to: 'markdown.enabled', section: 'markdown', group: 'dotmd' },
  { from: 'dotmd.linkTag', to: 'markdown.alternateLink', section: 'markdown', group: 'dotmd' },
  { from: 'dotmd.includeLastModified', to: 'markdown.includeLastModified', section: 'markdown', group: 'dotmd' },
  { from: 'dotmd.frontmatter', to: 'markdown.frontmatter', section: 'markdown', group: 'dotmd' },
  { from: 'dotmd.dotmdMetadata', to: 'markdown.frontmatter', section: 'markdown', group: 'dotmd', supersededBy: 'dotmd.frontmatter' },

  { from: 'llmsTxt.enabled', to: 'corpus.index.enabled', section: 'corpus', group: 'llmsTxt' },
  { from: 'llmsTxt.sections', to: 'corpus.index.sections', section: 'corpus', group: 'llmsTxt' },
  { from: 'llmsTxt.defaultSection', to: 'corpus.index.defaultSection', section: 'corpus', group: 'llmsTxt' },
  { from: 'llmsTxt.includeDescriptions', to: 'corpus.index.includeDescriptions', section: 'corpus', group: 'llmsTxt' },
  { from: 'llmsTxt.showLastmod', to: 'corpus.index.showLastModified', section: 'corpus', group: 'llmsTxt' },
  { from: 'llmsTxt.includeNoDotmd', to: 'corpus.index.includeHtmlOnly', section: 'corpus', group: 'llmsTxt' },

  { from: 'llmsFullTxt.enabled', to: 'corpus.full.enabled', section: 'corpus', group: 'llmsFullTxt' },
  { from: 'llmsFullTxt.mode', to: 'corpus.full.mode', section: 'corpus', group: 'llmsFullTxt' },

  { from: 'urlMap.enabled', to: 'corpus.urlMap.enabled', section: 'corpus', group: 'urlMap' },
  { from: 'urlMap.outputFilepath', to: 'corpus.urlMap.outputFilepath', section: 'corpus', group: 'urlMap' },

  { from: 'sitemap.enabled', to: 'discovery.sitemap.mode', section: 'discovery', group: 'sitemap', map: (v) => (v ? 'auto' : 'external') },
  { from: 'sitemap.options', to: 'discovery.sitemap.options', section: 'discovery', group: 'sitemap' },

  { from: 'sitemapAlias.enabled', to: 'discovery.sitemap.alias.enabled', section: 'discovery', group: 'sitemapAlias' },
  { from: 'sitemapAlias.sourceFilename', to: 'discovery.sitemap.alias.sourceFilename', section: 'discovery', group: 'sitemapAlias' },
  { from: 'sitemapAlias.outputFilename', to: 'discovery.sitemap.alias.outputFilename', section: 'discovery', group: 'sitemapAlias' },

  { from: 'robotsTxt.enabled', to: 'discovery.robots.enabled', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.universalAllow', to: 'discovery.robots.universalAllow', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.allow', to: 'discovery.robots.allow', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.disallow', to: 'discovery.robots.disallow', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.includeSitemap', to: 'discovery.robots.includeSitemap', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.sitemapPath', to: 'discovery.robots.sitemapPath', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.includeLlmsTxt', to: 'discovery.robots.includeLlmsTxt', section: 'discovery', group: 'robotsTxt' },
  { from: 'robotsTxt.extraLines', to: 'discovery.robots.extraLines', section: 'discovery', group: 'robotsTxt' },

  { from: 'domainProfile.enabled', to: 'site.profile.enabled', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.name', to: 'site.profile.name', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.description', to: 'site.profile.description', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.website', to: 'site.profile.website', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.email', to: 'site.profile.email', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.contact', to: 'site.profile.email', section: 'site.profile', group: 'domainProfile', supersededBy: 'domainProfile.email' },
  { from: 'domainProfile.logo', to: 'site.profile.logo', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.sameAs', to: 'site.profile.sameAs', section: 'site.profile', group: 'domainProfile' },
  { from: 'domainProfile.entityType', to: 'site.profile.entityType', section: 'site.profile', group: 'domainProfile' },
];

/**
 * @typedef {object} LiftResult
 * @property {Record<string, any>} lifted                 1.0 values rewritten onto canonical paths.
 * @property {Map<string, LegacyMove[]>} movesBySection   Which moves fired, grouped by canonical section.
 */

/**
 * @param {Record<string, any>} userConfig
 * @returns {LiftResult}
 */
export function liftLegacy(userConfig) {
  /** @type {Record<string, any>} */
  const lifted = {};
  /** @type {Map<string, LegacyMove[]>} */
  const movesBySection = new Map();

  for (const move of LEGACY_MOVES) {
    const value = getPath(userConfig, move.from);
    if (value === undefined) continue;
    if (move.supersededBy && getPath(userConfig, move.supersededBy) !== undefined) continue;

    setPath(lifted, move.to, move.map ? move.map(value) : value);
    const list = movesBySection.get(move.section) ?? [];
    list.push(move);
    movesBySection.set(move.section, list);
  }

  return { lifted, movesBySection };
}

/** 1.0 top-level names. Each one is removed, whatever it contains. */
export const REMOVED_TOP_LEVEL = [...new Set(LEGACY_MOVES.map((move) => move.from.split('.')[0]))];

/** Where each removed 1.0 block now lives, for a block with no recognized key inside. */
const BLOCK_DESTINATIONS = new Map(
  LEGACY_MOVES.filter((move) => move.group).map((move) => [
    move.group,
    move.group === 'sitemap' ? 'discovery.sitemap' : move.to.split('.').slice(0, -1).join('.'),
  ]),
);

export const MIGRATION_GUIDE =
  'See "Migrating to 2.0" in the astro-aeo README: https://github.com/ZAAI-com/Astro-AEO#migrating-to-20';

/**
 * Throws when the configuration still uses a key removed in 2.0. The message names
 * every removed path with its canonical path and prints the replacement block.
 * Keys set to `undefined` are ignored.
 *
 * @param {Record<string, any>} userConfig
 * @returns {void}
 */
export function assertNoRemovedKeys(userConfig) {
  if (!isPlainObject(userConfig)) return;
  /** @type {string[]} */
  const lines = [];
  for (const name of REMOVED_TOP_LEVEL) {
    if (userConfig[name] === undefined) continue;
    const moves = LEGACY_MOVES.filter(
      (move) => (move.from === name || move.from.startsWith(`${name}.`)) && getPath(userConfig, move.from) !== undefined,
    );
    if (moves.length === 0) {
      lines.push(`  ${name} -> ${BLOCK_DESTINATIONS.get(name) ?? name}`);
      continue;
    }
    for (const move of moves) {
      const mapped = move.map ? ` (${describeMapped(move, getPath(userConfig, move.from))})` : '';
      lines.push(`  ${move.from} -> ${move.to}${mapped}`);
    }
  }
  if (lines.length === 0) return;

  const replacement = renderReplacement(userConfig);
  throw new AeoConfigError(
    [
      'astro-aeo: these 1.0 configuration keys were removed in 2.0:',
      ...lines,
      ...(replacement ? ['Replace them with:', '', replacement] : []),
      MIGRATION_GUIDE,
    ].join('\n'),
  );
}

/**
 * @param {LegacyMove} move
 * @param {any} value
 * @returns {string}
 */
function describeMapped(move, value) {
  const mapped = /** @type {(v: any) => any} */ (move.map)(value);
  return `${JSON.stringify(value) ?? String(value)} becomes ${JSON.stringify(mapped) ?? String(mapped)}`;
}

/**
 * @param {Record<string, any>} userConfig
 * @returns {string | null}  null when there is nothing to migrate.
 */
export function printMigration(userConfig) {
  const replacement = renderReplacement(userConfig);
  return replacement ? `astro-aeo: canonical replacement for your 1.0 keys:\n\n${replacement}` : null;
}

/**
 * @param {Record<string, any>} userConfig
 * @returns {string | null}
 */
function renderReplacement(userConfig) {
  const { lifted, movesBySection } = liftLegacy(userConfig);
  if (movesBySection.size === 0) return null;

  const state = { hasFunction: false };
  const body = renderBlock(lifted, 1, state);
  return [
    body,
    '',
    state.hasFunction
      ? 'Functions are printed as placeholders, copy those by hand.'
      : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * @param {Record<string, any>} value
 * @param {number} depth
 * @param {{ hasFunction: boolean }} state
 * @returns {string}
 */
function renderBlock(value, depth, state) {
  const pad = '  '.repeat(depth);
  return Object.keys(value)
    .map((key) => {
      const next = value[key];
      return `${pad}${renderPropertyKey(key)}: ${renderMigrationValue(next, depth, state)},`;
    })
    .join('\n');
}

/** @param {string} key @returns {string} */
function renderPropertyKey(key) {
  if (key === '__proto__') return `[${JSON.stringify(key)}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * @param {any} value
 * @param {number} depth
 * @param {{ hasFunction: boolean }} state
 * @returns {string}
 */
function renderMigrationValue(value, depth, state) {
  if (typeof value === 'function') {
    state.hasFunction = true;
    return 'undefined /* TODO */';
  }
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'Number.NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    if (Object.is(value, -0)) return '-0';
    return String(value);
  }
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof RegExp) {
    return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? 'new Date(Number.NaN)'
      : `new Date(${JSON.stringify(value.toISOString())})`;
  }
  if (value instanceof Set) return `new Set(${renderMigrationValue([...value], depth, state)})`;
  if (value instanceof Map) return `new Map(${renderMigrationValue([...value], depth, state)})`;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => renderMigrationValue(entry, depth, state)).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return '{}';
    const pad = '  '.repeat(depth);
    return `{\n${renderBlock(value, depth + 1, state)}\n${pad}}`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json;
}

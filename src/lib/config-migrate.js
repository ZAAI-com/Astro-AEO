// @ts-check

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
export function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {Record<string, any> | undefined} obj
 * @param {string} path
 * @returns {any}
 */
export function getPath(obj, path) {
  let cur = /** @type {any} */ (obj);
  for (const key of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * @param {Record<string, any>} obj
 * @param {string} path
 * @param {any} value
 * @returns {void}
 */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = /** @type {string} */ (keys.pop());
  let cur = obj;
  for (const key of keys) {
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  cur[last] = value;
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function configEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => configEqual(v, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && configEqual(a[k], b[k]));
  }
  return false;
}

/**
 * @param {any} v
 * @returns {string}
 */
export function describeValue(v) {
  if (typeof v === 'function') return v.name ? `[Function: ${v.name}]` : '[Function (anonymous)]';
  if (v instanceof RegExp) return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return `[${v.map(describeValue).join(', ')}]`;
  if (isPlainObject(v)) {
    return `{ ${Object.keys(v)
      .map((k) => `${k}: ${describeValue(v[k])}`)
      .join(', ')} }`;
  }
  const json = JSON.stringify(v);
  return json === undefined ? String(v) : json;
}

/**
 * @param {string} s
 * @param {number} [max]
 * @returns {string}
 */
export function truncate(s, max = 120) {
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

/**
 * @typedef {object} LegacyMove
 * @property {string} from            Dotted path in the 1.0 config.
 * @property {string} to              Dotted path in the canonical 1.1 config.
 * @property {string} section         Canonical section, used to dedupe warnings.
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

/** @param {string} section @returns {string} */
function canonicalLabel(section) {
  return section;
}

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

/**
 * @typedef {object} MergeResult
 * @property {Record<string, any>} merged   Canonical input, with lifted 1.0 values filling the gaps.
 * @property {string[]} warnings           Deprecation and migration warnings, at most one per section.
 */

/**
 * @param {Record<string, any>} userConfig
 * @param {(message: string) => never} onConflict  Called with the assembled error text.
 * @returns {MergeResult}
 */
export function mergeLegacy(userConfig, onConflict) {
  const { lifted, movesBySection } = liftLegacy(userConfig);
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const conflicts = [];

  for (const [section, moves] of movesBySection) {
    /** @type {LegacyMove[]} */
    const overridden = [];
    for (const move of moves) {
      const canonical = getPath(userConfig, move.to);
      if (canonical === undefined) continue;
      const legacy = getPath(lifted, move.to);
      if (configEqual(legacy, canonical)) {
        overridden.push(move);
        continue;
      }
      const rawLegacy = getPath(userConfig, move.from);
      const mapped = move.map ? ` (maps to ${move.to}: ${truncate(describeValue(legacy))})` : '';
      conflicts.push(
        `  ${move.from}: ${truncate(describeValue(rawLegacy))}${mapped} vs ${move.to}: ${truncate(describeValue(canonical))}`,
      );
    }

    if (conflicts.length) continue;

    const groups = [...new Set(moves.map((m) => m.group).filter(Boolean))];
    const blocks = groups.length ? groups.map((g) => `\`${g}\``).join(', ') : 'the top-level page options';
    const verb = groups.length === 1 ? 'is' : 'are';
    const pairs = moves.map((m) => `${m.from} -> ${m.to}`).join(', ');

    if (overridden.length === moves.length) {
      warnings.push(
        `astro-aeo: ${blocks} and \`${canonicalLabel(section)}\` ${verb} both set to the same values, so \`${canonicalLabel(section)}\` is used. Remove the 1.0 block (it is removed in 2.0).`,
      );
    } else {
      warnings.push(
        `astro-aeo: ${blocks} ${verb} deprecated, use \`${canonicalLabel(section)}\` (${pairs}). The 1.0 keys still work in 1.x and are removed in 2.0.`,
      );
    }
  }

  if (conflicts.length) {
    onConflict(
      'astro-aeo: conflicting configuration, the 1.0 keys and their 1.1 replacements disagree:\n' +
        `${conflicts.join('\n')}\n` +
        'Keep the 1.1 keys and delete the 1.0 ones, or keep the 1.0 ones and delete the 1.1 keys.',
    );
  }

  return { merged: deepMerge(lifted, userConfig), warnings };
}

/**
 * @param {Record<string, any>} userConfig
 * @returns {string | null}  null when there is nothing to migrate.
 */
export function printMigration(userConfig) {
  const { lifted, movesBySection } = liftLegacy(userConfig);
  if (movesBySection.size === 0) return null;

  const state = { hasFunction: false };
  const body = renderBlock(lifted, 1, state);
  return [
    'astro-aeo: canonical replacement for your 1.0 keys:',
    '',
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
    const pad = '  '.repeat(depth);
    return `{\n${renderBlock(value, depth + 1, state)}\n${pad}}`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json;
}

/**
 * @param {Record<string, any>} base
 * @param {Record<string, any>} over
 * @returns {Record<string, any>}
 */
export function deepMerge(base, over) {
  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const key of Object.keys(over)) {
    const next = over[key];
    if (next === undefined) continue;
    out[key] = isPlainObject(next) && isPlainObject(out[key]) ? deepMerge(out[key], next) : next;
  }
  return out;
}

// @ts-check

/**
 * Migration engine for the 1.0 -> 1.1 configuration rename.
 *
 * Every 1.0 key keeps working through 1.x and is removed in 2.0. This module owns
 * the single source of truth for where each old key went (`LEGACY_MOVES`), so the
 * deprecation warnings, the conflict errors, the migration printer, and the README
 * table cannot drift apart.
 */

/**
 * True only for objects that behave like config literals. A `RegExp` is
 * `typeof 'object'` and not an array, so the naive check treats it as a
 * traversable object: check the prototype instead.
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
export function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Read a dotted path. Returns undefined if any segment is missing or is not a
 * plain object, so `getPath({ dotmd: /re/ }, 'dotmd.linkTag')` is undefined
 * rather than a property read on a RegExp.
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
 * Write a dotted path, creating intermediate plain objects.
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
 * Structural equality for config values, used to decide whether a 1.0 key and its
 * 1.1 replacement agree.
 *
 * `RegExp` compares by source and flags, `Date` by time, arrays and plain objects
 * structurally. Functions compare by **reference**: deep equality on a function is
 * impossible, so two separately written callbacks count as different even when
 * their source text matches. The practical consequence is that a user who pasted
 * the same `match` callback into both the old and the new key gets a conflict
 * error telling them to delete one, which is the right advice regardless.
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
 * Render a config value for an error message. `JSON.stringify` drops functions
 * entirely, so two `sections` arrays differing only in a `match` callback would
 * print identically and the error would look like nonsense. Functions and regular
 * expressions therefore get explicit placeholders.
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
 * Truncate a rendered value so one enormous option cannot swamp an error.
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

/**
 * Every 1.0 key and where it moved. Order is irrelevant to correctness but is kept
 * grouped by 1.0 block for readability.
 *
 * `supersededBy` reproduces the precedence 1.0 already had (`frontmatter ?? dotmdMetadata`
 * and `email ?? contact`) in a single pass, without a nested pre-resolution step.
 * @type {LegacyMove[]}
 */
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

  // `sitemap.enabled: false` never meant "no sitemap", only "do not auto-register
  // @astrojs/sitemap"; a user-registered sitemap stayed eligible. `external` carries
  // that meaning. The new `disabled` mode has no 1.0 equivalent.
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
 * Human label for a canonical section in warning text.
 * @param {string} section
 * @returns {string}
 */
function canonicalLabel(section) {
  return section;
}

/**
 * @typedef {object} LiftResult
 * @property {Record<string, any>} lifted                 1.0 values rewritten onto canonical paths.
 * @property {Map<string, LegacyMove[]>} movesBySection   Which moves fired, grouped by canonical section.
 */

/**
 * Rewrite every present 1.0 key onto its canonical path.
 *
 * Presence is `!== undefined`, not `hasOwnProperty`, matching the idiom 1.0 already
 * used. That distinction matters for the sitemap tri-state: an explicitly
 * `undefined` `robotsTxt.includeSitemap` and an omitted one must both keep meaning
 * "auto", so absence has to survive the lift untouched.
 * @param {Record<string, any>} userConfig
 * @param {Set<string>} [activeSections]  Restrict lifting to these canonical sections.
 * @returns {LiftResult}
 */
export function liftLegacy(userConfig, activeSections) {
  /** @type {Record<string, any>} */
  const lifted = {};
  /** @type {Map<string, LegacyMove[]>} */
  const movesBySection = new Map();

  for (const move of LEGACY_MOVES) {
    if (activeSections && !activeSections.has(move.section)) continue;
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
 * Merge lifted 1.0 values under the canonical values the user wrote directly.
 *
 * Canonical always wins. Three outcomes per canonical section:
 * legacy only, warn once that the block moved; both set and equal, warn once that
 * the canonical value is used; both set and different, throw.
 * @param {Record<string, any>} userConfig
 * @param {(message: string) => never} onConflict  Called with the assembled error text.
 * @param {Set<string>} [activeSections]  Restrict the merge to these canonical sections.
 * @returns {MergeResult}
 */
export function mergeLegacy(userConfig, onConflict, activeSections) {
  const { lifted, movesBySection } = liftLegacy(userConfig, activeSections);
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
    const verb = groups.length > 1 ? 'are' : 'is';
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
 * Merge `over` onto `base`, recursing into plain objects only. Arrays, regular
 * expressions, dates, and functions are replaced wholesale, never merged
 * element-wise: a user who sets `discovery.robots.allow` means that exact list.
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

// @ts-check
import { parseDocument } from './html-document.js';
import { authoredCanonical, configuredCanonical, siteScopeUrl, stableCanonical } from './canonical.js';
import { createGraph, createId, serializeGraph, validateGraph } from '../schema.js';
import {
  hasHtmlHead,
  headTagSources,
  htmlElementRanges,
  htmlTagAttribute,
  insertIntoHead,
  removeHtmlElements,
  removeHeadTags,
} from './html-head-ranges.js';

export const HEAD_MARKER_MIME = 'application/vnd.astro-aeo-head+json';
export const HEAD_MARKER_ATTRIBUTE = 'data-astro-aeo-head';
export const MANAGED_GRAPH_ATTRIBUTE = 'data-astro-aeo-graph';

/**
 * Apply explicit AeoHead output or default graph enrichment through targeted
 * ranges. Existing JSON-LD scripts are inspected but never rewritten.
 *
 * @param {object} input
 * @param {string} input.html
 * @param {import('../index.js').AeoPageRecord} input.page
 * @param {import('../index.js').ResolvedAstroAeoConfig} input.config
 * @param {{ siteUrl: string; base: string; trailingSlash: 'always'|'never'|'ignore' }} input.site
 * @param {boolean} [input.allowGlobal]
 * @param {boolean} [input.inspectAuthored]
 * @param {ReadonlyArray<{ name: string; item: string }> | null} [input.breadcrumbTrail]
 * @returns {{ html: string; page: import('../index.js').AeoPageRecord; graph: import('../schema.js').AeoGraph | null; authoredGraph: import('../schema.js').AeoGraph | null; normalizedGraph: import('../schema.js').AeoGraph | null; canonicalUrl?: string; diagnostics: import('../index.js').Diagnostic[]; explicit: boolean }}
 */
export function enrichHtmlHead({
  html,
  page,
  config,
  site,
  allowGlobal = true,
  inspectAuthored = false,
  breadcrumbTrail = null,
}) {
  const diagnostics = [];
  const markers = readHeadMarkers(html);
  const explicit = markers.values.length > 0;
  let output = removeHtmlElements(html, 'script', ({ source }) =>
    hasBooleanAttribute(source, HEAD_MARKER_ATTRIBUTE) || hasBooleanAttribute(source, MANAGED_GRAPH_ATTRIBUTE),
  );
  if (markers.invalid) {
    diagnostics.push(diagnostic('aeo-head-invalid', 'error', 'AeoHead contained an invalid marker and was omitted.', page.pathname));
  }
  if (markers.values.length > 1) {
    diagnostics.push(diagnostic('aeo-head-multiple', 'error', 'Only one AeoHead may own a page; the first valid instance was used.', page.pathname));
  }
  const head = markers.values[0];
  const hasHead = hasHtmlHead(output);
  if (!hasHead) {
    if (explicit || (allowGlobal && config.schema.autoInject)) {
      diagnostics.push(diagnostic('managed-head-missing', 'warning', 'Managed metadata and graph output require a real <head> element.', page.pathname));
    }
    return { html: output, page, graph: null, authoredGraph: null, normalizedGraph: null, diagnostics, explicit };
  }

  const configured = page.metadata.canonicalSource === 'inferred'
    ? stableCanonical(page.canonicalUrl) ?? configuredCanonical(site, page.pathname)
    : configuredCanonical(site, page.pathname);
  const authored = authoredCanonical(output, configured ?? stableCanonical(site.siteUrl));
  diagnostics.push(...metadataDiagnostics(output, page.pathname));
  const explicitCanonical = head?.canonical === undefined
    ? undefined
    : stableCanonical(head.canonical, configured ?? stableCanonical(site.siteUrl));
  if (head?.canonical !== undefined && !explicitCanonical && (authored.canonical || configured)) {
    diagnostics.push(diagnostic('canonical-invalid', 'warning', 'AeoHead canonical must resolve to a stable public HTTP(S) URL.', page.pathname));
  }
  if (authored.conflict && !explicitCanonical && configured) {
    diagnostics.push(diagnostic('canonical-conflict', 'warning', 'Multiple authored canonical URLs conflict; the configured site canonical was used when available.', page.pathname));
  }
  const canonicalUrl = explicitCanonical ?? authored.canonical ?? configured;
  const effectivePage = effectiveHeadPage(page, head, canonicalUrl, {
    authored: Boolean(explicitCanonical || authored.canonical),
    inferred: Boolean(!explicitCanonical && !authored.canonical && configured),
  });

  if (head) output = applyExplicitMetadata(output, head, canonicalUrl, site, diagnostics, page.pathname);
  if (config.metadata.fillMissing) {
    output = fillMissingMetadata(output, head, effectivePage, canonicalUrl, config.metadata.defaults, site);
  }

  const globallyEligible = allowGlobal && config.schema.autoInject && page.directives.index;
  const graphRequested = explicit || globallyEligible;
  const corpusRequested = config.schema.corpus.enabled;
  if (!graphRequested && !corpusRequested && !inspectAuthored) {
    return { html: output, page: effectivePage, graph: null, authoredGraph: null, normalizedGraph: null, diagnostics, explicit, ...(canonicalUrl ? { canonicalUrl } : {}) };
  }
  if (!canonicalUrl) {
    diagnostics.push(diagnostic(
      'managed-graph-canonical-missing',
      'warning',
      'Astro-AEO skipped the managed graph because no stable canonical exists. Configure Astro site or pass AeoHead canonical.',
      page.pathname,
    ));
    return { html: output, page: effectivePage, graph: null, authoredGraph: null, normalizedGraph: null, diagnostics, explicit };
  }

  const validationSiteUrl = siteScopeUrl(site.siteUrl, site.base);
  const authoredGraph = inspectAuthoredJsonLd(output, page.pathname, {
    canonicalUrl,
    siteUrl: validationSiteUrl,
    severity: corpusRequested ? 'error' : 'warning',
  });
  diagnostics.push(...authoredGraph.diagnostics);
  if (!graphRequested && !corpusRequested) {
    return {
      html: output,
      page: effectivePage,
      graph: null,
      authoredGraph: authoredGraph.graph,
      normalizedGraph: authoredGraph.graph.entries.length > 0 ? authoredGraph.graph : null,
      canonicalUrl,
      diagnostics,
      explicit,
    };
  }
  const infer = head?.infer === false
    ? []
    : Array.isArray(head?.infer)
      ? head.infer.filter((/** @type {unknown} */ value) =>
          typeof value === 'string' && ['website', 'webpage', 'breadcrumbs'].includes(value))
      : config.schema.infer;
  const candidates = [
    ...graphInputs(head?.graph, { source: 'authored-head', pathname: page.pathname }),
    ...effectivePage.entities.map((entity) => ({
      entity,
      provenance: { source: 'authored-head', pathname: effectivePage.pathname },
    })),
    ...(graphRequested
      ? inferredEntities({
          page: effectivePage,
          html: output,
          config,
          site,
          canonicalUrl,
          infer,
          breadcrumbTrail,
        })
      : []),
  ];
  if (graphRequested && config.site.organization && typeof config.site.organization === 'object') {
    candidates.push({
      entity: withDefaultOrganizationId(config.site.organization, site),
      provenance: { source: 'configuration', pathname: effectivePage.pathname },
    });
  }
  const managed = candidates
    .map((entry) => {
      const entity = entry.entity;
      const byId = typeof entity?.['@id'] === 'string'
        ? /** @type {Map<string, Record<string, any>>} */ (authoredGraph.byId)
          .get(normalizedCandidateId(entity['@id'], canonicalUrl))
        : undefined;
      const semanticPrior = isInferenceEntry(entry)
        ? matchingAuthoredEntity(entity, authoredGraph.graph.entries.map((item) => item.entity), canonicalUrl, site.siteUrl)
        : undefined;
      const prior = byId ?? semanticPrior;
      const candidate = semanticPrior && typeof semanticPrior['@id'] === 'string'
        ? { ...entity, '@id': semanticPrior['@id'] }
        : entity;
      const delta = subtractAuthoredFacts(candidate, prior);
      return delta ? { ...entry, entity: delta } : null;
    })
    .filter(Boolean);

  let graph = null;
  /** @type {import('../schema.js').AeoGraph | null} */
  let normalizedGraph = authoredGraph.graph;
  try {
    const managedResult = validateGraph(
      /** @type {import('../schema.js').GraphInput} */ (/** @type {unknown} */ (managed)),
      {
        documentCanonical: canonicalUrl,
        siteUrl: validationSiteUrl,
        strictReferences: false,
      },
    );
    if (!managedResult.valid) {
      diagnostics.push(...graphFindings(managedResult.findings, page.pathname));
      return { html: output, page: effectivePage, graph: null, authoredGraph: authoredGraph.graph, normalizedGraph, canonicalUrl, diagnostics, explicit };
    }
    const combinedResult = validateGraph([
      ...authoredGraph.graph.entries,
      ...managedResult.graph.entries,
    ], {
      conflictPolicy: 'first',
      documentCanonical: canonicalUrl,
      siteUrl: validationSiteUrl,
      strictReferences: config.schema.strictReferences,
    });
    diagnostics.push(...graphFindings(combinedResult.findings, page.pathname));
    if (!combinedResult.valid) {
      return { html: output, page: effectivePage, graph: null, authoredGraph: authoredGraph.graph, normalizedGraph, canonicalUrl, diagnostics, explicit };
    }
    const managedGraph = managedResult.graph;
    normalizedGraph = combinedResult.graph.entries.length > 0 ? combinedResult.graph : null;
    if (graphRequested) {
      const serialized = serializeGraph(managedGraph, {
        documentCanonical: canonicalUrl,
        siteUrl: validationSiteUrl,
        // The validated combined graph above owns reference integrity. The
        // managed delta can reference unchanged authored nodes on this page.
        strictReferences: false,
      });
      const script = `<script type="application/ld+json" ${MANAGED_GRAPH_ATTRIBUTE}>${serialized}</script>`;
      output = insertBeforeHeadEnd(output, script);
      graph = managedGraph;
    }
  } catch {
    diagnostics.push(diagnostic('managed-graph-invalid', 'error', 'The managed graph failed validation and was omitted.', page.pathname));
    graph = null;
    normalizedGraph = authoredGraph.graph;
  }

  return {
    html: output,
    page: effectivePage,
    graph,
    authoredGraph: authoredGraph.graph,
    normalizedGraph,
    canonicalUrl,
    diagnostics,
    explicit,
  };
}

/** @param {string} value @param {string} canonical */
function normalizedCandidateId(value, canonical) {
  try {
    return createId(value, canonical);
  } catch {
    return value;
  }
}

/** @param {string} html */
export function stripAeoHeadMarkers(html) {
  return removeHtmlElements(html, 'script', ({ source }) => hasBooleanAttribute(source, HEAD_MARKER_ATTRIBUTE));
}

/**
 * Keep the shared page record aligned with the explicit metadata that owns the
 * rendered head. Flat 1.x mirrors remain synchronized with their nested facts.
 * @param {import('../index.js').AeoPageRecord} page
 * @param {Record<string, any> | undefined} head
 * @param {string | undefined} canonicalUrl
 * @param {{ authored: boolean; inferred: boolean }} source
 */
function effectiveHeadPage(page, head, canonicalUrl, source) {
  const metadata = { ...page.metadata };
  if (typeof head?.title === 'string') metadata.title = head.title;
  if (typeof head?.description === 'string') metadata.description = head.description;
  if (canonicalUrl && source.authored) metadata.canonicalSource = 'authored';
  else if (canonicalUrl && source.inferred) metadata.canonicalSource = 'inferred';
  return {
    ...page,
    ...(canonicalUrl ? { canonicalUrl, url: canonicalUrl } : {}),
    ...(typeof head?.locale === 'string' ? { language: head.locale } : {}),
    metadata,
    title: metadata.title,
    description: metadata.description ?? '',
  };
}

/** @param {string} html */
function readHeadMarkers(html) {
  const values = [];
  let invalid = false;
  const markers = htmlElementRanges(html, 'script').filter(({ source }) =>
    hasBooleanAttribute(source, HEAD_MARKER_ATTRIBUTE),
  );
  for (const marker of markers) {
    try {
      const value = JSON.parse(marker.content);
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid = true;
      else values.push(value);
    } catch {
      invalid = true;
    }
  }
  return { values, invalid };
}

/**
 * @param {string} html
 * @param {Record<string, any>} head
 * @param {string | undefined} canonical
 * @param {{ siteUrl: string }} site
 * @param {import('../index.js').Diagnostic[]} diagnostics
 * @param {string} pathname
 */
function applyExplicitMetadata(html, head, canonical, site, diagnostics, pathname) {
  let output = html;
  const tags = [];
  if (typeof head.title === 'string') {
    output = removeElements(output, 'title', () => true);
    tags.push(`<title>${escapeText(head.title)}</title>`);
  }
  if (typeof head.description === 'string') {
    output = removeVoidTags(output, 'meta', (tag) => attr(tag, 'name')?.toLowerCase() === 'description');
    tags.push(meta('name', 'description', head.description));
  }
  if (head.canonical !== undefined && canonical) {
    output = removeVoidTags(output, 'link', (tag) => hasRel(tag, 'canonical'));
    tags.push(link({ rel: 'canonical', href: canonical }));
  }
  if (head.robots !== undefined) {
    output = removeVoidTags(output, 'meta', (tag) => attr(tag, 'name')?.toLowerCase() === 'robots');
    const value = Array.isArray(head.robots) ? head.robots.join(', ') : head.robots;
    if (typeof value === 'string') tags.push(meta('name', 'robots', value));
  }
  if (head.openGraph && typeof head.openGraph === 'object') {
    output = removeVoidTags(output, 'meta', (tag) => Boolean(attr(tag, 'property')?.toLowerCase().startsWith('og:')));
    tags.push(...openGraphTags(head, canonical, site));
  }
  if (head.twitter && typeof head.twitter === 'object') {
    output = removeVoidTags(output, 'meta', (tag) => Boolean(attr(tag, 'name')?.toLowerCase().startsWith('twitter:')));
    tags.push(...twitterTags(head, canonical, site));
  }
  if (Array.isArray(head.hreflang)) {
    output = removeVoidTags(output, 'link', (tag) => Boolean(hasRel(tag, 'alternate') && attr(tag, 'hreflang') !== undefined));
    for (const item of head.hreflang) {
      const href = resolveUrl(item?.href, canonical, site.siteUrl);
      if (href && typeof item?.lang === 'string' && item.lang) tags.push(link({ rel: 'alternate', hreflang: item.lang, href }));
    }
  }
  if (Array.isArray(head.feeds)) {
    output = removeVoidTags(output, 'link', (tag) => Boolean(hasRel(tag, 'alternate') && /(?:rss|atom|feed\+json)/i.test(attr(tag, 'type') ?? '')));
    for (const feed of head.feeds) {
      const href = resolveUrl(feed?.href, canonical, site.siteUrl);
      if (href && typeof feed?.type === 'string') tags.push(link({ rel: 'alternate', type: feed.type, href, ...(feed.title ? { title: feed.title } : {}) }));
    }
  }
  if (head.pagination && typeof head.pagination === 'object') {
    output = removeVoidTags(output, 'link', (tag) => hasRel(tag, 'prev') || hasRel(tag, 'next'));
    const previous = resolveUrl(head.pagination.previous, canonical, site.siteUrl);
    const next = resolveUrl(head.pagination.next, canonical, site.siteUrl);
    if (previous) tags.push(link({ rel: 'prev', href: previous }));
    if (next) tags.push(link({ rel: 'next', href: next }));
  }
  if (head.markdownAlternate !== undefined && head.markdownAlternate !== null) {
    output = removeVoidTags(output, 'link', (tag) => hasRel(tag, 'alternate') && attr(tag, 'type')?.toLowerCase() === 'text/markdown');
    const source = typeof head.markdownAlternate === 'object' &&
      !(head.markdownAlternate instanceof URL)
      ? head.markdownAlternate
      : { href: head.markdownAlternate };
    const href = resolveUrl(source.href, canonical, site.siteUrl);
    if (href) tags.push(link({ rel: 'alternate', type: 'text/markdown', href, ...(source.title ? { title: source.title } : {}) }));
  }
  if (head.themeColor !== undefined) {
    output = removeVoidTags(output, 'meta', (tag) => attr(tag, 'name')?.toLowerCase() === 'theme-color');
    const colors = Array.isArray(head.themeColor) ? head.themeColor : [head.themeColor];
    for (const color of colors) {
      const entry = typeof color === 'string' ? { color } : color;
      if (entry && typeof entry.color === 'string') tags.push(`<meta name="theme-color" content="${escapeAttribute(entry.color)}"${entry.media ? ` media="${escapeAttribute(entry.media)}"` : ''}>`);
    }
  }
  const authoredPeople = head.authors ?? head.author;
  if (authoredPeople !== undefined) {
    output = removeVoidTags(output, 'meta', (tag) => attr(tag, 'name')?.toLowerCase() === 'author');
    output = removeVoidTags(output, 'link', (tag) => hasRel(tag, 'author'));
    const authors = Array.isArray(authoredPeople) ? authoredPeople : [authoredPeople];
    for (const author of authors) {
      const value = typeof author === 'string' ? { name: author } : author;
      if (!value || typeof value.name !== 'string') continue;
      tags.push(meta('name', 'author', value.name));
      const url = resolveUrl(value.url, canonical, site.siteUrl);
      if (url) tags.push(link({ rel: 'author', href: url }));
    }
  }
  if (head.locale !== undefined) {
    if (typeof head.locale !== 'string') {
      diagnostics.push(diagnostic('aeo-head-locale-invalid', 'warning', 'AeoHead locale must be a string.', pathname));
    } else if (!head.openGraph) {
      output = removeVoidTags(output, 'meta', (tag) => attr(tag, 'property')?.toLowerCase() === 'og:locale');
      tags.push(meta('property', 'og:locale', head.locale));
    }
  }
  return insertBeforeHeadEnd(output, tags.join(''));
}

/**
 * @param {string} html
 * @param {Record<string, any> | undefined} head
 * @param {import('../index.js').AeoPageRecord} page
 * @param {string | undefined} canonical
 * @param {import('../index.js').MetadataDefaults} defaults
 * @param {{ siteUrl: string }} site
 */
function fillMissingMetadata(html, head, page, canonical, defaults, site) {
  let output = html;
  const tags = [];
  if (typeof defaults.title === 'string' && headTagSources(output, 'title').length === 0) {
    tags.push(`<title>${escapeText(defaults.title)}</title>`);
  }
  if (typeof defaults.description === 'string' && !hasMeta(output, 'name', 'description')) {
    tags.push(meta('name', 'description', defaults.description));
  }
  if (canonical && !headTagSources(output, 'link').some((tag) => hasRel(tag, 'canonical'))) {
    tags.push(link({ rel: 'canonical', href: canonical }));
  }
  /** @type {Record<string, any>} */
  const configuredOpenGraph = isRecord(defaults.openGraph) ? defaults.openGraph : {};
  const og = {
    title: head?.title ?? configuredOpenGraph.title ?? page.metadata.title ?? defaults.title,
    description: head?.description ?? configuredOpenGraph.description ?? page.metadata.description ?? defaults.description,
    url: resolveUrl(configuredOpenGraph.url, canonical, site.siteUrl) ?? canonical,
  };
  for (const [name, value] of Object.entries(og)) {
    if (!value || hasMetaOrPending(output, tags, 'property', `og:${name}`)) continue;
    tags.push(meta('property', `og:${name}`, String(value)));
  }
  if (defaults.robots && !hasMeta(output, 'name', 'robots')) {
    tags.push(meta('name', 'robots', Array.isArray(defaults.robots) ? defaults.robots.join(', ') : defaults.robots));
  }
  if (isRecord(defaults.openGraph)) {
    const generated = openGraphTags({
      openGraph: defaults.openGraph,
      title: defaults.title,
      description: defaults.description,
      locale: defaults.locale,
    }, canonical, site);
    for (const tag of generated) {
      const name = attr(tag, 'property');
      if (name && !hasMetaOrPending(output, tags, 'property', name)) tags.push(tag);
    }
  }
  if (isRecord(defaults.twitter)) {
    const generated = twitterTags({
      twitter: defaults.twitter,
      openGraph: defaults.openGraph,
      title: defaults.title,
      description: defaults.description,
    }, canonical, site);
    for (const tag of generated) {
      const name = attr(tag, 'name');
      if (name && !hasMetaOrPending(output, tags, 'name', name)) tags.push(tag);
    }
  }
  if (defaults.locale && !hasMetaOrPending(output, tags, 'property', 'og:locale')) {
    tags.push(meta('property', 'og:locale', defaults.locale));
  }
  if (defaults.themeColor !== undefined && !hasMeta(output, 'name', 'theme-color')) {
    const colors = Array.isArray(defaults.themeColor) ? defaults.themeColor : [defaults.themeColor];
    for (const color of colors) {
      /** @type {unknown} */
      const value = typeof color === 'string' ? { color } : color;
      if (isRecord(value) && typeof value.color === 'string') {
        tags.push(`<meta name="theme-color" content="${escapeAttribute(value.color)}"${typeof value.media === 'string' ? ` media="${escapeAttribute(value.media)}"` : ''}>`);
      }
    }
  }
  if (defaults.author !== undefined && !hasMeta(output, 'name', 'author')) {
    const authors = Array.isArray(defaults.author) ? defaults.author : [defaults.author];
    for (const author of authors) {
      /** @type {unknown} */
      const value = typeof author === 'string' ? { name: author } : author;
      if (!isRecord(value) || typeof value.name !== 'string') continue;
      tags.push(meta('name', 'author', value.name));
      const url = resolveUrl(value.url, canonical, site.siteUrl);
      if (url && !headTagSources(output, 'link').some((tag) => hasRel(tag, 'author'))) {
        tags.push(link({ rel: 'author', href: url }));
      }
    }
  }
  return insertBeforeHeadEnd(output, tags.join(''));
}

/** @param {Record<string, any>} head @param {string | undefined} canonical @param {{ siteUrl: string }} site */
function openGraphTags(head, canonical, site) {
  const graph = head.openGraph;
  const values = [
    ['og:type', graph.type],
    ['og:title', graph.title ?? head.title],
    ['og:description', graph.description ?? head.description],
    ['og:url', resolveUrl(graph.url, canonical, site.siteUrl) ?? canonical],
    ['og:site_name', graph.siteName],
    ['og:locale', head.locale],
  ];
  const tags = values.filter(([, value]) => typeof value === 'string').map(([name, value]) => meta('property', name, value));
  const images = graph.images === undefined ? [] : Array.isArray(graph.images) ? graph.images : [graph.images];
  for (const image of images) {
    const entry = typeof image === 'string' || image instanceof URL ? { url: image } : image;
    const url = resolveUrl(entry?.url, canonical, site.siteUrl);
    if (!url) continue;
    tags.push(meta('property', 'og:image', url));
    for (const [suffix, value] of [['secure_url', entry.secureUrl], ['type', entry.type], ['width', entry.width], ['height', entry.height], ['alt', entry.alt]]) {
      const resolved = suffix === 'secure_url' ? resolveUrl(value, canonical, site.siteUrl) : value;
      if (resolved !== undefined) tags.push(meta('property', `og:image:${suffix}`, String(resolved)));
    }
  }
  for (const locale of Array.isArray(graph.localeAlternates) ? graph.localeAlternates : []) {
    if (typeof locale === 'string') tags.push(meta('property', 'og:locale:alternate', locale));
  }
  return tags;
}

/** @param {Record<string, any>} head @param {string | undefined} canonical @param {{ siteUrl: string }} site */
function twitterTags(head, canonical, site) {
  const twitter = head.twitter;
  const firstImage = Array.isArray(head.openGraph?.images) ? head.openGraph.images[0] : head.openGraph?.images;
  const inheritedImage = typeof firstImage === 'object' && !(firstImage instanceof URL) ? firstImage?.url : firstImage;
  const values = {
    card: twitter.card,
    site: twitter.site,
    'site:id': twitter.siteId,
    creator: twitter.creator,
    'creator:id': twitter.creatorId,
    title: twitter.title ?? head.openGraph?.title ?? head.title,
    description: twitter.description ?? head.openGraph?.description ?? head.description,
    image: resolveUrl(twitter.image ?? inheritedImage, canonical, site.siteUrl),
    'image:alt': twitter.imageAlt,
  };
  const tags = Object.entries(values)
    .filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => meta('name', `twitter:${name}`, value));
  if (twitter.player && typeof twitter.player === 'object') {
    const playerUrl = resolveUrl(twitter.player.url, canonical, site.siteUrl);
    const streamUrl = resolveUrl(twitter.player.stream, canonical, site.siteUrl);
    if (playerUrl) tags.push(meta('name', 'twitter:player', playerUrl));
    if (Number.isFinite(twitter.player.width)) tags.push(meta('name', 'twitter:player:width', String(twitter.player.width)));
    if (Number.isFinite(twitter.player.height)) tags.push(meta('name', 'twitter:player:height', String(twitter.player.height)));
    if (streamUrl) tags.push(meta('name', 'twitter:player:stream', streamUrl));
  }
  for (const app of Array.isArray(twitter.apps) ? twitter.apps : []) {
    if (!app || !['iphone', 'ipad', 'googleplay'].includes(app.platform)) continue;
    if (typeof app.name === 'string') tags.push(meta('name', `twitter:app:name:${app.platform}`, app.name));
    if (typeof app.id === 'string') tags.push(meta('name', `twitter:app:id:${app.platform}`, app.id));
    const url = resolveUrl(app.url, canonical, site.siteUrl);
    if (url) tags.push(meta('name', `twitter:app:url:${app.platform}`, url));
  }
  return tags;
}

/** @param {unknown} input @returns {Record<string, any>[]} */
function graphEntities(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(graphEntities);
  if (typeof input !== 'object') return [];
  if (Array.isArray(/** @type {any} */ (input).entries)) {
    return /** @type {any} */ (input).entries.map((/** @type {any} */ entry) => entry.entity).filter(Boolean);
  }
  if (Array.isArray(/** @type {any} */ (input)['@graph'])) return /** @type {any} */ (input)['@graph'];
  if (/** @type {any} */ (input).entity) return [/** @type {any} */ (input).entity];
  return [input];
}

/**
 * Preserve public graph roles and provenance while assigning authored-head
 * provenance to raw entities supplied directly through AeoHead.
 * @param {unknown} input
 * @param {Record<string, any>} provenance
 * @returns {{ entity: Record<string, any>; roles?: unknown; provenance?: unknown }[]}
 */
function graphInputs(input, provenance) {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap((value) => graphInputs(value, provenance));
  if (typeof input !== 'object') return [];
  if (Array.isArray(/** @type {any} */ (input).entries)) {
    const entries = /** @type {any[]} */ (/** @type {any} */ (input).entries);
    return entries.flatMap((entry) =>
      entry?.entity && typeof entry.entity === 'object'
        ? [{
            entity: entry.entity,
            ...(entry.roles === undefined ? {} : { roles: entry.roles }),
            provenance: entry.provenance ?? provenance,
          }]
        : [],
    );
  }
  if (Array.isArray(/** @type {any} */ (input)['@graph'])) {
    const entities = /** @type {any[]} */ (/** @type {any} */ (input)['@graph']);
    return entities.flatMap((entity) =>
      entity && typeof entity === 'object' && !Array.isArray(entity)
        ? [{ entity, provenance }]
        : [],
    );
  }
  if (/** @type {any} */ (input).entity) {
    const entry = /** @type {any} */ (input);
    return [{
      entity: entry.entity,
      ...(entry.roles === undefined ? {} : { roles: entry.roles }),
      provenance: entry.provenance ?? provenance,
    }];
  }
  return [{ entity: /** @type {Record<string, any>} */ (input), provenance }];
}

/**
 * @param {object} input
 * @param {import('../index.js').AeoPageRecord} input.page
 * @param {string} input.html
 * @param {import('../index.js').ResolvedAstroAeoConfig} input.config
 * @param {{ siteUrl: string }} input.site
 * @param {string} input.canonicalUrl
 * @param {readonly string[]} input.infer
 * @param {ReadonlyArray<{ name: string; item: string }> | null} input.breadcrumbTrail
 */
function inferredEntities({ page, html, config, site, canonicalUrl, infer, breadcrumbTrail }) {
  const entities = [];
  const siteUrl = stableCanonical(site.siteUrl);
  if (siteUrl && infer.includes('website')) {
    entities.push({
      entity: {
        '@id': `${siteUrl.replace(/\/$/, '')}/#website`,
        '@type': 'WebSite',
        url: siteUrl,
        ...(config.site.name ? { name: config.site.name } : {}),
        ...(page.language ? { inLanguage: page.language } : {}),
      },
      roles: 'site',
      provenance: { source: 'inference', pathname: page.pathname },
    });
  }
  if (infer.includes('webpage')) {
    entities.push({
      entity: {
        '@id': `${canonicalUrl}#webpage`,
        '@type': 'WebPage',
        url: canonicalUrl,
        name: page.metadata.title,
        ...(page.metadata.description ? { description: page.metadata.description } : {}),
        ...(page.language ? { inLanguage: page.language } : {}),
      },
      roles: 'page',
      provenance: { source: 'inference', pathname: page.pathname },
    });
  }
  if (infer.includes('breadcrumbs')) {
    const breadcrumbs = breadcrumbEntity(html, canonicalUrl, breadcrumbTrail);
    if (breadcrumbs) {
      entities.push({
        entity: breadcrumbs,
        roles: 'breadcrumbs',
        provenance: { source: 'inference', pathname: page.pathname },
      });
    }
  }
  return entities;
}

/**
 * Linked markup is the stronger page-local evidence and always wins. A catalog
 * trail is considered only when that markup does not describe a complete
 * linked path to the current document.
 * @param {string} html
 * @param {string} canonical
 * @param {ReadonlyArray<{ name: string; item: string }> | null} catalogTrail
 */
function breadcrumbEntity(html, canonical, catalogTrail) {
  const document = parseDocument(html);
  const container = [...document.querySelectorAll('nav,[role="navigation"]')].find((element) =>
    /breadcrumb/i.test(element.getAttribute('aria-label') ?? element.getAttribute('class') ?? ''),
  );
  const links = container ? [...container.querySelectorAll('a[href]')]
    .map((linkElement) => ({
      name: (linkElement.textContent ?? '').replace(/\s+/g, ' ').trim(),
      item: stableCanonical(linkElement.getAttribute('href'), canonical),
    }))
    .filter((item) => item.name && item.item) : [];
  // A linked trail is complete only when it reaches the current document.
  // Unlinked current-page text and arbitrary ancestor links are not enough
  // evidence to manufacture the missing breadcrumb relationship.
  const finalItem = links.at(-1)?.item;
  if (links.length >= 2 && finalItem && sameDocument(finalItem, canonical)) {
    return breadcrumbList(canonical, /** @type {{ name: string; item: string }[]} */ (links));
  }

  /** @type {{ name: string; item: string }[]} */
  const catalog = [];
  for (const item of catalogTrail ?? []) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const canonicalItem = stableCanonical(item.item);
    if (name && canonicalItem) catalog.push({ name, item: canonicalItem });
  }
  const catalogCurrent = catalog.at(-1)?.item;
  if (catalog.length < 2 || !catalogCurrent || !sameDocument(catalogCurrent, canonical)) return null;
  catalog[catalog.length - 1] = { name: catalog[catalog.length - 1].name, item: canonical };
  return breadcrumbList(canonical, catalog);
}

/** @param {string} canonical @param {{ name: string; item: string }[]} items */
function breadcrumbList(canonical, items) {
  return {
    '@id': `${canonical}#breadcrumbs`,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name, item: item.item,
    })),
  };
}

/**
 * Parse authored JSON-LD without resolving or fetching contexts. Each valid
 * entity is normalized independently so one invalid third-party node cannot
 * discard the remaining authored graph.
 *
 * @param {string} html
 * @param {string} pathname
 * @param {{ canonicalUrl: string; siteUrl?: string; severity: 'warning'|'error' }} options
 */
function inspectAuthoredJsonLd(html, pathname, options) {
  const entries = [];
  const diagnostics = [];
  const scripts = htmlElementRanges(html, 'script').filter(({ source }) =>
    attr(source, 'type')?.toLowerCase() === 'application/ld+json',
  );
  for (const script of scripts) {
    try {
      const entities = graphEntities(JSON.parse(script.content));
      for (const entity of entities) {
        try {
          if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw new TypeError('Invalid JSON-LD entity');
          const withoutContext = Object.fromEntries(
            Object.entries(entity).filter(([key]) => key !== '@context'),
          );
          const result = validateGraph([{
            entity: /** @type {any} */ (withoutContext),
            provenance: { source: 'authored-jsonld', pathname },
          }], {
            documentCanonical: options.canonicalUrl,
            siteUrl: options.siteUrl,
            strictReferences: false,
          });
          if (!result.valid) throw new TypeError('Invalid JSON-LD entity');
          entries.push(...result.graph.entries);
        } catch {
          diagnostics.push(diagnostic(
            'authored-jsonld-invalid',
            options.severity,
            'Invalid authored JSON-LD was omitted from Astro-AEO graph validation.',
            pathname,
          ));
        }
      }
    } catch {
      diagnostics.push(diagnostic(
        'authored-jsonld-malformed',
        options.severity,
        'Malformed authored JSON-LD was omitted from Astro-AEO graph validation.',
        pathname,
      ));
    }
  }
  const graph = createGraph(entries, { conflictPolicy: 'first' });
  const byId = new Map(graph.entries.flatMap(({ entity }) =>
    typeof entity['@id'] === 'string' ? [[entity['@id'], entity]] : [],
  ));
  return { graph, byId, diagnostics };
}

/** @param {any} entity @param {Record<string, any> | undefined} prior */
function subtractAuthoredFacts(entity, prior) {
  if (!entity || typeof entity !== 'object') return null;
  if (!prior) return entity;
  /** @type {Record<string, any>} */
  const output = {};
  for (const [key, value] of Object.entries(entity)) {
    // A managed delta still has to be a valid Schema.org node. Keep identity
    // and type while authored scripts continue to own every factual property.
    if (key === '@id' || key === '@type') output[key] = value;
    else if (!Object.prototype.hasOwnProperty.call(prior, key)) output[key] = value;
  }
  return Object.keys(output).some((key) => key !== '@id' && key !== '@type') ? output : null;
}

/** @param {{ provenance?: unknown }} entry */
function isInferenceEntry(entry) {
  const values = Array.isArray(entry.provenance) ? entry.provenance : [entry.provenance];
  return values.some((value) => value && typeof value === 'object' && value.source === 'inference');
}

/**
 * Match only strong same-page/site evidence. Type alone is never enough for a
 * WebPage or WebSite, and URL segments are never promoted into breadcrumb facts.
 * @param {Record<string, any>} inferred
 * @param {Record<string, any>[]} authored
 * @param {string} canonical
 * @param {string} siteUrl
 */
function matchingAuthoredEntity(inferred, authored, canonical, siteUrl) {
  const type = Array.isArray(inferred['@type']) ? inferred['@type'][0] : inferred['@type'];
  if (type === 'BreadcrumbList') {
    return authored.find((entity) => entityTypes(entity).includes('BreadcrumbList'));
  }
  if (type !== 'WebPage' && type !== 'WebSite') return undefined;
  const expected = type === 'WebPage' ? canonical : stableCanonical(siteUrl);
  if (!expected) return undefined;
  return authored.find((entity) => {
    if (!entityTypes(entity).includes(type)) return false;
    const authoredUrls = Array.isArray(entity.url) ? entity.url : [entity.url];
    if (authoredUrls.some((value) => {
      const authoredUrl = stableCanonical(value, expected);
      return Boolean(authoredUrl && sameDocument(authoredUrl, expected));
    })) return true;
    const authoredId = stableCanonical(entity['@id'], expected);
    return Boolean(authoredId && sameDocument(authoredId, expected));
  });
}

/** @param {Record<string, any>} entity */
function entityTypes(entity) {
  const values = Array.isArray(entity['@type']) ? entity['@type'] : [entity['@type']];
  return values.filter((value) => typeof value === 'string');
}

/** @param {string} left @param {string} right */
function sameDocument(left, right) {
  const a = new URL(left);
  const b = new URL(right);
  a.hash = '';
  b.hash = '';
  return a.href.replace(/\/$/, '') === b.href.replace(/\/$/, '');
}

/**
 * Preserve actionable graph codes and structural pointers without exposing
 * entity IDs, values, plugin payloads, or thrown objects.
 * @param {readonly import('../schema.js').GraphFinding[]} findings
 * @param {string} pathname
 * @returns {import('../index.js').Diagnostic[]}
 */
function graphFindings(findings, pathname) {
  return findings.map((finding) => ({
    version: /** @type {const} */ (1),
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    pathname,
    ...(finding.pointer ? { details: { pointer: finding.pointer } } : {}),
  }));
}

/**
 * Diagnose ambiguous singleton metadata without copying authored values into
 * findings. Multi-valued families such as images, authors, and alternates are
 * deliberately excluded.
 * @param {string} html
 * @param {string} pathname
 * @returns {import('../index.js').Diagnostic[]}
 */
function metadataDiagnostics(html, pathname) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  const add = (/** @type {string} */ key, /** @type {string | undefined} */ value) => {
    const values = groups.get(key) ?? [];
    values.push(value ?? '');
    groups.set(key, values);
  };
  for (const _title of headTagSources(html, 'title')) add('title', undefined);
  for (const tag of headTagSources(html, 'link')) {
    if (hasRel(tag, 'canonical')) add('canonical', attr(tag, 'href'));
  }
  for (const tag of headTagSources(html, 'meta')) {
    const name = attr(tag, 'name')?.toLowerCase();
    const property = attr(tag, 'property')?.toLowerCase();
    const key = property ? `property:${property}` : name ? `name:${name}` : undefined;
    if (!key || key === 'name:author' || key.startsWith('property:og:image') || key === 'property:og:locale:alternate') {
      continue;
    }
    add(key, attr(tag, 'content'));
  }
  return [...groups.entries()].flatMap(([key, values]) => {
    if (values.length < 2) return [];
    const conflict = new Set(values).size > 1;
    return [diagnostic(
      conflict ? 'metadata-conflict' : 'metadata-duplicate',
      'warning',
      conflict
        ? `Conflicting ${key} metadata was found; keep one authored value or let AeoHead own it.`
        : `Duplicate ${key} metadata was found; keep only one authored value.`,
      pathname,
    )];
  });
}

/** @param {any} organization @param {{ siteUrl: string }} site */
function withDefaultOrganizationId(organization, site) {
  if (organization['@id']) return organization;
  const stableSite = stableCanonical(site.siteUrl);
  return stableSite ? { ...organization, '@id': `${stableSite.replace(/\/$/, '')}/#organization` } : organization;
}

/** @param {string} html @param {string} tag @param {(tag: string) => boolean} predicate */
function removeVoidTags(html, tag, predicate) {
  return removeHeadTags(html, tag, predicate);
}

/** @param {string} html @param {string} tag @param {(tag: string) => boolean} predicate */
function removeElements(html, tag, predicate) {
  return removeHeadTags(html, tag, predicate, true);
}

/** @param {string} html @param {string} addition */
function insertBeforeHeadEnd(html, addition) {
  return insertIntoHead(html, addition);
}

/** @param {unknown} value @param {string | undefined} canonical @param {string} site */
function resolveUrl(value, canonical, site) {
  return stableCanonical(value, canonical ?? stableCanonical(site));
}

/** @param {string} tag @param {string} relation */
function hasRel(tag, relation) {
  return (attr(tag, 'rel') ?? '').split(/\s+/).some((token) => token.toLowerCase() === relation);
}

/** @param {string} html @param {'name'|'property'} attribute @param {string} value */
function hasMeta(html, attribute, value) {
  return headTagSources(html, 'meta').some((tag) =>
    attr(tag, attribute)?.toLowerCase() === value.toLowerCase(),
  );
}

/** @param {string} html @param {string[]} pending @param {'name'|'property'} attribute @param {string} value */
function hasMetaOrPending(html, pending, attribute, value) {
  return hasMeta(html, attribute, value) || pending.some((tag) =>
    /^<meta\b/i.test(tag) && attr(tag, attribute)?.toLowerCase() === value.toLowerCase(),
  );
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {string} tag @param {string} name */
function attr(tag, name) {
  return htmlTagAttribute(tag, name);
}

/** @param {string} tag @param {string} name */
function hasBooleanAttribute(tag, name) {
  return htmlTagAttribute(tag, name) !== undefined;
}

/** @param {'name'|'property'} attribute @param {string} name @param {string} content */
function meta(attribute, name, content) {
  return `<meta ${attribute}="${escapeAttribute(name)}" content="${escapeAttribute(content)}">`;
}

/** @param {Record<string, string>} attributes */
function link(attributes) {
  return `<link ${Object.entries(attributes).map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(' ')}>`;
}

/** @param {unknown} value */
function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {unknown} value */
function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} code @param {'info'|'warning'|'error'} severity @param {string} message @param {string} pathname */
function diagnostic(code, severity, message, pathname) {
  return { version: /** @type {const} */ (1), code, severity, message, pathname };
}

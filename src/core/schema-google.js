// @ts-check

const DOCUMENTATION = 'https://developers.google.com/search/docs/appearance/structured-data/';
const VERIFIED = '2026-09-30';

/** @param {string} document @param {string[]} required @param {string[]} recommended */
function profile(document, required, recommended) {
  return Object.freeze({ documentation: `${DOCUMENTATION}${document}`, verified: VERIFIED,
    required: Object.freeze(required), recommended: Object.freeze(recommended) });
}

export const GOOGLE_PROFILES = Object.freeze({
  Article: profile('article', [], ['headline', 'author', 'datePublished', 'dateModified', 'image']),
  BlogPosting: profile('article', [], ['headline', 'author', 'datePublished', 'dateModified', 'image']),
  NewsArticle: profile('article', [], ['headline', 'author', 'datePublished', 'dateModified', 'image']),
  Product: profile('product-snippet', ['name'], ['aggregateRating', 'offers', 'review']),
  SoftwareApplication: profile('software-app', ['name', 'offers.price'], ['applicationCategory', 'operatingSystem']),
  Review: profile('review-snippet', ['author', 'reviewRating.ratingValue'], ['datePublished']),
  Dataset: profile('dataset', ['name', 'description'], ['creator', 'license', 'identifier', 'keywords', 'distribution', 'sameAs', 'isAccessibleForFree', 'temporalCoverage', 'spatialCoverage', 'includedInDataCatalog', 'citation', 'alternateName', 'funder', 'hasPart', 'isPartOf', 'measurementTechnique', 'variableMeasured', 'version', 'url']),
  ProfilePage: profile('profile-page', ['mainEntity'], ['dateCreated', 'dateModified']),
  LocalBusiness: profile('local-business', ['name', 'address'], ['url', 'telephone', 'geo', 'openingHoursSpecification', 'priceRange', 'aggregateRating', 'review', 'department']),
});

const REVIEW_TYPES = new Set(['Book', 'Course', 'CreativeWorkSeason', 'CreativeWorkSeries', 'Episode',
  'Event', 'Game', 'HowTo', 'LocalBusiness', 'MediaObject', 'Movie', 'MusicPlaylist', 'MusicRecording',
  'Organization', 'Product', 'Recipe', 'SoftwareApplication']);
const APPLICATION_CATEGORIES = new Set(['Game', 'SocialNetworking', 'Travel', 'Shopping', 'Sports',
  'Lifestyle', 'Business', 'Design', 'Developer', 'Driver', 'Educational', 'Health', 'Finance',
  'Security', 'Browser', 'Communication', 'DesktopEnhancement', 'Entertainment', 'Multimedia',
  'Home', 'Utilities', 'Reference'].map((category) => `${category}Application`));

/** @param {unknown} value */
export function validSchemaDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
}

/** @typedef {{ ruleId: string; severity: 'warning' | 'info'; message: string; documentation?: string }} GoogleFinding */
/** @param {unknown} value @returns {Record<string, any> | undefined} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value) : undefined;
}
/** @param {unknown} value @returns {any[]} */
function values(value) { return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
/** @param {unknown} value */
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
/** @param {unknown} value */
function numeric(value) { return (typeof value === 'number' || text(value)) && Number.isFinite(Number(value)); }
/** @param {unknown} value */
function url(value) { return text(value) && /^https?:\/\/\S+$/i.test(/** @type {string} */ (value)); }
/** @param {unknown} value @returns {string[]} */
export function schemaTypes(value) { return values(record(value)?.['@type']).filter((type) => typeof type === 'string'); }

/** @param {unknown} input @returns {Record<string, any>[]} */
export function jsonLdEntities(input) {
  if (Array.isArray(input)) return input.flatMap(jsonLdEntities);
  const entity = record(input);
  if (!entity) return [];
  return Array.isArray(entity['@graph']) ? entity['@graph'].flatMap(jsonLdEntities) : [entity];
}

/**
 * @param {unknown} input
 * @param {{ documentUrl?: string; explicitType?: string }} [options]
 * @returns {GoogleFinding[]}
 */
export function checkGoogleSchema(input, options = {}) {
  /** @type {GoogleFinding[]} */
  const findings = [];
  /** @type {Map<string, Record<string, any>>} */
  const byId = new Map();
  const visited = new Set();
  const identity = (/** @type {string} */ id) => {
    try { return new URL(id, options.documentUrl).href; } catch { return id; }
  };
  const index = (/** @type {unknown} */ value) => {
    if (Array.isArray(value)) { value.forEach(index); return; }
    const entity = record(value);
    if (!entity || visited.has(entity)) return;
    visited.add(entity);
    if (text(entity['@id']) && Object.keys(entity).some((key) => key !== '@id' && key !== '@context')) {
      const key = identity(entity['@id']);
      if (!byId.has(key)) byId.set(key, entity);
    }
    Object.values(entity).forEach(index);
  };
  index(input);
  const resolve = (/** @type {unknown} */ value) => {
    const entity = record(value);
    return entity && text(entity['@id']) ? byId.get(identity(entity['@id'])) ?? entity : entity;
  };
  const read = (/** @type {Record<string, any>} */ entity, /** @type {string} */ path) => {
    let candidates = [entity];
    for (const part of path.split('.')) candidates = candidates.flatMap((candidate) => values(resolve(candidate)?.[part]));
    return candidates;
  };
  const present = (/** @type {unknown} */ value) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  const emit = (/** @type {string} */ type, /** @type {string} */ field, /** @type {boolean} */ required, /** @type {string} */ reason, /** @type {string} */ documentation) => {
    findings.push({ ruleId: required ? 'google-schema-required' : 'google-schema-recommended',
      severity: required ? 'warning' : 'info', message: `${type}: ${field} ${reason}. See ${documentation}`, documentation });
  };
  const valid = (/** @type {string} */ field, /** @type {unknown} */ value) => {
    if (field === 'applicationCategory') return typeof value === 'string' && APPLICATION_CATEGORIES.has(value);
    if (['name', 'headline', 'description', 'operatingSystem', 'telephone', 'priceRange'].includes(field.split('.').at(-1) ?? '')) return text(value);
    if (/(?:^|\.)(?:price|lowPrice|highPrice|offerCount|ratingCount|reviewCount|bestRating|worstRating)$/.test(field)) return numeric(value) && Number(value) >= 0;
    if (/(?:^|\.)ratingValue$/.test(field)) return numeric(value) || (text(value) && /^(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)$/.test(/** @type {string} */ (value)));
    if (field === 'priceCurrency') return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
    if (/^date/.test(field) || field === 'priceValidUntil') return validSchemaDate(value);
    if (['url', 'sameAs', 'license', 'image'].includes(field)) return url(value) || (field === 'image' && schemaTypes(resolve(value)).includes('ImageObject') && url(resolve(value)?.url ?? resolve(value)?.contentUrl));
    if (field === 'isAccessibleForFree') return typeof value === 'boolean';
    if (['author', 'creator', 'mainEntity'].includes(field)) return schemaTypes(resolve(value)).some((type) => type === 'Person' || type === 'Organization');
    if (field === 'address') return schemaTypes(resolve(value)).includes('PostalAddress');
    if (field === 'geo') return schemaTypes(resolve(value)).includes('GeoCoordinates');
    if (field === 'distribution') return schemaTypes(resolve(value)).includes('DataDownload');
    if (field === 'review') return schemaTypes(resolve(value)).includes('Review');
    if (field === 'aggregateRating') return schemaTypes(resolve(value)).includes('AggregateRating');
    if (field === 'offers') return schemaTypes(resolve(value)).some((type) => type === 'Offer' || type === 'AggregateOffer');
    if (field === 'openingHoursSpecification') return schemaTypes(resolve(value)).includes('OpeningHoursSpecification');
    return present(value);
  };
  const fields = (/** @type {Record<string, any>} */ entity, /** @type {string} */ type, /** @type {string[]} */ names, /** @type {boolean} */ required, /** @type {string} */ documentation) => {
    for (const field of names) {
      const found = read(entity, field);
      if (!found.length || !found.every((value) => valid(field, value))) emit(type, field, required, 'is missing or has an unsupported value shape', documentation);
    }
  };
  /** @type {Map<Record<string, any>, Record<string, any>>} */
  const reviewParents = new Map();
  for (const entity of visited) {
    for (const review of values(entity.review)) {
      const related = resolve(review);
      if (related && schemaTypes(entity).some((type) => REVIEW_TYPES.has(type))) reviewParents.set(related, entity);
    }
  }
  const checked = new Set();
  const check = (/** @type {Record<string, any>} */ entity, /** @type {Record<string, any> | undefined} */ parent) => {
    if (checked.has(entity)) return;
    checked.add(entity);
    const type = schemaTypes(entity).find((name) => Object.hasOwn(GOOGLE_PROFILES, name));
    if (type) {
      const current = GOOGLE_PROFILES[/** @type {keyof typeof GOOGLE_PROFILES} */ (type)];
      const documentation = current.documentation;
      fields(entity, type, [...current.required], true, documentation);
      fields(entity, type, [...current.recommended], false, documentation);
      if (['Article', 'BlogPosting', 'NewsArticle', 'Review'].includes(type)) {
        for (const author of read(entity, 'author')) {
          const resolved = resolve(author);
          if (!text(resolved?.name) || (type === 'Review' && resolved && resolved.name.length >= 100)) emit(type, 'author.name', type === 'Review', 'needs a named author (review names must be shorter than 100 characters)', documentation);
          if (type !== 'Review' && !values(resolved?.url ?? resolved?.sameAs).some(url)) emit(type, 'author.url', false, 'should identify the author with a URL or sameAs', documentation);
        }
      }
      if (type === 'Product' || type === 'SoftwareApplication') {
        const alternatives = type === 'Product' ? ['review', 'aggregateRating', 'offers'] : ['review', 'aggregateRating'];
        if (!alternatives.some((field) => values(entity[field]).some((value) => valid(field, value)))) emit(type, alternatives.join(' or '), true, 'needs at least one supported entity', documentation);
        if (values(entity.review).some((value) => !valid('review', value))) emit(type, 'review', true, 'must be a Review', documentation);
        for (const offer of read(entity, 'offers')) {
          const resolved = resolve(offer);
          const aggregate = schemaTypes(resolved).includes('AggregateOffer');
          if (!schemaTypes(resolved).includes(aggregate ? 'AggregateOffer' : 'Offer') || (type === 'SoftwareApplication' && aggregate)) emit(type, 'offers', true, 'must use a supported Offer type', documentation);
          if (resolved && aggregate) fields(resolved, type, ['lowPrice', 'priceCurrency'], true, documentation);
          if (resolved && !aggregate) {
            const priced = numeric(resolved.price) && Number(resolved.price) >= 0 || (type === 'Product' && read(resolved, 'priceSpecification.price').some((value) => numeric(value) && Number(value) >= 0));
            if (!priced) emit(type, 'offers.price', true, 'needs a non-negative price (Product also accepts priceSpecification.price)', documentation);
            const currency = resolved.priceCurrency ?? resolve(resolved.priceSpecification)?.priceCurrency;
            if ((type === 'Product' || Number(resolved.price) > 0) && (!values(currency).every((value) => valid('priceCurrency', value)) || !present(currency))) emit(type, 'offers.priceCurrency', false, 'should use a currency code', documentation);
          }
          if (resolved) fields(resolved, type, aggregate ? ['highPrice', 'offerCount'] : type === 'Product' ? ['availability', 'priceValidUntil'] : [], false, documentation);
        }
        for (const rating of read(entity, 'aggregateRating')) {
          const resolved = resolve(rating);
          if (!schemaTypes(resolved).includes('AggregateRating')) emit(type, 'aggregateRating', true, 'must be an AggregateRating', documentation);
          if (resolved) {
            fields(resolved, type, ['ratingValue'], true, documentation);
            if (![resolved.ratingCount, resolved.reviewCount].some((value) => numeric(value) && Number(value) > 0)) emit(type, 'aggregateRating.ratingCount or reviewCount', true, 'needs a positive count', documentation);
          }
        }
      }
      if (type === 'Review') {
        const reviewed = resolve(entity.itemReviewed) ?? parent ?? reviewParents.get(entity);
        if (!reviewed || !schemaTypes(reviewed).some((name) => REVIEW_TYPES.has(name))) emit(type, 'itemReviewed', true, 'must identify a documented supported reviewed type, directly or through its parent', documentation);
        else {
          fields(reviewed, type, ['name'], true, documentation);
          if (schemaTypes(reviewed).some((name) => name === 'Organization' || name === 'LocalBusiness')) emit(type, 'itemReviewed', false, 'self-serving business reviews do not qualify; field checks cannot establish review independence', documentation);
        }
        if (!schemaTypes(resolve(entity.reviewRating)).some((name) => name === 'Rating' || name === 'AggregateRating')) emit(type, 'reviewRating', true, 'must be a Rating', documentation);
      }
      if (type === 'Dataset' && text(entity.description) && (entity.description.length < 50 || entity.description.length > 5000)) emit(type, 'description', true, 'must contain between 50 and 5000 characters', documentation);
      if (type === 'ProfilePage') for (const main of read(entity, 'mainEntity')) {
        const resolved = resolve(main);
        if (!text(resolved?.name) && !text(resolved?.alternateName)) emit(type, 'mainEntity.name or alternateName', true, 'needs a name', documentation);
        if (resolved) fields(resolved, type, ['identifier', 'image', 'description', 'sameAs'], false, documentation);
      }
      if (type === 'LocalBusiness') for (const address of read(entity, 'address')) {
        const resolved = resolve(address);
        if (resolved) fields(resolved, type, ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'], false, documentation);
      }
      if (type === 'LocalBusiness') for (const geo of read(entity, 'geo')) {
        const resolved = resolve(geo);
        if (resolved && (!numeric(resolved.latitude) || Math.abs(Number(resolved.latitude)) > 90 || !numeric(resolved.longitude) || Math.abs(Number(resolved.longitude)) > 180)) emit(type, 'geo.latitude and longitude', true, 'need valid coordinates when geo is provided', documentation);
      }
    }
    for (const [field, nested] of Object.entries(entity)) {
      if (field === '@context') continue;
      for (const value of values(nested)) {
        const related = resolve(value);
        if (related) check(related, field === 'review' ? entity : undefined);
      }
    }
  };
  jsonLdEntities(input).forEach((entity) => check(entity, undefined));
  if (options.explicitType && !Object.hasOwn(GOOGLE_PROFILES, options.explicitType)) {
    findings.push({ ruleId: 'google-schema-unsupported', severity: 'info',
      message: `${options.explicitType}: no current documented Google profile is provided. Schema.org output is unchanged; checks do not guarantee rich results.` });
  }
  return findings;
}

/** @param {unknown} entity @param {'schema' | 'google'} eligibility @param {{ documentUrl?: string; explicitType?: string }} [options] */
export function warnGoogleSchema(entity, eligibility, options = {}) {
  if (eligibility !== 'google') return;
  for (const finding of checkGoogleSchema(entity, options)) console.warn(`[astro-aeo] ${finding.severity}: ${finding.message}`);
}

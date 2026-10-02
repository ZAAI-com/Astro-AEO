// @ts-check

const DOCUMENTATION = 'https://developers.google.com/search/docs/appearance/structured-data/';
const VERIFIED = '2026-09-30';
const CONFLICT_REASON = 'has conflicting definitions; checks retain the first value';

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

/** @typedef {{ ruleId: string; severity: 'warning' | 'info'; message: string; documentation?: string; evidence?: string }} GoogleFinding */
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
  /** @type {Map<Record<string, any>, string>} */
  const pointers = new Map();
  /** @type {Map<Record<string, any>, Set<string>>} */
  const conflicts = new Map();
  /** @type {Map<object, any>} */
  const clones = new Map();
  /** @type {Map<string, Record<string, any>[]>} */
  const definitions = new Map();
  const identity = (/** @type {string} */ id) => {
    try { return new URL(id, options.documentUrl).href; } catch { return id; }
  };
  const clone = (/** @type {any} */ value, /** @type {string} */ pointer = '') => {
    if (!value || typeof value !== 'object') return value;
    if (clones.has(value)) return clones.get(value);
    const copy = Array.isArray(value) ? [] : Object.create(null);
    clones.set(value, copy);
    if (Array.isArray(value)) {
      value.forEach((item, index) => copy.push(clone(item, `${pointer}/${index}`)));
      return copy;
    }
    pointers.set(copy, pointer || '/');
    if (text(value['@id'])) {
      const id = identity(value['@id']);
      const group = definitions.get(id) ?? [];
      group.push(copy);
      definitions.set(id, group);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === '@context') continue;
      copy[key] = key === '@id' && text(child) ? identity(child) : clone(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
    return copy;
  };
  const copied = clone(input);
  /** @returns {boolean} */
  const equal = (/** @type {any} */ first, /** @type {any} */ incoming) => {
    if (first === incoming) return true;
    if (!first || !incoming || typeof first !== 'object' || typeof incoming !== 'object' || Array.isArray(first) !== Array.isArray(incoming)) return false;
    const keys = Object.keys(first);
    return keys.length === Object.keys(incoming).length && keys.every((key) => Object.hasOwn(incoming, key) && equal(first[key], incoming[key]));
  };
  const merge = (/** @type {Record<string, any>} */ first, /** @type {Record<string, any>} */ incoming) => {
    if (first === incoming) return;
    for (const [key, child] of Object.entries(incoming)) {
      if (!Object.hasOwn(first, key) || first[key] === undefined) { first[key] = child; continue; }
      const previous = first[key];
      if (equal(previous, child)) continue;
      if (key === '@type' || (Array.isArray(previous) && Array.isArray(child))) {
        const combined = [...values(previous)];
        for (const item of values(child)) {
          if (!combined.some((entry) => equal(entry, item) || (text(entry?.['@id']) && entry['@id'] === item?.['@id']))) combined.push(item);
        }
        first[key] = combined;
      } else if (record(previous) && record(child) && text(previous['@id']) && previous['@id'] === child['@id']) {
        // Their own ID group merges in source order, not their parent's merge order.
        continue;
      } else if (record(previous) && record(child) && !text(previous['@id']) && !text(child['@id'])) {
        merge(previous, child);
      } else {
        const fields = conflicts.get(first) ?? new Set();
        fields.add(key);
        conflicts.set(first, fields);
      }
    }
  };
  for (const [id, group] of definitions) {
    const [first, ...rest] = group;
    rest.forEach((entity) => merge(first, entity));
    byId.set(id, first);
  }
  const resolve = (/** @type {unknown} */ value) => {
    const entity = record(value);
    return entity && text(entity['@id']) ? byId.get(entity['@id']) ?? entity : entity;
  };
  const roots = jsonLdEntities(copied).map((entity) => resolve(entity) ?? entity);
  /** @type {Set<Record<string, any>>} */
  const visited = new Set();
  /** @type {Map<Record<string, any>, Set<string>>} */
  const uses = new Map();
  // Roles come from every source statement, including values retained away by a conflict.
  for (const value of clones.values()) {
    const source = record(value);
    if (!source) continue;
    for (const [field, nested] of Object.entries(source)) {
      if (field.startsWith('@')) continue;
      for (const child of values(nested)) {
        const related = resolve(child);
        if (!related) continue;
        const roles = uses.get(related) ?? new Set();
        roles.add(field === 'itemReviewed' && schemaTypes(resolve(source)).includes('Review') ? 'reviewed' : 'independent');
        uses.set(related, roles);
      }
    }
  }
  const index = (/** @type {unknown} */ value) => {
    if (Array.isArray(value)) { value.forEach(index); return; }
    const entity = resolve(value);
    if (!entity || visited.has(entity)) return;
    visited.add(entity);
    Object.values(entity).forEach(index);
  };
  roots.forEach(index);
  const read = (/** @type {Record<string, any>} */ entity, /** @type {string} */ path) => {
    let candidates = [entity];
    for (const part of path.split('.')) candidates = candidates.flatMap((candidate) => values(resolve(candidate)?.[part]));
    return candidates;
  };
  const present = (/** @type {unknown} */ value) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  const ambiguous = (/** @type {Record<string, any>} */ entity, /** @type {string} */ path) => {
    let candidates = [entity];
    for (const part of path.split('.')) {
      if (candidates.some((candidate) => conflicts.get(resolve(candidate) ?? candidate)?.has(part))) return true;
      candidates = candidates.flatMap((candidate) => values(resolve(candidate)?.[part]));
    }
    return false;
  };
  /** @type {Map<string, GoogleFinding>} */
  const emitted = new Map();
  const emit = (/** @type {Record<string, any>} */ entity, /** @type {string} */ type, /** @type {string} */ field, /** @type {boolean} */ required, /** @type {string} */ reason, /** @type {string} */ documentation) => {
    const evidence = text(entity['@id']) ? entity['@id'] : pointers.get(entity) ?? '/';
    const key = JSON.stringify([evidence, type, field, required]);
    const message = `${type}: ${field} ${reason}. See ${documentation}`;
    const previous = emitted.get(key);
    if (previous) {
      if (reason === CONFLICT_REASON) previous.message = message;
      return;
    }
    /** @type {GoogleFinding} */
    const finding = { ruleId: required ? 'google-schema-required' : 'google-schema-recommended',
      severity: required ? 'warning' : 'info', message, documentation, evidence };
    emitted.set(key, finding);
    findings.push(finding);
  };
  const valid = (/** @type {string} */ field, /** @type {unknown} */ value) => {
    if (field === 'applicationCategory') return typeof value === 'string' && APPLICATION_CATEGORIES.has(value);
    if (['name', 'headline', 'description', 'operatingSystem', 'telephone', 'priceRange'].includes(field.split('.').at(-1) ?? '')) return text(value);
    if (/(?:^|\.)(?:price|lowPrice|highPrice|offerCount|ratingCount|reviewCount|bestRating|worstRating)$/.test(field)) return numeric(value) && Number(value) >= 0;
    if (/(?:^|\.)ratingValue$/.test(field)) return numeric(value) || (text(value) && /^(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)$/.test(/** @type {string} */ (value)));
    if (field === 'priceCurrency') return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
    if (/^date/.test(field) || field === 'priceValidUntil') return validSchemaDate(value);
    if (['url', 'sameAs', 'license', 'image'].includes(field)) return url(value) ||
      (field === 'image' && schemaTypes(resolve(value)).includes('ImageObject') && url(resolve(value)?.url ?? resolve(value)?.contentUrl)) ||
      (field === 'license' && schemaTypes(resolve(value)).includes('CreativeWork') && url(resolve(value)?.url));
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
    const roles = uses.get(entity);
    const explicit = options.explicitType && roots.includes(entity) && schemaTypes(entity).includes(options.explicitType);
    if (type && (explicit || !roles?.has('reviewed') || roles.has('independent'))) {
      const current = GOOGLE_PROFILES[/** @type {keyof typeof GOOGLE_PROFILES} */ (type)];
      const documentation = current.documentation;
      const report = (/** @type {string} */ label, /** @type {string} */ field, /** @type {boolean} */ required, /** @type {string} */ reason, /** @type {string} */ reference) => emit(entity, label, field, required, reason, reference);
      const conflict = (/** @type {Record<string, any>} */ target, /** @type {string} */ path, /** @type {boolean} */ required, /** @type {string} */ field = path) => {
        if (!ambiguous(target, path)) return false;
        report(type, field, required, CONFLICT_REASON, documentation);
        return true;
      };
      const fields = (/** @type {Record<string, any>} */ target, /** @type {string} */ label, /** @type {string[]} */ names, /** @type {boolean} */ required, /** @type {string} */ reference) => {
        for (const field of names) {
          const found = read(target, field);
          if (conflict(target, field, required)) continue;
          const nestedConflict = found.some((value) => {
            const related = resolve(value);
            return related && ((field === 'license' && ambiguous(related, 'url')) || (field === 'image' && ambiguous(related, related.url !== undefined ? 'url' : 'contentUrl')));
          });
          if (nestedConflict) report(label, field, required, CONFLICT_REASON, reference);
          else if (!found.length || !found.every((value) => valid(field, value))) report(label, field, required, 'is missing or has an unsupported value shape', reference);
        }
      };
      fields(entity, type, [...current.required], true, documentation);
      fields(entity, type, [...current.recommended], false, documentation);
      if (['Article', 'BlogPosting', 'NewsArticle', 'Review'].includes(type)) {
        for (const author of read(entity, 'author')) {
          const resolved = resolve(author);
          if (!resolved || (!conflict(resolved, 'name', type === 'Review', 'author.name') && (!text(resolved.name) || (type === 'Review' && resolved.name.length >= 100)))) report(type, 'author.name', type === 'Review', 'needs a named author (review names must be shorter than 100 characters)', documentation);
          if (type !== 'Review' && (!resolved || (!conflict(resolved, resolved.url !== undefined ? 'url' : 'sameAs', false, 'author.url') && !values(resolved.url ?? resolved.sameAs).some(url)))) report(type, 'author.url', false, 'should identify the author with a URL or sameAs', documentation);
        }
      }
      if (type === 'Product' || type === 'SoftwareApplication') {
        const alternatives = type === 'Product' ? ['review', 'aggregateRating', 'offers'] : ['review', 'aggregateRating'];
        const supported = alternatives.some((field) => !ambiguous(entity, field) && values(entity[field]).some((value) => valid(field, value)));
        for (const field of alternatives) conflict(entity, field, !supported);
        if (!supported && !alternatives.some((field) => ambiguous(entity, field))) report(type, alternatives.join(' or '), true, 'needs at least one supported entity', documentation);
        if (values(entity.review).some((value) => !valid('review', value))) report(type, 'review', true, 'must be a Review', documentation);
        for (const offer of read(entity, 'offers')) {
          const resolved = resolve(offer);
          const aggregate = schemaTypes(resolved).includes('AggregateOffer');
          if (!schemaTypes(resolved).includes(aggregate ? 'AggregateOffer' : 'Offer') || (type === 'SoftwareApplication' && aggregate)) report(type, 'offers', true, 'must use a supported Offer type', documentation);
          if (resolved && aggregate) fields(resolved, type, ['lowPrice', 'priceCurrency'], true, documentation);
          if (resolved && !aggregate) {
            const priceField = Object.hasOwn(resolved, 'price') || type !== 'Product' ? 'price' : 'priceSpecification.price';
            const prices = read(resolved, priceField);
            if (!conflict(resolved, priceField, true, 'offers.price') && (!prices.length || !prices.every((value) => numeric(value) && Number(value) >= 0))) report(type, 'offers.price', true, 'needs a non-negative price (Product also accepts priceSpecification.price)', documentation);
            const currencyField = priceField === 'price' ? 'priceCurrency' : 'priceSpecification.priceCurrency';
            const currencies = read(resolved, currencyField);
            if ((type === 'Product' || prices.some((value) => Number(value) > 0)) && !conflict(resolved, currencyField, false, 'offers.priceCurrency') && (!currencies.length || !currencies.every((value) => valid('priceCurrency', value)))) report(type, 'offers.priceCurrency', false, 'should use a currency code', documentation);
          }
          if (resolved) fields(resolved, type, aggregate ? ['highPrice', 'offerCount'] : type === 'Product' ? ['availability', 'priceValidUntil'] : [], false, documentation);
        }
        for (const rating of read(entity, 'aggregateRating')) {
          const resolved = resolve(rating);
          if (!schemaTypes(resolved).includes('AggregateRating')) report(type, 'aggregateRating', true, 'must be an AggregateRating', documentation);
          if (resolved) {
            fields(resolved, type, ['ratingValue'], true, documentation);
            const counted = ['ratingCount', 'reviewCount'].some((field) => !ambiguous(resolved, field) && read(resolved, field).some((value) => numeric(value) && Number(value) > 0));
            const countConflict = ['ratingCount', 'reviewCount'].map((field) => conflict(resolved, field, !counted, `aggregateRating.${field}`)).some(Boolean);
            if (!counted && !countConflict) report(type, 'aggregateRating.ratingCount or reviewCount', true, 'needs a positive count', documentation);
          }
        }
      }
      if (type === 'Review') {
        conflict(entity, 'itemReviewed', true);
        conflict(entity, 'reviewRating', true);
        const reviewed = resolve(entity.itemReviewed) ?? (parent && schemaTypes(parent).some((name) => REVIEW_TYPES.has(name)) ? parent : undefined) ?? reviewParents.get(entity);
        if (!reviewed || !schemaTypes(reviewed).some((name) => REVIEW_TYPES.has(name))) report(type, 'itemReviewed', true, 'must identify a documented supported reviewed type, directly or through its parent', documentation);
        else {
          fields(reviewed, type, ['name'], true, documentation);
          if (schemaTypes(reviewed).some((name) => name === 'Organization' || name === 'LocalBusiness')) report(type, 'itemReviewed', false, 'self-serving business reviews do not qualify; field checks cannot establish review independence', documentation);
        }
        if (!schemaTypes(resolve(entity.reviewRating)).some((name) => name === 'Rating' || name === 'AggregateRating')) report(type, 'reviewRating', true, 'must be a Rating', documentation);
      }
      if (type === 'Dataset' && !ambiguous(entity, 'description') && text(entity.description) && (entity.description.length < 50 || entity.description.length > 5000)) report(type, 'description', true, 'must contain between 50 and 5000 characters', documentation);
      if (type === 'ProfilePage') for (const main of read(entity, 'mainEntity')) {
        const resolved = resolve(main);
        if (resolved) {
          const named = ['name', 'alternateName'].some((field) => !ambiguous(resolved, field) && text(resolved[field]));
          const nameConflict = ['name', 'alternateName'].map((field) => conflict(resolved, field, !named, `mainEntity.${field}`)).some(Boolean);
          if (!named && !nameConflict) report(type, 'mainEntity.name or alternateName', true, 'needs a name', documentation);
          fields(resolved, type, ['identifier', 'image', 'description', 'sameAs'], false, documentation);
        } else report(type, 'mainEntity.name or alternateName', true, 'needs a name', documentation);
      }
      if (type === 'LocalBusiness') for (const address of read(entity, 'address')) {
        const resolved = resolve(address);
        if (resolved) fields(resolved, type, ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'], false, documentation);
      }
      if (type === 'LocalBusiness') for (const geo of read(entity, 'geo')) {
        const resolved = resolve(geo);
        if (resolved) {
          const geoConflict = ['latitude', 'longitude'].map((field) => conflict(resolved, field, true, `geo.${field}`)).some(Boolean);
          if (!geoConflict && (!numeric(resolved.latitude) || Math.abs(Number(resolved.latitude)) > 90 || !numeric(resolved.longitude) || Math.abs(Number(resolved.longitude)) > 180)) report(type, 'geo.latitude and longitude', true, 'need valid coordinates when geo is provided', documentation);
        }
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
  roots.forEach((entity) => check(entity, undefined));
  if (options.explicitType && !Object.hasOwn(GOOGLE_PROFILES, options.explicitType)) {
    findings.push({ ruleId: 'google-schema-unsupported', severity: 'info',
      message: `${options.explicitType}: no current documented Google profile is provided. Schema.org output is unchanged; checks do not guarantee rich results.`,
      ...(roots[0] ? { evidence: roots[0]['@id'] ?? pointers.get(roots[0]) } : {}) });
  }
  return findings;
}

/** @param {unknown} entity @param {'schema' | 'google'} eligibility @param {{ documentUrl?: string; explicitType?: string }} [options] */
export function warnGoogleSchema(entity, eligibility, options = {}) {
  if (eligibility !== 'google') return;
  for (const finding of checkGoogleSchema(entity, options)) console.warn(`[astro-aeo] ${finding.severity}: ${finding.message}`);
}

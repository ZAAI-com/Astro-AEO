// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { checkGoogleSchema, GOOGLE_PROFILES, warnGoogleSchema } from './schema-google.js';
import { extractPageFacts } from '../audit/facts.js';
import { auditPages } from '../audit/site-rules.js';

const warnings = (entity, options) => checkGoogleSchema(entity, options).filter((finding) => finding.severity === 'warning');
const author = { '@type': 'Person', name: 'Ada', url: 'https://example.org/ada' };
const review = { '@type': 'Review', author, reviewRating: { '@type': 'Rating', ratingValue: 4 }, itemReviewed: { '@type': 'Product', name: 'Tool', offers: { '@type': 'Offer', price: 0 } } };

describe('Google field profiles', () => {
  it.each(['Article', 'BlogPosting', 'NewsArticle'])('%s has recommendations, not universal requirements', (type) => {
    expect(warnings({ '@type': type })).toEqual([]);
    expect(checkGoogleSchema({ '@type': type }).every((finding) => finding.severity === 'info')).toBe(true);
    expect(checkGoogleSchema({ '@type': type, headline: 'Title', author, datePublished: '2026-09-30T00:00:00Z', dateModified: '2026-09-30T00:00:00Z', image: ['https://example.org/image.jpg'] })).toEqual([]);
  });
  it.each([
    { '@type': 'Product', name: 'Tool', offers: { '@type': 'Offer', price: 0 } },
    { '@type': 'Product', name: 'Tool', offers: { '@type': 'Offer', priceSpecification: { '@type': 'UnitPriceSpecification', price: 12 } } },
    { '@type': 'Product', name: 'Tool', offers: { '@type': 'AggregateOffer', lowPrice: 10, priceCurrency: 'USD' } },
    { '@type': 'SoftwareApplication', name: 'Tool', offers: { '@type': 'Offer', price: 0 }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4, ratingCount: 3 } },
    review,
    { '@type': 'Dataset', name: 'Data', description: 'A documented dataset of daily temperatures observed over fifty years.' },
    { '@type': 'ProfilePage', mainEntity: author },
    { '@type': 'LocalBusiness', name: 'Shop', address: { '@type': 'PostalAddress', streetAddress: 'Main street' } },
  ])('accepts documented required fields for $@type', (entity) => expect(warnings(entity)).toEqual([]));
  it.each(['Product', 'SoftwareApplication', 'Review', 'Dataset', 'ProfilePage', 'LocalBusiness'])('%s reports missing required fields', (type) => expect(warnings({ '@type': type }).length).toBeGreaterThan(0));
  it.each(['FAQPage', 'TechArticle', 'Service', 'ItemList', 'HowTo', 'BreadcrumbList', 'Organization', 'WebPage'])('%s has no speculative profile', (type) => {
    const entity = { '@type': type, name: 'Entity' };
    expect(checkGoogleSchema(entity)).toEqual([]);
    expect(checkGoogleSchema(entity, { explicitType: type })).toEqual([expect.objectContaining({ severity: 'info', ruleId: 'google-schema-unsupported' })]);
  });
  it('resolves references across scripts and nested arrays without fetching or mutating inputs', () => {
    const entities = [{ '@type': 'Article', headline: 'Title', author: { '@id': '#author' }, image: 'https://example.org/image', datePublished: '2026-09-30', dateModified: '2026-09-30' }, { ...author, '@id': 'https://example.org/page#author' }];
    const original = JSON.stringify(entities);
    expect(checkGoogleSchema(entities, { documentUrl: 'https://example.org/page' })).toEqual([]);
    expect(JSON.stringify(entities)).toBe(original);
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(warnings({ '@type': 'ProfilePage', mainEntity: { '@id': 'https://external.example/person' } }).length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it('supports nested reviews and reports restrictions without claiming to certify visible content', () => {
    expect(warnings({ '@type': 'Product', name: 'Tool', review: { ...review, itemReviewed: undefined } })).toEqual([]);
    const business = { ...review, itemReviewed: { '@type': 'Organization', name: 'Business' } };
    expect(checkGoogleSchema(business).some((finding) => finding.message.includes('self-serving'))).toBe(true);
  });
  it('resolves a nested review parent regardless of graph order', () => {
    const nested = { ...review, '@id': '#review', itemReviewed: undefined };
    const product = { '@type': 'Product', name: 'Tool', review: { '@id': '#review' } };
    expect(warnings([nested, product])).toEqual([]);
    expect(warnings([product, nested])).toEqual([]);
  });
  it('merges normalized complementary definitions and checks each node once without mutation', () => {
    const entities = [
      { '@id': '#app', '@type': 'Thing' },
      { '@id': 'https://example.org/page#app', '@type': 'SoftwareApplication', name: 'App', offers: { '@id': '#offer' } },
      { '@id': '#app', '@type': ['SoftwareApplication', 'Thing'], name: 'App', aggregateRating: { '@id': '#rating' } },
      { '@id': '#offer', '@type': 'Offer' },
      { '@id': 'https://example.org/page#offer', price: 0 },
      { '@id': '#rating', '@type': 'AggregateRating', ratingValue: 4 },
      { '@id': 'https://example.org/page#rating', ratingCount: 3 },
    ];
    const original = JSON.stringify(entities);
    const freeze = (value) => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(entities);
    for (const ordered of [entities, [...entities].reverse()]) {
      const findings = checkGoogleSchema(ordered, { documentUrl: 'https://example.org/page' });
      expect(findings.filter((finding) => finding.severity === 'warning')).toEqual([]);
      expect(findings.every((finding) => finding.evidence === 'https://example.org/page#app')).toBe(true);
      expect(findings.filter((finding) => finding.message.startsWith('SoftwareApplication: operatingSystem'))).toHaveLength(1);
    }
    expect(JSON.stringify(entities)).toBe(original);
  });
  it('unions types and equal arrays without treating repeated values as conflicts', () => {
    const complete = { '@id': '#article', '@type': 'Article', headline: 'Title', author: [author], image: ['https://example.org/cover.jpg'], datePublished: '2026-09-30', dateModified: '2026-09-30' };
    const fragment = { '@id': '#article', '@type': ['Thing', 'Article'], author: [{ url: author.url, name: author.name, '@type': 'Person' }], image: ['https://example.org/cover.jpg', 'https://example.org/alternate.jpg'] };
    expect(checkGoogleSchema([fragment, complete])).toEqual([]);
    expect(checkGoogleSchema([complete, fragment])).toEqual([]);
  });
  it('reports required and recommended scalar conflicts without losing first-value traversal', () => {
    const application = { '@id': '#app', '@type': 'SoftwareApplication', name: 'App', applicationCategory: 'GameApplication', offers: { '@type': 'Offer', price: 0 }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4, ratingCount: 3 } };
    const conflicting = { '@id': '#app', name: 'Other app', applicationCategory: 'UtilitiesApplication', offers: { '@type': 'Offer', price: 10 } };
    for (const ordered of [[application, conflicting], [conflicting, application]]) {
      const findings = checkGoogleSchema(ordered);
      expect(findings.filter((finding) => finding.message.startsWith('SoftwareApplication: name'))).toEqual([expect.objectContaining({ ruleId: 'google-schema-required', severity: 'warning', evidence: '#app', message: expect.stringContaining('conflicting definitions') })]);
      expect(findings.filter((finding) => finding.message.startsWith('SoftwareApplication: offers.price '))).toHaveLength(1);
      expect(findings.filter((finding) => finding.message.startsWith('SoftwareApplication: applicationCategory'))).toEqual([expect.objectContaining({ ruleId: 'google-schema-recommended', severity: 'info', message: expect.stringContaining('conflicting definitions') })]);
    }
    expect(checkGoogleSchema([application, conflicting]).some((finding) => finding.message.startsWith('SoftwareApplication: offers.priceCurrency'))).toBe(false);
    expect(checkGoogleSchema([conflicting, application]).some((finding) => finding.message.startsWith('SoftwareApplication: offers.priceCurrency'))).toBe(true);
  });
  it('reports conflicts behind referenced offers and repeated rating fields', () => {
    const product = { '@type': 'Product', name: 'Tool', offers: { '@id': '#offer' }, aggregateRating: { '@id': '#rating' } };
    const first = { '@id': '#offer', '@type': 'Offer', price: 5, priceCurrency: 'EUR' };
    const second = { '@id': '#offer', price: -1, priceCurrency: 'USD' };
    const rating = { '@id': '#rating', '@type': 'AggregateRating', ratingValue: 4, ratingCount: 3, reviewCount: 3 };
    const other = { '@id': '#rating', ratingValue: 2, ratingCount: 4, reviewCount: 4 };
    const findings = checkGoogleSchema([product, first, second, rating, other]);
    expect(findings.filter((finding) => finding.message.startsWith('Product: offers.price '))).toEqual([expect.objectContaining({ severity: 'warning', evidence: '/0', message: expect.stringContaining('conflicting definitions') })]);
    expect(findings.filter((finding) => finding.message.startsWith('Product: offers.priceCurrency'))).toEqual([expect.objectContaining({ severity: 'info', message: expect.stringContaining('conflicting definitions') })]);
    expect(findings.filter((finding) => finding.message.includes('conflicting definitions')).map((finding) => finding.message.split(' has ')[0])).toEqual(expect.arrayContaining(['Product: ratingValue', 'Product: aggregateRating.ratingCount', 'Product: aggregateRating.reviewCount']));
  });
  it('retains the first observed nested definition rather than its parent merge order', () => {
    const application = { '@id': '#app', '@type': 'SoftwareApplication', name: 'App', offers: { '@id': '#offer' }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4, ratingCount: 1 } };
    const first = { '@id': '#offer', '@type': 'Offer', price: 0 };
    const later = { '@id': '#app', offers: { '@id': '#offer', '@type': 'Offer', price: 10 } };
    const findings = checkGoogleSchema([application, first, later]);
    expect(findings.filter((finding) => finding.message.startsWith('SoftwareApplication: offers.price '))).toEqual([expect.objectContaining({ message: expect.stringContaining('conflicting definitions') })]);
    expect(findings.some((finding) => finding.message.startsWith('SoftwareApplication: offers.priceCurrency'))).toBe(false);
    const article = { '@id': '#article', '@type': 'Article', author };
    const linking = { '@id': '#article', author: { '@id': '#other' } };
    const authorFindings = checkGoogleSchema([article, linking]);
    expect(authorFindings.filter((finding) => finding.message.startsWith('Article: author '))).toEqual([expect.objectContaining({ message: expect.stringContaining('conflicting definitions') })]);
    expect(authorFindings.some((finding) => finding.message.startsWith('Article: author.name'))).toBe(false);
  });
  it('retains distinct subject evidence while suppressing genuine repeated findings', () => {
    const findings = warnings([{ '@type': 'Product' }, { '@type': 'Product' }]);
    expect(findings.filter((finding) => finding.message.startsWith('Product: name')).map((finding) => finding.evidence)).toEqual(['/0', '/1']);
    expect(warnings([{ '@type': 'Product', '@id': '#product' }, { '@type': 'Product', '@id': '#product' }])).toHaveLength(2);
    const product = { '@type': 'Product', name: 'Tool', offers: [{ '@type': 'Offer', price: -1 }, { '@type': 'Offer', price: -2 }] };
    expect(warnings(product).filter((finding) => finding.message.startsWith('Product: offers.price '))).toEqual([expect.objectContaining({ evidence: '/' })]);
    const application = { '@type': 'SoftwareApplication', name: 'App', offers: { '@type': 'Offer', price: 'bad' }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4, ratingCount: 1 } };
    expect(warnings(application).filter((finding) => finding.message.startsWith('SoftwareApplication: offers.price '))).toEqual([expect.objectContaining({ evidence: '/' })]);
    const mixed = { '@type': 'Product', name: 'Tool', offers: [{ '@type': 'Offer', price: -1 }, { '@id': '#offer' }] };
    for (const offers of [mixed.offers, [...mixed.offers].reverse()]) {
      const graph = [{ ...mixed, offers }, { '@type': 'Offer', '@id': '#offer', price: 1 }, { '@id': '#offer', price: 2 }];
      expect(warnings(graph).filter((finding) => finding.message.startsWith('Product: offers.price '))).toEqual([expect.objectContaining({ evidence: '/0', message: expect.stringContaining('conflicting definitions') })]);
    }
  });
  it.each(['Product', 'SoftwareApplication', 'LocalBusiness'])('checks a reviewed %s only under its Review subject contract', (type) => {
    const subject = { '@type': type, name: 'Reviewed item' };
    const entity = { ...review, itemReviewed: subject };
    expect(warnings(entity)).toEqual([]);
    const identified = { ...subject, '@id': '#subject' };
    const referencing = { ...review, itemReviewed: { '@id': '#subject' } };
    for (const graph of [[referencing, identified], [identified, referencing]]) {
      expect(warnings({ '@context': 'https://schema.org', '@graph': graph })).toEqual([]);
      expect(warnings(graph, { explicitType: type }).length).toBeGreaterThan(0);
      expect(warnings([...graph, { '@type': 'WebPage', mainEntity: { '@id': '#subject' } }]).length).toBeGreaterThan(0);
    }
    expect(warnings(subject).length).toBeGreaterThan(0);
    expect(warnings({ ...entity, itemReviewed: { '@type': type } }).some((finding) => finding.message.startsWith('Review: name'))).toBe(true);
  });
  it('retains roles for conflicting reviewed subjects and exposes the Review ambiguity', () => {
    const subjects = [{ '@id': '#first', '@type': 'Product', name: 'First' }, { '@id': '#second', '@type': 'Product', name: 'Second' }];
    const reviews = [{ ...review, '@id': '#review', itemReviewed: { '@id': '#first' } }, { '@id': '#review', itemReviewed: { '@id': '#second' } }];
    expect(warnings([...reviews, ...subjects])).toEqual([expect.objectContaining({ evidence: '#review', message: expect.stringContaining('Review: itemReviewed has conflicting definitions') })]);
    expect(warnings([...subjects, ...reviews].reverse())).toEqual([expect.objectContaining({ evidence: '#review', message: expect.stringContaining('Review: itemReviewed has conflicting definitions') })]);
  });
  it('reports conflicting required ProfilePage names unless an unambiguous alternative supplies its name', () => {
    const page = { '@type': 'ProfilePage', mainEntity: { '@id': '#author' } };
    const first = { ...author, '@id': '#author' };
    const second = { '@id': '#author', name: 'Bob' };
    expect(warnings([page, first, second])).toEqual([expect.objectContaining({ message: expect.stringContaining('ProfilePage: mainEntity.name has conflicting definitions') })]);
    const withAlternative = checkGoogleSchema([page, { ...first, alternateName: 'Editor' }, second]);
    expect(withAlternative.filter((finding) => finding.severity === 'warning')).toEqual([]);
    expect(withAlternative.filter((finding) => finding.message.includes('conflicting definitions'))).toEqual([expect.objectContaining({ severity: 'info' })]);
  });
  it('honors direct price and currency precedence over price specifications', () => {
    const product = (offers) => ({ '@type': 'Product', name: 'Tool', offers: { '@type': 'Offer', ...offers } });
    const specification = { '@type': 'PriceSpecification', price: 5, priceCurrency: 'USD' };
    expect(warnings(product({ price: -1, priceSpecification: specification })).some((finding) => finding.message.startsWith('Product: offers.price '))).toBe(true);
    expect(warnings(product({ price: null, priceSpecification: specification })).some((finding) => finding.message.startsWith('Product: offers.price '))).toBe(true);
    expect(warnings(product({ price: 10, priceCurrency: 'EUR', priceSpecification: { ...specification, price: -1, priceCurrency: 'bad' } }))).toEqual([]);
    expect(checkGoogleSchema(product({ price: 10, priceSpecification: specification })).some((finding) => finding.message.startsWith('Product: offers.priceCurrency'))).toBe(true);
    expect(checkGoogleSchema(product({ priceSpecification: specification })).some((finding) => finding.message.startsWith('Product: offers.priceCurrency'))).toBe(false);
    expect(checkGoogleSchema(product({ priceCurrency: 'EUR', priceSpecification: { ...specification, priceCurrency: 'bad' } })).some((finding) => finding.message.startsWith('Product: offers.priceCurrency'))).toBe(true);
    const referencing = product({ priceSpecification: { '@id': '#price' } });
    expect(warnings([referencing, { ...specification, '@id': '#price' }])).toEqual([]);
    expect(checkGoogleSchema([referencing, { ...specification, '@id': '#price' }]).some((finding) => finding.message.startsWith('Product: offers.priceCurrency'))).toBe(false);
  });
  it('accepts URL and resolved CreativeWork licenses without accepting malformed licenses', () => {
    const dataset = { '@type': 'Dataset', name: 'Measurements', description: 'A documented dataset of daily temperatures observed over fifty years.' };
    const license = { '@type': 'CreativeWork', name: 'Custom license', url: 'https://example.org/license' };
    for (const value of [license.url, license]) {
      expect(checkGoogleSchema({ ...dataset, license: value }).some((finding) => finding.message.startsWith('Dataset: license'))).toBe(false);
    }
    expect(checkGoogleSchema([{ ...dataset, license: { '@id': '#license' } }, { ...license, '@id': '#license' }]).some((finding) => finding.message.startsWith('Dataset: license'))).toBe(false);
    for (const malformed of [{ '@type': 'CreativeWork', name: 'License' }, { ...license, url: 'bad' }, { ...license, '@type': 'Thing' }, {}]) {
      expect(checkGoogleSchema({ ...dataset, license: malformed }).filter((finding) => finding.message.startsWith('Dataset: license'))).toEqual([expect.objectContaining({ severity: 'info' })]);
    }
  });
  it('reports ambiguity in referenced recommended URL shapes without replacing retained values', () => {
    const dataset = { '@type': 'Dataset', name: 'Measurements', description: 'A documented dataset of daily temperatures observed over fifty years.', license: { '@id': '#license' } };
    const license = { '@id': '#license', '@type': 'CreativeWork', name: 'Custom license', url: 'https://example.org/license' };
    expect(checkGoogleSchema([dataset, license, { '@id': '#license', url: 'https://example.org/other' }]).filter((finding) => finding.message.startsWith('Dataset: license'))).toEqual([expect.objectContaining({ evidence: '/0', severity: 'info', message: expect.stringContaining('conflicting definitions') })]);
    const article = { '@type': 'Article', author: { '@id': '#author' }, image: { '@id': '#image' } };
    const entities = [article, { ...author, '@id': '#author' }, { '@id': '#author', url: 'https://example.org/other-author' }, { '@id': '#image', '@type': 'ImageObject', contentUrl: 'https://example.org/cover' }, { '@id': '#image', contentUrl: 'https://example.org/other-cover' }];
    const ambiguous = checkGoogleSchema(entities).filter((finding) => finding.message.includes('conflicting definitions'));
    expect(ambiguous.map((finding) => finding.message.split(' has ')[0])).toEqual(['Article: image', 'Article: author.url']);
    expect(ambiguous.every((finding) => finding.severity === 'info')).toBe(true);
  });
  it('does not count unsupported entities as a required Product alternative', () => {
    expect(warnings({ '@type': 'Product', name: 'Tool', offers: {} }).length).toBeGreaterThan(0);
    expect(warnings({ '@type': 'Product', name: 'Tool', review: { '@type': 'Thing' } }).length).toBeGreaterThan(0);
  });
  it('validates documented application categories and real calendar dates', () => {
    const application = { '@type': 'SoftwareApplication', name: 'App', offers: { '@type': 'Offer', price: 0 }, review: { ...review, itemReviewed: undefined } };
    expect(checkGoogleSchema({ ...application, applicationCategory: 'Unknown' }).some((finding) => finding.message.startsWith('SoftwareApplication: applicationCategory'))).toBe(true);
    expect(checkGoogleSchema({ ...application, applicationCategory: 'UtilitiesApplication' }).some((finding) => finding.message.startsWith('SoftwareApplication: applicationCategory'))).toBe(false);
    expect(checkGoogleSchema({ '@type': 'Article', datePublished: '2026-02-30' }).some((finding) => finding.message.startsWith('Article: datePublished'))).toBe(true);
  });
  it.each([
    { '@type': 'Dataset', name: 'Data', description: 'Short' },
    { '@type': 'Product', name: 'Tool', offers: { '@type': 'Offer', price: -1 } },
    { '@type': 'Product', name: 'Tool', aggregateRating: { '@type': 'AggregateRating', ratingValue: 'bad', reviewCount: 0 } },
    { '@type': 'ProfilePage', mainEntity: { '@type': 'Product', name: 'Tool' } },
    { ...review, author: { '@type': 'Person', name: 'x'.repeat(100) } },
  ])('rejects an invalid required shape for $@type', (entity) => expect(warnings(entity).length).toBeGreaterThan(0));
  it('agrees between explicit component checks and final rendered audit checks', () => {
    const entity = { '@type': 'Product', name: 'Tool' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnGoogleSchema(entity, 'schema');
    expect(warn).not.toHaveBeenCalled();
    warnGoogleSchema(entity, 'google', { explicitType: 'Product' });
    const page = extractPageFacts(`<main><p>Tool.</p></main><script type="application/ld+json">${JSON.stringify(entity)}</script>`, { url: '/' });
    const audit = auditPages([page], { schemaTarget: 'google' }).filter((finding) => finding.ruleId.startsWith('google-'));
    const comparable = ({ ruleId, severity, message }) => ({ ruleId, severity, message });
    expect(audit.map(comparable)).toEqual(checkGoogleSchema(entity).map(comparable));
    expect(warn.mock.calls.map(([message]) => message)).toEqual(audit.map((finding) => `[astro-aeo] ${finding.severity}: ${finding.message}`));
    expect(auditPages([page]).some((finding) => finding.ruleId.startsWith('google-'))).toBe(false);
    warn.mockRestore();
  });
  it('records official documentation and a verification date in every profile', () => {
    for (const profile of Object.values(GOOGLE_PROFILES)) {
      expect(profile.documentation).toMatch(/^https:\/\/developers.google.com\/search\/docs\//);
      expect(profile.verified).toBe('2026-09-30');
      expect(Object.isFrozen(profile)).toBe(true);
    }
  });
});

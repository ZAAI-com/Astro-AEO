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

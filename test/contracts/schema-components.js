import { expect } from 'vitest';
import { checkGoogleSchema } from '../../src/core/schema-google.js';

export function verifySchemaComponents(html) {
  const bodies = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const entities = bodies.map((body) => JSON.parse(body));
  expect(entities.map((entity) => entity['@type'])).toEqual(['Article', 'BlogPosting', 'TechArticle',
    'Product', 'SoftwareApplication', 'Review', 'ItemList', 'Dataset', 'ProfilePage', 'Service',
    'LocalBusiness', 'FAQPage', 'HowTo', 'BreadcrumbList', 'Organization', 'WebPage', undefined]);
  expect(bodies[0]).toBe('{"@context":"https://schema.org","@type":"Article","headline":"Legacy","image":"https://example.com/cover.jpg","mainEntityOfPage":"https://example.com/","author":{"@type":"Person","name":"Ada","url":"https://example.com/ada"}}');
  expect(entities[1]).toMatchObject({ publisher: { '@type': 'Organization', name: 'Publisher' },
    author: [{ '@type': 'Organization', name: 'Editors' }, { '@id': '#ada' }],
    image: ['https://example.com/cover.jpg'], keywords: ['astro', 'schema'], inLanguage: 'de-DE' });
  expect(bodies[3]).not.toContain('</script>');
  expect(bodies[3]).toContain('\\u003c');
  expect(bodies[3]).toContain('\\u2028');
  expect(entities[3].name).toContain('</script>');
  expect(entities[3]).not.toHaveProperty('@id');
  expect(html).toContain('Input unchanged');
  expect(checkGoogleSchema(entities, { documentUrl: 'https://example.com/' }).filter((finding) => finding.severity === 'warning')).toEqual([]);
}

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildSchema, serializeSchema } from '../scripts/schema-definition.mjs';
import { assertExactPathname } from './core/artifact-path.js';

const published = JSON.parse(serializeSchema());

describe('published configuration schema', () => {
  test('the committed artifact is fresh', () => {
    const committed = readFileSync(
      new URL('../schema/astro-aeo.schema.json', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(serializeSchema());
  });

  test('catalog entries require a non-empty module specifier', () => {
    const sourceItems = buildSchema().properties.pages.properties.catalogs.items;
    const publishedItems = published.properties.pages.properties.catalogs.items;
    expect(sourceItems.required).toEqual(['module']);
    expect(publishedItems.required).toEqual(['module']);
    expect(conforms({ pages: { catalogs: [{ module: './catalog.js' }] } })).toBe(true);
    expect(conforms({ pages: { catalogs: [{}] } })).toBe(false);
    expect(conforms({ pages: { catalogs: [{ module: '' }] } })).toBe(false);
  });

  test.each([
    ['/x', true],
    ['/docs/llms.txt', true],
    ['/sale-100%25.txt', true],
    ['/caf%C3%A9.json', true],
    ['/%20space', true],
    ['/%F0%9F%90%83.json', true],
    ['/', false],
    ['relative.json', false],
    ['//x', false],
    ['/a//b', false],
    ['/.', false],
    ['/..', false],
    ['/a/.', false],
    ['/a/..', false],
    ['/a/./b', false],
    ['/a/../b', false],
    ['/a/', false],
    ['/a?query', false],
    ['/a#fragment', false],
    ['/a*', false],
    ['/a{x}', false],
    ['/a[x]', false],
    ['/a\\b', false],
    ['/café.json', false],
    ['/caf%c3%a9.json', false],
    ['/%61.txt', false],
    ['/literal%2520escape.txt', false],
    ['/foo%2Fbar', false],
    ['/foo%5Cbar', false],
    ['/foo%zz', false],
    ['/%FF', false],
  ])('keeps exact-path runtime and schema validation aligned for %s', (pathname, accepted) => {
    let runtimeAccepted = true;
    try {
      assertExactPathname(pathname);
    } catch {
      runtimeAccepted = false;
    }
    expect(runtimeAccepted).toBe(accepted);
    for (const value of [
      { artifacts: { replace: [pathname] } },
      { schema: { corpus: { graphPath: pathname } } },
      { schema: { corpus: { mapPath: pathname } } },
    ]) {
      expect(conforms(value), JSON.stringify(value)).toBe(accepted);
    }
  });

  test('reuses one exact-path schema for replacement and corpus outputs', () => {
    const schema = buildSchema();
    const replace = schema.properties.artifacts.properties.replace.items;
    const corpus = schema.properties.schema.properties.corpus.properties;
    expect(replace.pattern).toBe(corpus.graphPath.pattern);
    expect(replace.pattern).toBe(corpus.mapPath.pattern);
  });

  test('deprecated object aliases retain their value constraints', () => {
    expect(
      conforms({
        dotmd: { enabled: false, linkTag: 'always' },
        llmsTxt: {
          sections: [{ title: 'Docs', match: '/docs/**' }],
          defaultSection: false,
          includeDescriptions: true,
        },
        llmsFullTxt: { mode: 'index' },
        urlMap: { enabled: true },
        robotsTxt: { allow: ['GPTBot'] },
        sitemap: { enabled: false },
        sitemapAlias: { outputFilename: 'sitemap.xml' },
        domainProfile: { entityType: 'Organization', sameAs: ['https://example.com'] },
      }),
    ).toBe(true);

    for (const invalid of [
      { dotmd: { enabled: 'yes' } },
      { dotmd: { linkTag: 'sometimes' } },
      { llmsTxt: { includeDescriptions: 'yes' } },
      { llmsFullTxt: { mode: 'some' } },
      { urlMap: { enabled: 'yes' } },
      { robotsTxt: { allow: 'GPTBot' } },
      { sitemap: { enabled: 'yes' } },
      { sitemapAlias: { outputFilename: false } },
      { domainProfile: { entityType: 'Unknown' } },
      { domainProfile: { sameAs: 'https://example.com' } },
    ]) {
      expect(conforms(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });
});

function conforms(value) {
  return matches(value, published);
}

function matches(value, schema) {
  if (schema.$ref) return matches(value, resolveReference(schema.$ref));
  if (schema.anyOf && !schema.anyOf.some((candidate) => matches(value, candidate))) return false;
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;

  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return false;
    if (schema.minimum !== undefined && value < schema.minimum) return false;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.items && value.some((item) => !matches(item, schema.items))) return false;
  }
  if (schema.type === 'object') {
    if (!isObject(value)) return false;
    if (schema.required?.some((key) => !(key in value))) return false;
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        if (!matches(child, schema.properties[key])) return false;
      } else if (schema.additionalProperties === false) {
        return false;
      }
    }
  }
  return true;
}

function resolveReference(reference) {
  if (!reference.startsWith('#/')) throw new Error(`Unsupported schema reference: ${reference}`);
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value[key], published);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

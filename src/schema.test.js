import { describe, expect, test } from 'vitest';
import {
  SchemaGraphError,
  connect,
  createArticle,
  createBlogPosting,
  createBreadcrumbList,
  createEntity,
  createEvent,
  createFAQPage,
  createGraph,
  createHowTo,
  createId,
  createImageObject,
  createLocalBusiness,
  createOffer,
  createOrganization,
  createPerson,
  createProduct,
  createService,
  createSoftwareApplication,
  createVideoObject,
  createWebPage,
  createWebSite,
  deduplicateGraph,
  mergeGraph,
  ref,
  serializeGraph,
  validateGraph,
} from './schema.js';

const pageId = 'https://example.com/docs/page#webpage';

describe('schema entity builders', () => {
  test('all 17 P0 builders own their exact type without inventing facts', () => {
    const builders = [
      [createWebSite, 'WebSite'],
      [createWebPage, 'WebPage'],
      [createPerson, 'Person'],
      [createOrganization, 'Organization'],
      [createArticle, 'Article'],
      [createBlogPosting, 'BlogPosting'],
      [createBreadcrumbList, 'BreadcrumbList'],
      [createImageObject, 'ImageObject'],
      [createVideoObject, 'VideoObject'],
      [createProduct, 'Product'],
      [createSoftwareApplication, 'SoftwareApplication'],
      [createService, 'Service'],
      [createOffer, 'Offer'],
      [createFAQPage, 'FAQPage'],
      [createHowTo, 'HowTo'],
      [createEvent, 'Event'],
      [createLocalBusiness, 'LocalBusiness'],
    ];

    for (const [builder, type] of builders) {
      expect(builder({})).toEqual({ '@type': type });
    }
  });

  test('all P0 builder results merge, validate, and serialize through the public graph API', () => {
    const builders = [
      [createWebSite, 'WebSite'],
      [createWebPage, 'WebPage'],
      [createPerson, 'Person'],
      [createOrganization, 'Organization'],
      [createArticle, 'Article'],
      [createBlogPosting, 'BlogPosting'],
      [createBreadcrumbList, 'BreadcrumbList'],
      [createImageObject, 'ImageObject'],
      [createVideoObject, 'VideoObject'],
      [createProduct, 'Product'],
      [createSoftwareApplication, 'SoftwareApplication'],
      [createService, 'Service'],
      [createOffer, 'Offer'],
      [createFAQPage, 'FAQPage'],
      [createHowTo, 'HowTo'],
      [createEvent, 'Event'],
      [createLocalBusiness, 'LocalBusiness'],
    ];

    for (const [builder, type] of builders) {
      const id = createId(`https://example.com/entities#${type}`);
      const graph = createGraph([
        builder({ '@id': id, name: type }),
        builder({ '@id': id, description: `${type} evidence` }),
      ]);
      expect(graph.entries).toHaveLength(1);
      expect(graph.entries[0].entity).toMatchObject({
        '@id': id,
        '@type': type,
        name: type,
        description: `${type} evidence`,
      });
      expect(validateGraph(graph, { documentCanonical: 'https://example.com/entities' }).valid)
        .toBe(true);
      expect(serializeGraph(graph, { documentCanonical: 'https://example.com/entities' }))
        .toContain(`\"@type\":\"${type}\"`);
    }
  });

  test('builders clone input, preserve facts, and reject owned keywords', () => {
    const input = { name: 'Ada', sameAs: ['https://example.com/ada'] };
    const person = createPerson(input);
    input.sameAs.push('https://example.com/changed');

    expect(person).toEqual({
      '@type': 'Person',
      name: 'Ada',
      sameAs: ['https://example.com/ada'],
    });
    expect(() => createPerson({ '@type': 'Organization' })).toThrow(/owns @type/);
    expect(() => createPerson({ '@context': 'https://schema.org' })).toThrow(/must not contain/);
  });

  test('createEntity accepts arbitrary schema.org types and validates JSON data', () => {
    expect(createEntity({ '@type': 'Dataset', name: 'Evidence' })).toEqual({
      '@type': 'Dataset',
      name: 'Evidence',
    });
    expect(() => createEntity({ name: 'Missing type' })).toThrow(/requires a non-empty @type/);
    expect(() => createEntity({ '@type': 'Thing', score: Number.NaN })).toThrow(/Non-finite/);
  });

  test('validates reserved JSON-LD keywords throughout nested values', () => {
    expect(() => createEntity({
      '@type': 'Article',
      author: { '@type': 'Person', '@context': 'https://other.example', name: 'Ada' },
    })).toThrow(/\/author.*must not contain @context/);
    expect(() => createEntity({
      '@type': 'Article',
      author: { '@id': 42 },
    })).toThrow(/\/author\/@id.*non-empty string/);
    expect(() => createEntity({
      '@type': 'Article',
      author: { '@type': [] },
    })).toThrow(/\/author.*non-empty @type/);
    expect(validateGraph({
      '@type': 'Article',
      author: { '@type': 'Person', '@id': 'javascript:alert(1)' },
    })).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'schema.invalid-graph' })],
    });
  });
});

describe('schema IDs and references', () => {
  test('createId normalizes absolute IDs and resolves only against an explicit base', () => {
    expect(createId('#person', 'https://EXAMPLE.com/about')).toBe(
      'https://example.com/about#person',
    );
    expect(createId('urn:isbn:9780140328721')).toBe('urn:isbn:9780140328721');
    expect(() => createId('#person')).toThrow(/explicit absolute base/);
    expect(() => createId('https://user:secret@example.com/id')).toThrow(/credentials/);
    expect(() => createId('javascript:alert(1)')).toThrow(/unsafe scheme/);
    expect(() => createId('http://localhost/id')).toThrow(/loopback/);
    expect(() => createId('https://127.12.34.56/id')).toThrow(/loopback/);
    expect(() => createId('http://[::ffff:127.0.0.1]/id')).toThrow(/loopback/);
    expect(() => createId('http://0.0.0.0/id')).toThrow(/loopback/);
  });

  test('ref and connect create ID-only relations without mutating either entity', () => {
    const person = createPerson({ '@id': createId('https://example.com/#ada'), name: 'Ada' });
    const page = createWebPage({ '@id': createId(pageId), name: 'Page' });
    const connected = connect(page, 'author', person);
    const duplicate = connect(connected, 'author', person);
    const replacement = connect(duplicate, 'author', createId('https://example.com/#grace'), {
      mode: 'replace',
    });

    expect(page).not.toHaveProperty('author');
    expect(ref(person)).toEqual({ '@id': 'https://example.com/#ada' });
    expect(connected.author).toEqual({ '@id': 'https://example.com/#ada' });
    expect(duplicate.author).toEqual({ '@id': 'https://example.com/#ada' });
    expect(replacement.author).toEqual({ '@id': 'https://example.com/#grace' });
    expect(() => ref(createPerson({ name: 'Anonymous' }))).toThrow(/Schema ID/);
  });
});

describe('graph merging and ownership', () => {
  test('same-ID entities merge recursively and arrays deduplicate in semantic order', () => {
    const graph = mergeGraph([
      createWebPage({
        '@id': createId(pageId),
        name: 'Page',
        keywords: ['first', 'shared', 'first'],
        publisher: {
          '@type': 'Organization',
          '@id': 'https://example.com/#org',
          name: 'Example',
        },
      }),
      createWebPage({
        '@id': createId(pageId),
        description: 'Description',
        keywords: ['shared', 'last'],
        publisher: {
          '@type': 'Organization',
          '@id': 'https://example.com/#org',
          url: 'https://example.com/',
        },
      }),
    ]);

    expect(graph.entries).toHaveLength(1);
    expect(graph.entries[0].entity).toMatchObject({
      name: 'Page',
      description: 'Description',
      keywords: ['first', 'shared', 'last'],
      publisher: {
        '@id': 'https://example.com/#org',
        '@type': 'Organization',
        name: 'Example',
        url: 'https://example.com/',
      },
    });
    expect(graph.conflicts).toEqual([]);
  });

  test('nested entity types merge as additive JSON-LD types', () => {
    const graph = mergeGraph([
      createWebPage({
        '@id': createId(pageId),
        publisher: {
          '@type': 'Organization',
          '@id': 'https://example.com/#org',
        },
      }),
      createWebPage({
        '@id': createId(pageId),
        publisher: {
          '@type': ['Organization', 'Corporation'],
          '@id': 'https://example.com/#org',
        },
      }),
    ]);

    expect(graph.entries[0].entity.publisher['@type']).toEqual([
      'Organization',
      'Corporation',
    ]);
    expect(graph.conflicts).toEqual([]);
    expect(validateGraph(graph).valid).toBe(true);
  });

  test('scalar conflicts error by default and support explicit first and last policies', () => {
    const inputs = [
      createWebPage({ '@id': createId(pageId), name: 'First' }),
      createWebPage({ '@id': createId(pageId), name: 'Last' }),
    ];
    const unresolved = mergeGraph(inputs);
    const first = mergeGraph(inputs, { conflictPolicy: 'first' });
    const last = mergeGraph(inputs, { conflictPolicy: 'last' });

    expect(unresolved.conflicts[0]).toMatchObject({
      entityId: pageId,
      pointer: '/name',
      policy: 'error',
      resolution: 'unresolved',
    });
    expect(validateGraph(unresolved).valid).toBe(false);
    expect(() => serializeGraph(unresolved)).toThrow(SchemaGraphError);
    expect(first.entries[0].entity.name).toBe('First');
    expect(first.conflicts[0].resolution).toBe('first');
    expect(validateGraph(first).valid).toBe(true);
    expect(last.entries[0].entity.name).toBe('Last');
    expect(last.conflicts[0].resolution).toBe('last');
    expect(validateGraph(last).valid).toBe(true);
  });

  test('authored facts and IDs outrank inferred singleton-role candidates', () => {
    const graph = createGraph([
      {
        entity: createWebPage({
          '@id': createId('https://example.com/docs/page#generated'),
          name: 'Generated',
          description: 'Inferred description',
        }),
        roles: 'page',
        provenance: { source: 'inference' },
      },
      {
        entity: createWebPage({
          '@id': createId(pageId),
          name: 'Authored',
        }),
        roles: 'page',
        provenance: { source: 'authored-jsonld' },
      },
    ]);

    expect(graph.entries).toHaveLength(1);
    expect(graph.entries[0].entity).toMatchObject({
      '@id': pageId,
      name: 'Authored',
      description: 'Inferred description',
    });
    expect(graph.conflicts).toEqual([]);
  });

  test('anonymous exact duplicates collapse but distinct anonymous entities remain ordered', () => {
    const first = createPerson({ name: 'Ada' });
    const second = createPerson({ name: 'Grace' });
    const graph = deduplicateGraph([first, first, second]);

    expect(graph.entries.map((entry) => entry.entity.name)).toEqual(['Ada', 'Grace']);
  });
});

describe('graph validation and serialization', () => {
  test('same-document and known same-site references must resolve', () => {
    const unresolved = createGraph([
      createWebPage({
        '@id': createId(pageId),
        author: ref(createId('https://example.com/docs/page#missing')),
      }),
    ]);
    const sameDocument = validateGraph(unresolved, {
      documentCanonical: 'https://example.com/docs/page',
      siteUrl: 'https://example.com/docs/',
    });
    expect(sameDocument.findings).toContainEqual(
      expect.objectContaining({ code: 'schema.unresolved-reference', severity: 'error' }),
    );

    const crossPage = createGraph([
      createWebPage({
        '@id': createId(pageId),
        isPartOf: ref(createId('https://example.com/docs/#website')),
      }),
    ]);
    expect(
      validateGraph(crossPage, {
        documentCanonical: 'https://example.com/docs/page',
        siteUrl: 'https://example.com/docs/',
        knownEntityIds: ['https://example.com/docs/#website'],
      }).valid,
    ).toBe(true);
  });

  test('external IDs and reference cycles are valid without fetching', () => {
    const firstId = createId('https://example.com/#first');
    const secondId = createId('https://example.com/#second');
    const graph = createGraph([
      createPerson({ '@id': firstId, knows: ref(secondId), sameAs: ['https://outside.example/id'] }),
      createPerson({ '@id': secondId, knows: ref(firstId) }),
    ]);
    expect(
      validateGraph(graph, {
        documentCanonical: 'https://example.com/',
        siteUrl: 'https://example.com/',
      }).valid,
    ).toBe(true);
  });

  test('unsafe URLs, object cycles, and prototype keys fail closed', () => {
    const unsafe = validateGraph(createThing({ url: 'javascript:alert(1)' }));
    expect(unsafe).toMatchObject({ valid: false });
    expect(unsafe.findings).toContainEqual(expect.objectContaining({ code: 'schema.unsafe-url' }));

    const cyclic = { '@type': 'Thing' };
    cyclic.self = cyclic;
    expect(() => createGraph(cyclic)).toThrow(/Cyclic/);
    expect(validateGraph(cyclic)).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'schema.invalid-graph' })],
    });

    const polluted = JSON.parse('{"@type":"Thing","__proto__":{"polluted":true}}');
    expect(() => createEntity(polluted)).toThrow(/invalid/);
    expect({}.polluted).toBeUndefined();
  });

  test('distinguishes relative Schema URLs that only lack documentCanonical', () => {
    const relative = validateGraph(createBreadcrumbList({
      itemListElement: [{
        '@type': 'ListItem',
        position: 1,
        name: 'Documentation',
        item: '/docs/',
      }],
    }));
    expect(relative.findings).toContainEqual(expect.objectContaining({
      code: 'schema.relative-url-base-missing',
      message: 'Relative Schema URL requires documentCanonical',
      pointer: '/itemListElement/0/item',
    }));

    const withBase = validateGraph(relative.graph, {
      documentCanonical: 'https://example.com/guide',
    });
    expect(withBase.findings).not.toContainEqual(expect.objectContaining({
      code: 'schema.relative-url-base-missing',
    }));

    const malformed = validateGraph(createEntity({
      '@type': 'Dataset',
      contentUrl: 'https://[invalid',
    }));
    expect(malformed.findings).toContainEqual(expect.objectContaining({
      code: 'schema.unsafe-url',
      pointer: '/contentUrl',
    }));
  });

  test.each([
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['credentials', 'https://user:secret@example.com/docs/page'],
    ['loopback host', 'http://127.0.0.1/docs/page'],
  ])('rejects unsafe BreadcrumbList item URLs using a %s', (_label, item) => {
    const result = validateGraph(
      createBreadcrumbList({
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Documentation',
            item,
          },
        ],
      }),
      { documentCanonical: 'https://example.com/docs/' },
    );

    expect(result.valid).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'schema.unsafe-url',
        pointer: '/itemListElement/0/item',
      }),
    );
  });

  test('validates URL-valued arbitrary entities while preserving text and entity references', () => {
    const targetId = createId('#target', 'https://example.com/docs/');
    const graph = createGraph([
      createBreadcrumbList({
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Documentation',
            item: '/docs/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Target',
            item: ref(targetId),
          },
        ],
      }),
      createWebPage({ '@id': targetId, name: 'Target' }),
      createEntity({
        '@type': 'Dataset',
        category: 'JavaScript: programming language',
        genre: 'data journalism',
        termsOfService: 'Standard terms apply',
        distribution: {
          '@type': 'DataDownload',
          contentUrl: 'https://cdn.example.com/data.csv',
        },
      }),
    ]);

    const normalized = validateGraph(graph, { documentCanonical: 'https://example.com/docs/' });
    expect(normalized).toMatchObject({ valid: true, findings: [] });
    expect(normalized.graph.entries[0].entity.itemListElement[0].item)
      .toBe('https://example.com/docs/');

    const unsafeTypedUrl = validateGraph(
      createEntity({
        '@type': 'Dataset',
        identifier: { '@type': 'URL', '@value': 'data:text/html,unsafe' },
      }),
      { documentCanonical: 'https://example.com/docs/' },
    );
    expect(unsafeTypedUrl.findings).toContainEqual(
      expect.objectContaining({
        code: 'schema.unsafe-url',
        pointer: '/identifier/@value',
      }),
    );

    const unsafeUrlLikeText = validateGraph(
      createEntity({ '@type': 'Dataset', category: 'javascript:alert(1)' }),
      { documentCanonical: 'https://example.com/docs/' },
    );
    expect(unsafeUrlLikeText.findings).toContainEqual(
      expect.objectContaining({ code: 'schema.unsafe-url', pointer: '/category' }),
    );
  });

  test('normalizes relative URL scalars, arrays, and typed values without changing plain text', () => {
    const result = validateGraph(createEntity({
      '@type': 'Dataset',
      image: [
        'cover.jpg',
        { '@type': 'ImageObject', contentUrl: './large.jpg' },
      ],
      identifier: { '@type': 'URL', '@value': '?download=1' },
      category: 'JavaScript programming',
      genre: 'data journalism',
    }), { documentCanonical: 'https://example.com/articles/one' });

    expect(result.valid).toBe(true);
    expect(result.graph.entries[0].entity).toMatchObject({
      image: [
        'https://example.com/articles/cover.jpg',
        { '@type': 'ImageObject', contentUrl: 'https://example.com/articles/large.jpg' },
      ],
      identifier: { '@type': 'URL', '@value': 'https://example.com/articles/one?download=1' },
      category: 'JavaScript programming',
      genre: 'data journalism',
    });
  });

  test('serialization is deterministic, XSS-safe, and excludes graph metadata', () => {
    const graph = createGraph([
      {
        entity: createThing({
          '@id': createId('https://example.com/#thing'),
          name: 'Name',
          description: '</script>&\u2028\u2029',
        }),
        roles: 'supporting',
        provenance: {
          source: 'plugin',
          plugin: 'secret-plugin',
          pathname: '/private-source-name',
        },
      },
    ]);
    const serialized = serializeGraph(graph);

    expect(serialized).toBe(
      '{"@context":"https://schema.org","@graph":[{"@id":"https://example.com/#thing","@type":"Thing","description":"\\u003c/script\\u003e\\u0026\\u2028\\u2029","name":"Name"}]}',
    );
    expect(serialized).not.toContain('roles');
    expect(serialized).not.toContain('provenance');
    expect(serialized).not.toContain('secret-plugin');
    expect(serialized).not.toContain('private-source-name');
  });
});

function createThing(input) {
  return createEntity({ '@type': 'Thing', ...input });
}

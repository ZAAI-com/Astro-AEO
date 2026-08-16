import { describe, expect, test } from 'vitest';
import { catalogBreadcrumbTrail } from './catalog-breadcrumbs.js';

const site = { siteUrl: 'https://example.com', base: '/docs', trailingSlash: 'never' };

describe('catalog breadcrumb ancestry', () => {
  test('uses only a complete authored catalog chain with stable canonicals', () => {
    expect(catalogBreadcrumbTrail('/guides/install', [
      { pathname: '/', title: 'Home' },
      { pathname: '/guides', title: 'Guides' },
      { pathname: '/guides/install', title: 'Install' },
    ], site)).toEqual([
      { name: 'Home', item: 'https://example.com/docs/' },
      { name: 'Guides', item: 'https://example.com/docs/guides' },
      { name: 'Install', item: 'https://example.com/docs/guides/install' },
    ]);
  });

  test.each([
    [
      'a missing ancestor',
      [
        { pathname: '/', title: 'Home' },
        { pathname: '/guides/install', title: 'Install' },
      ],
    ],
    [
      'a blank authored title',
      [
        { pathname: '/', title: 'Home' },
        { pathname: '/guides', title: '   ' },
        { pathname: '/guides/install', title: 'Install' },
      ],
    ],
  ])('declines instead of deriving labels when the catalog has %s', (_label, descriptors) => {
    expect(catalogBreadcrumbTrail('/guides/install', descriptors, site)).toBeNull();
  });

  test('declines without a stable configured site and never uses loopback identities', () => {
    const descriptors = [
      { pathname: '/', title: 'Home' },
      { pathname: '/guides', title: 'Guides' },
    ];
    expect(catalogBreadcrumbTrail('/guides', descriptors, { ...site, siteUrl: '' })).toBeNull();
    expect(catalogBreadcrumbTrail('/guides', descriptors, {
      ...site,
      siteUrl: 'http://localhost:4321',
    })).toBeNull();
  });

  test('matches encoded catalog paths without turning path text into a label', () => {
    expect(catalogBreadcrumbTrail('/guides/café', [
      { pathname: '/', title: 'Start' },
      { pathname: '/guides', title: 'Reference' },
      { pathname: '/guides/caf%C3%A9', title: 'Authored café title' },
    ], { ...site, base: '' })).toEqual([
      { name: 'Start', item: 'https://example.com/' },
      { name: 'Reference', item: 'https://example.com/guides' },
      { name: 'Authored café title', item: 'https://example.com/guides/caf%C3%A9' },
    ]);
  });
});

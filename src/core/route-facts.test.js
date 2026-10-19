import { expect, test } from 'vitest';
import { routePatternFor } from './route-facts.js';

test('route mechanics retain patterns without leaking concrete slugs', () => {
  const routes = [{ pattern: /^\/docs\/[^/]+\/?$/g, routePattern: '/docs/[slug]' }];
  expect(routePatternFor('/docs/private-slug/', routes)).toBe('/docs/[slug]');
  expect(routePatternFor('/docs/other/', routes)).toBe('/docs/[slug]');
  expect(routePatternFor('/outside', routes)).toBeUndefined();
});

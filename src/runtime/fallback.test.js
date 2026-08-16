import { describe, expect, test } from 'vitest';
import { GET, HEAD } from './fallback.js';

describe('adapter-visible fallback endpoint', () => {
  test.each([GET, HEAD])('declines only after pre-middleware with a bodyless no-store 404', async (handler) => {
    const response = handler();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});

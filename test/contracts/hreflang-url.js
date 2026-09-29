// @ts-check

/**
 * One hreflang URL table for the build and runtime normalizer
 * (`src/core/locale.js`) and the sitemap validator
 * (`src/build/sitemap-validate.js`), so the two cannot disagree. `context` is
 * the origin the page or sitemap entry is served from. Plain `http:` is allowed
 * only on a local development host and only from a local context; credentials,
 * fragments and other schemes never are.
 *
 * @type {ReadonlyArray<{ name: string; context: string; url: string; allowed: boolean }>}
 */
export const HREFLANG_URL_CONTRACT = Object.freeze([
  { name: 'https from a public page', context: 'https://example.test', url: 'https://example.test/fr/', allowed: true },
  { name: 'localhost http from a localhost page', context: 'http://localhost:4321', url: 'http://localhost:4321/fr/', allowed: true },
  { name: '127.0.0.1 http from a 127.0.0.1 page', context: 'http://127.0.0.1:4321', url: 'http://127.0.0.1:4321/fr/', allowed: true },
  { name: '[::1] http from a [::1] page', context: 'http://[::1]:4321', url: 'http://[::1]:4321/fr/', allowed: true },
  { name: 'another loopback spelling from a local page', context: 'http://localhost:4321', url: 'http://127.0.0.1:4321/fr/', allowed: true },
  { name: 'long-form IPv6 loopback from a local page', context: 'http://localhost:4321', url: 'http://[0:0:0:0:0:0:0:1]:4321/fr/', allowed: true },
  { name: 'https from a local page', context: 'http://localhost:4321', url: 'https://example.test/fr/', allowed: true },
  { name: 'localhost http from a public page', context: 'https://example.test', url: 'http://localhost:4321/fr/', allowed: false },
  { name: 'public http from a local page', context: 'http://localhost:4321', url: 'http://example.test/fr/', allowed: false },
  { name: 'public http from a public page', context: 'https://example.test', url: 'http://example.test/fr/', allowed: false },
  { name: 'credentials on localhost', context: 'http://localhost:4321', url: 'http://user:secret@localhost:4321/fr/', allowed: false },
  { name: 'fragment on localhost', context: 'http://localhost:4321', url: 'http://localhost:4321/fr/#top', allowed: false },
  { name: 'credentials on https', context: 'https://example.test', url: 'https://user:secret@example.test/fr/', allowed: false },
  { name: 'fragment on https', context: 'https://example.test', url: 'https://example.test/fr/#top', allowed: false },
  { name: 'subdomain of localhost', context: 'http://localhost:4321', url: 'http://app.localhost:4321/fr/', allowed: false },
  { name: 'other 127/8 address', context: 'http://localhost:4321', url: 'http://127.0.0.2:4321/fr/', allowed: false },
  { name: 'trailing-dot localhost', context: 'http://localhost:4321', url: 'http://localhost.:4321/fr/', allowed: false },
  { name: 'non-HTTP scheme on localhost', context: 'http://localhost:4321', url: 'ftp://localhost/fr/', allowed: false },
]);

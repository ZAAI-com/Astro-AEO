import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  createCorpusManifest,
  serializeCorpusManifest,
  sha256Digest,
  sha256Hex,
} from './corpus-manifest.js';

describe('canonical corpus data', () => {
  test('sorts object keys recursively and preserves array order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, 1] } })).toBe('{"a":{"x":[3,1],"y":2},"z":1}');
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow(/non-finite/);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/);
  });

  test('hashes exact UTF-8 bytes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Digest('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('CorpusManifestV1', () => {
  test('hashes source bytes, normalizes Markdown LF, and sorts all records', async () => {
    const manifest = await createCorpusManifest({
      origin: 'https://example.com',
      base: '/docs',
      tokenizer: { name: 'astro-aeo-approx', version: '1', approximate: true },
      locales: [
        { origin: 'https://example.com', locale: 'fr', language: 'fr', canonicalArtifact: '/docs/fr/llms.txt' },
        { origin: 'https://example.com', locale: 'en', language: 'en', canonicalArtifact: '/docs/en/llms.txt' },
      ],
      pages: [
        {
          origin: 'https://example.com', id: '/z', canonicalUrl: 'https://example.com/z', markdownUrl: '/z.md',
          locale: 'en', language: 'en', section: 'Pages', tokenCount: 1, sourceStrategy: 'rendered', chunks: ['/b', '/a'], markdown: 'a\r\nb',
        },
      ],
      artifacts: [
        {
          origin: 'https://example.com', pathname: '/z.txt', kind: 'index', locale: 'en', section: null,
          part: null, tokenCount: 1, encoding: 'identity', sourcePathname: null, contents: 'bytes',
        },
      ],
    });
    expect(manifest.locales.map((entry) => entry.locale)).toEqual(['en', 'fr']);
    expect(manifest.pages[0].chunks).toEqual(['/a', '/b']);
    expect(manifest.pages[0].hash).toBe(await sha256Digest('a\nb'));
    expect(manifest.artifacts[0].hash).toBe(await sha256Digest('bytes'));
    expect(serializeCorpusManifest(manifest)).toMatch(/^\{\n  "version": 1,/);
    expect(serializeCorpusManifest(manifest).endsWith('\n')).toBe(true);
    expect(serializeCorpusManifest(manifest)).not.toContain('"markdown":');
    expect(serializeCorpusManifest(manifest)).not.toContain('"contents":');
  });
});

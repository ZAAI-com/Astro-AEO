import { expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { corpusPathname, corpusRoutePatterns, isPotentialCorpusArtifactPath } from './corpus-topology.js';

test('inserts archives underneath existing locale prefixes, leaving current paths untouched', () => {
  const identity = { version: 'v1', current: 'v2', locale: 'fr' };
  expect(corpusPathname('/fr/llms.txt', identity)).toBe('/fr/v1/llms.txt');
  expect(corpusPathname('/fr/llms/guide-0001.txt', identity)).toBe('/fr/v1/llms/guide-0001.txt');
  expect(corpusPathname('/llms-fr.txt', identity)).toBe('/v1/llms-fr.txt');
  expect(corpusPathname('/llms/rag.jsonl', identity)).toBe('/v1/llms/rag.jsonl');
  expect(corpusPathname('/fr/llms.txt', { ...identity, version: 'v2' })).toBe('/fr/llms.txt');
  expect(() => corpusPathname('/llms.txt', { ...identity, version: '../bad' })).toThrow(/Unsafe/);
});

test.each(['auto', 'global', 'locale', 'both'])('uses one %s topology for ownership and injected routes', (indexes) => {
  const config = resolveConfig({ i18n: { indexes }, corpus: { versions: { current: 'v2' },
    chunks: { enabled: true }, small: { enabled: true }, manifest: { enabled: true },
    compression: { gzip: true }, rag: { enabled: true, publish: true } } });
  const patterns = corpusRoutePatterns(config);
  expect(new Set(patterns).size).toBe(patterns.length);
  const samples = indexes === 'global' ? ['/v1/llms.txt', '/v1/llms/guide-0001.txt', '/v1/llms/rag.jsonl']
    : ['/fr/v1/llms.txt', '/fr/v1/llms/guide-0001.txt', '/fr/v1/llms/rag.jsonl'];
  samples.push('/v1/llms/manifest.json');
  if (indexes === 'both') samples.push('/v1/llms-fr.txt');
  for (const pathname of samples) {
    expect(isPotentialCorpusArtifactPath(pathname, config)).toBe(true);
    const matches = patterns.some((pattern) => new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, '[^/]+').replace(/\.txt/g, '\\.txt').replace(/\.json/g, '\\.json')}$`).test(pathname));
    expect(matches, pathname).toBe(true);
  }
  expect(isPotentialCorpusArtifactPath('/fr/v1/llms.txt.gz', config)).toBe(indexes !== 'global');
  expect(isPotentialCorpusArtifactPath('/fr/v2/llms.txt', config)).toBe(false);
  expect(isPotentialCorpusArtifactPath('/v1/fr/llms.txt', config)).toBe(indexes !== 'global'); // May be locale v1, archive fr.
  expect(isPotentialCorpusArtifactPath('/fr/../llms.txt', config)).toBe(false);
});

test('disabled version, gzip and RAG families cannot claim archive-shaped paths', () => {
  const config = resolveConfig({ i18n: { indexes: 'global' } });
  expect(isPotentialCorpusArtifactPath('/v1/llms.txt', config)).toBe(false);
  expect(isPotentialCorpusArtifactPath('/llms.txt.gz', config)).toBe(false);
  expect(isPotentialCorpusArtifactPath('/llms/rag.jsonl', config)).toBe(false);
});

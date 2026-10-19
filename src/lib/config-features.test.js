import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../config.js';
import { AeoConfigError } from './errors.js';
import { setPath } from './config-migrate.js';
import { runtimeConfigProjection, toSource } from '../virtual/serialize.js';

describe('1.6 configuration contracts', () => {
  test('new features are opt-in and analytics never enters the ordinary runtime projection', () => {
    const defaults = resolveConfig();
    expect(defaults.markdown.cacheControl).toBeUndefined();
    expect(defaults.corpus.versions).toBeUndefined();
    expect(defaults.corpus.rag).toEqual({ enabled: false, maxTokens: 512, publish: false });
    expect(defaults.analytics).toEqual({ enabled: false, scope: 'agents', sampleRate: 1, strict: false,
      adapter: { type: 'console' }, privacy: { ip: 'omit', query: 'omit', referrer: 'omit' } });
    const source = toSource(runtimeConfigProjection(defaults));
    expect(source).toBe(toSource(runtimeConfigProjection(resolveConfig({ analytics: { enabled: false } }))));
    expect(source).not.toContain('analytics');
    expect(toSource(runtimeConfigProjection(resolveConfig({ analytics: { enabled: true,
      adapter: { type: 'webhook', url: 'https://events.example.test', headers: { Authorization: { env: 'SECRET', prefix: 'Bearer ' } } } } })))).not.toContain('SECRET');
  });

  test('copies version ordering and preserves runtime secret references without reading them', () => {
    const versions = { current: 'v2', order: ['v1'] };
    const config = resolveConfig({ corpus: { versions }, analytics: { enabled: true, sampleRate: 0,
      adapter: { type: 'webhook', url: 'https://events.example.test', headers: { Authorization: { env: 'AEO_SECRET', prefix: 'Bearer ' } } } } });
    versions.order.push('v0');
    expect(config.corpus.versions).toEqual({ current: 'v2', order: ['v1'] });
    expect(config.analytics.sampleRate).toBe(0);
    expect(config.analytics.adapter.headers.Authorization).toEqual({ env: 'AEO_SECRET', prefix: 'Bearer ' });
  });

  test.each([
    ['markdown.cacheControl', 'public\r\nX: secret'], ['markdown.cacheControl', ''],
    ['markdown.negotiation', 'typo'], ['markdown.frontmatter', 'false'],
    ['metadata.fillMissing', 1], ['schema.autoInject', null], ['site.profile.enabled', 'true'],
    ['corpus.full.mode', 'typo'], ['corpus.versions.current', '../v1'],
    ['corpus.versions.order', ['v1', 'v1']], ['corpus.rag.enabled', 1], ['corpus.rag.maxTokens', 0],
    ['corpus.rag.publish', 'false'], ['analytics.enabled', 'yes'], ['analytics.scope', 'bots'],
    ['analytics.sampleRate', -0.1], ['analytics.sampleRate', 1.1], ['analytics.sampleRate', NaN],
    ['analytics.strict', null], ['analytics.privacy.ip', 'hash'], ['analytics.privacy.referrer', true],
    ['analytics.adapter.type', 'unsupported'], ['analytics.adapter.url', 'http://events.example.test'],
    ['analytics.adapter.url', 'https://user:secret@events.example.test'],
    ['analytics.adapter.headers.Authorization', 'secret'],
    ['analytics.adapter.headers.Authorization.env', 'invalid name'],
    ['analytics.adapter.headers.Authorization.prefix', 'Bearer\n'],
  ])('rejects invalid %s with its path', (path, value) => {
    const config = { corpus: { versions: { current: 'v2' } }, analytics: { adapter: { type: 'webhook', url: 'https://events.example.test', headers: { Authorization: { env: 'AEO_SECRET' } } } } };
    setPath(config, path, value);
    expect(() => resolveConfig(config)).toThrow(AeoConfigError);
    expect(() => resolveConfig(config)).toThrow(path);
  });

  test('rejects missing current only when version partitioning is explicitly configured', () => {
    expect(() => resolveConfig({ corpus: { versions: {} } })).toThrow('corpus.versions.current');
    expect(resolveConfig().corpus.versions).toBeUndefined();
  });

  test('module adapters require local imports and strict JSON', () => {
    expect(() => resolveConfig({ analytics: { adapter: { type: 'module', module: 'https://example.test/adapter.js' } } })).toThrow('analytics.adapter.module');
    expect(() => resolveConfig({ analytics: { adapter: { type: 'module', module: './adapter.js', options: { fn() {} } } } })).toThrow('analytics.adapter.options');
    expect(resolveConfig({ analytics: { adapter: { type: 'module', module: new URL('file:///tmp/adapter.js'), options: { safe: true } } } }).analytics.adapter.module).toBe('file:///tmp/adapter.js');
  });
});

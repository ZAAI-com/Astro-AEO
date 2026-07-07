import { test, expect, describe } from 'vitest';
import { buildDomainProfile } from './domain-profile.js';
import { resolveConfig } from '../config.js';

describe('buildDomainProfile', () => {
  test('omits empty fields, includes sameAs', () => {
    const config = resolveConfig({
      domainProfile: {
        enabled: true,
        name: 'Acme',
        entityType: 'Person',
        sameAs: ['https://github.com/acme'],
      },
    });
    const profile = buildDomainProfile(config, 'https://acme.dev');
    expect(profile).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Acme',
      url: 'https://acme.dev',
      sameAs: ['https://github.com/acme'],
    });
  });

  test('website overrides siteUrl fallback', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', website: 'https://other.dev' } });
    expect(buildDomainProfile(config, 'https://acme.dev').url).toBe('https://other.dev');
  });
});

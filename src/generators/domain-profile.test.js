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

  test('an email value is emitted as schema.org email', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', email: 'hi@acme.dev' } });
    expect(buildDomainProfile(config, 'https://acme.dev').email).toBe('hi@acme.dev');
  });

  test('an http(s) contact value becomes a contactPoint', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', email: 'https://acme.dev/contact' } });
    const profile = buildDomainProfile(config, 'https://acme.dev');
    expect(profile.contactPoint).toEqual({ '@type': 'ContactPoint', url: 'https://acme.dev/contact' });
    expect(profile.email).toBeUndefined();
  });

  test('a bare (non-email, non-url) value becomes telephone', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', email: '+1-555-0100' } });
    const profile = buildDomainProfile(config, 'https://acme.dev');
    expect(profile.telephone).toBe('+1-555-0100');
    expect(profile.email).toBeUndefined();
  });

  test('the deprecated contact alias still resolves and branches', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme', contact: 'hi@acme.dev' } });
    expect(buildDomainProfile(config, 'https://acme.dev').email).toBe('hi@acme.dev');
  });

  test('a non-string email is ignored instead of throwing', () => {
    const config = resolveConfig({ domainProfile: { enabled: true, name: 'Acme' } });
    config.domainProfile.email = /** @type {any} */ (42);
    const profile = buildDomainProfile(config, 'https://acme.dev');
    expect(profile.email).toBeUndefined();
    expect(profile.telephone).toBeUndefined();
    expect(profile.contactPoint).toBeUndefined();
  });
});

import { describe, expect, test } from 'vitest';
import {
  allowedDomainsWarning,
  hostnamesMissingFromAllowedDomains,
  isHostnameAllowed,
} from './allowed-domains.js';

describe('isHostnameAllowed', () => {
  test('matches an exact hostname case-insensitively', () => {
    expect(isHostnameAllowed('shop.example.com', [{ hostname: 'shop.example.com' }])).toBe(true);
    expect(isHostnameAllowed('Shop.Example.com', [{ hostname: 'shop.example.COM' }])).toBe(true);
    expect(isHostnameAllowed('shop.example.com', [{ hostname: 'example.com' }])).toBe(false);
  });

  test('*. allows exactly one subdomain level', () => {
    const allowed = [{ hostname: '*.example.com' }];
    expect(isHostnameAllowed('shop.example.com', allowed)).toBe(true);
    expect(isHostnameAllowed('a.shop.example.com', allowed)).toBe(false);
    expect(isHostnameAllowed('example.com', allowed)).toBe(false);
    expect(isHostnameAllowed('badexample.com', allowed)).toBe(false);
  });

  test('**. allows any subdomain depth but not the apex', () => {
    const allowed = [{ hostname: '**.example.com' }];
    expect(isHostnameAllowed('shop.example.com', allowed)).toBe(true);
    expect(isHostnameAllowed('a.shop.example.com', allowed)).toBe(true);
    expect(isHostnameAllowed('example.com', allowed)).toBe(false);
  });

  test('an entry without a hostname allows every host, as Astro does', () => {
    expect(isHostnameAllowed('shop.example.com', [{ protocol: 'https' }])).toBe(true);
  });

  test('ignores protocol and port so a partial match never warns', () => {
    expect(
      isHostnameAllowed('shop.example.com', [{ hostname: 'shop.example.com', protocol: 'http', port: '8080' }]),
    ).toBe(true);
  });

  test('treats missing or malformed configuration as not allowed', () => {
    expect(isHostnameAllowed('shop.example.com', undefined)).toBe(false);
    expect(isHostnameAllowed('shop.example.com', [])).toBe(false);
    expect(isHostnameAllowed('shop.example.com', [null, 'shop.example.com', { hostname: 7 }])).toBe(false);
  });
});

describe('hostnamesMissingFromAllowedDomains', () => {
  test('lists each uncovered hostname once, in order', () => {
    expect(
      hostnamesMissingFromAllowedDomains(
        ['https://example.com', 'https://fr.example.com', 'https://example.com/', 'https://de.example.com'],
        [{ hostname: 'fr.example.com' }],
      ),
    ).toEqual(['example.com', 'de.example.com']);
  });

  test('returns nothing when every hostname is covered', () => {
    expect(
      hostnamesMissingFromAllowedDomains(['https://example.com', 'https://fr.example.com'], [
        { hostname: 'example.com' },
        { hostname: '*.example.com' },
      ]),
    ).toEqual([]);
  });

  test('skips origins that do not parse', () => {
    expect(hostnamesMissingFromAllowedDomains(['not a url', ''], [])).toEqual([]);
  });
});

describe('allowedDomainsWarning', () => {
  test('names the hostnames and gives a paste-ready block', () => {
    const message = allowedDomainsWarning(['example.com', 'fr.example.com']);
    expect(message).toContain('example.com, fr.example.com are not listed');
    expect(message).toContain(
      "security: { allowedDomains: [{ hostname: 'example.com' }, { hostname: 'fr.example.com' }] },",
    );
    expect(message).not.toContain('\u2014');
  });

  test('uses the singular for one hostname', () => {
    expect(allowedDomainsWarning(['example.com'])).toContain('example.com is not listed, so requests for it');
  });
});

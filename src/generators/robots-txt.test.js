import { test, expect, describe } from 'vitest';
import { buildRobotsTxt } from './robots-txt.js';
import { resolveConfig } from '../config.js';

describe('buildRobotsTxt', () => {
  test('allow then disallow, with sitemap and llms hints', () => {
    const config = resolveConfig({
      robotsTxt: { enabled: true, allow: ['Googlebot'], disallow: ['GPTBot'] },
    });
    const out = buildRobotsTxt(config, 'https://x.com');
    expect(out).toContain('User-agent: Googlebot\nAllow: /');
    expect(out).toContain('User-agent: GPTBot\nDisallow: /');
    expect(out).toContain('Sitemap: https://x.com/sitemap-index.xml');
    expect(out).toContain('# llms.txt: https://x.com/llms.txt');
    expect(out.indexOf('Googlebot')).toBeLessThan(out.indexOf('GPTBot'));
  });

  test('wildcard fallback when no bots configured', () => {
    const config = resolveConfig({ robotsTxt: { enabled: true } });
    const out = buildRobotsTxt(config, 'https://x.com');
    expect(out).toContain('User-agent: *\nAllow: /');
  });

  test('custom sitemapPath and extraLines', () => {
    const config = resolveConfig({
      robotsTxt: { enabled: true, sitemapPath: '/sitemap.xml', extraLines: ['# custom'] },
    });
    const out = buildRobotsTxt(config, 'https://x.com');
    expect(out).toContain('Sitemap: https://x.com/sitemap.xml');
    expect(out.trimEnd().endsWith('# custom')).toBe(true);
  });

  test('base path is prefixed onto the sitemap and llms.txt urls', () => {
    const config = resolveConfig({ robotsTxt: { enabled: true } });
    const out = buildRobotsTxt(config, 'https://x.com', '/docs');
    expect(out).toContain('Sitemap: https://x.com/docs/sitemap-index.xml');
    expect(out).toContain('# llms.txt: https://x.com/docs/llms.txt');
    // a trailing slash on base is normalized away
    const out2 = buildRobotsTxt(config, 'https://x.com', '/docs/');
    expect(out2).toContain('Sitemap: https://x.com/docs/sitemap-index.xml');
  });

  test('empty base leaves the urls unprefixed', () => {
    const config = resolveConfig({ robotsTxt: { enabled: true } });
    const out = buildRobotsTxt(config, 'https://x.com', '');
    expect(out).toContain('Sitemap: https://x.com/sitemap-index.xml');
    expect(out).toContain('# llms.txt: https://x.com/llms.txt');
  });
});

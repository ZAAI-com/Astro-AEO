import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createArtifactWriter } from '../build/artifacts.js';
import { resolveConfig } from '../config.js';
import { finalizeSitemapOutputs } from './sitemap-finalize.js';

describe('finalizeSitemapOutputs', () => {
  /** @type {string} */
  let dir;
  /** @type {URL} */
  let distDir;
  /** @type {string[]} */
  let warnings;
  /** @type {string[]} */
  let infos;
  /** @type {{ warn: (m: string) => void; info: (m: string) => void }} */
  let logger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aeo-sitemap-finalize-'));
    distDir = pathToFileURL(`${dir}/`);
    warnings = [];
    infos = [];
    logger = {
      warn: (message) => warnings.push(message),
      info: (message) => infos.push(message),
    };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {import('../index.js').AstroAeoConfig} [userConfig]
   * @param {{
   *   sitemapPolicy?: 'auto'|'always'|'never';
   *   sitemapExpected?: boolean;
   *   writer?: ReturnType<typeof createArtifactWriter>;
   * }} [options]
   */
  function finalize(userConfig = {}, options = {}) {
    const { robotsTxt, ...otherConfig } = userConfig;
    return finalizeSitemapOutputs(
      distDir,
      resolveConfig({
        ...otherConfig,
        robotsTxt: { enabled: true, ...robotsTxt },
      }),
      {
        siteUrl: 'https://example.com',
        base: '',
        sitemapPolicy: options.sitemapPolicy ?? 'auto',
        sitemapExpected: options.sitemapExpected ?? false,
        logger,
        writer: options.writer,
      },
    );
  }

  test('auto mode copies a generated index before advertising it', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<index/>');
    const result = finalize({}, { sitemapExpected: true });

    expect(result).toEqual({ aliasEmitted: true, sitemapAdvertised: true });
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe('<index/>');
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap-index.xml',
    );
    expect(warnings).toEqual([]);
  });

  test('auto mode advertises an alias staged by the deferred writer', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<index/>');
    const writer = createArtifactWriter({
      distDir,
      logger,
      deferred: true,
      projectRoot: dir,
      diagnostics: [],
      failOn: 'error',
    });
    const result = finalize(
      { robotsTxt: { enabled: true, sitemapPath: '/sitemap.xml' } },
      { sitemapExpected: true, writer },
    );

    expect(result).toEqual({ aliasEmitted: true, sitemapAdvertised: true });
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(existsSync(join(dir, 'robots.txt'))).toBe(false);

    writer.commit();
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe('<index/>');
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap.xml',
    );
  });

  test('expected but missing output warns once and is not advertised', () => {
    const result = finalize({}, { sitemapExpected: true });

    expect(result).toEqual({ aliasEmitted: false, sitemapAdvertised: false });
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('was not generated');
  });

  test('explicit always policy advertises a runtime sitemap without a static file', () => {
    const result = finalize(
      { robotsTxt: { enabled: true, includeSitemap: true, sitemapPath: '/runtime-sitemap.xml' } },
      { sitemapPolicy: 'always' },
    );

    expect(result.sitemapAdvertised).toBe(true);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/runtime-sitemap.xml',
    );
  });

  test('never policy suppresses an existing sitemap', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<index/>');
    const result = finalize(
      { robotsTxt: { enabled: true, includeSitemap: false } },
      { sitemapPolicy: 'never', sitemapExpected: true },
    );

    expect(result.sitemapAdvertised).toBe(false);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
  });

  test('disabled mode neither aliases nor advertises an existing sitemap', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<manual/>');
    const result = finalize({
      discovery: {
        sitemap: { mode: 'disabled' },
        robots: { enabled: true, includeSitemap: true },
      },
    });

    expect(result).toEqual({ aliasEmitted: false, sitemapAdvertised: false });
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
  });

  test('manual sitemap sources are aliased without an official integration', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<manual/>');
    const result = finalize();

    expect(result.aliasEmitted).toBe(true);
    expect(result.sitemapAdvertised).toBe(true);
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe('<manual/>');
  });

  test('a hand-authored sitemap is auto-detected without an official integration', () => {
    writeFileSync(join(dir, 'sitemap.xml'), '<manual/>');
    const result = finalize({
      sitemap: { enabled: false },
      robotsTxt: { enabled: true, sitemapPath: '/sitemap.xml' },
    });

    expect(result).toEqual({ aliasEmitted: false, sitemapAdvertised: true });
    expect(warnings).toEqual([]);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap.xml',
    );
  });

  test('an existing alias target is preserved and can be advertised', () => {
    writeFileSync(join(dir, 'sitemap-index.xml'), '<generated/>');
    writeFileSync(join(dir, 'sitemap.xml'), '<owned/>');
    const result = finalize(
      { robotsTxt: { enabled: true, sitemapPath: '/sitemap.xml' } },
      { sitemapExpected: true },
    );

    expect(result).toEqual({ aliasEmitted: false, sitemapAdvertised: true });
    expect(readFileSync(join(dir, 'sitemap.xml'), 'utf8')).toBe('<owned/>');
    expect(warnings.some((warning) => warning.includes('already exists'))).toBe(true);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap.xml',
    );
  });

  test('does not advertise a previously owned sitemap scheduled for stale cleanup', () => {
    const first = createArtifactWriter({
      distDir,
      logger,
      deferred: true,
      projectRoot: dir,
      diagnostics: [],
      failOn: 'error',
    });
    first.write({
      route: '/sitemap.xml',
      owner: 'sitemapAlias',
      contents: '<urlset/>',
    });
    first.commit();

    const second = createArtifactWriter({
      distDir,
      logger,
      deferred: true,
      projectRoot: dir,
      diagnostics: [],
      failOn: 'error',
    });
    const result = finalize({
      discovery: {
        sitemap: { mode: 'external', alias: { enabled: false } },
        robots: { enabled: true, sitemapPath: '/sitemap.xml' },
      },
    }, { writer: second });

    expect(result).toEqual({ aliasEmitted: false, sitemapAdvertised: false });
    second.commit();
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(false);
    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).not.toContain('Sitemap:');
  });

  test('retains main-phase claims while writing late outputs', () => {
    const writer = createArtifactWriter({ distDir, logger });
    writer.write({
      path: join(dir, 'robots.txt'),
      owner: 'llmsTxt',
      route: '/robots.txt',
      contents: 'earlier phase',
      onConflict: 'overwrite',
    });

    finalize({}, { writer });

    expect(readFileSync(join(dir, 'robots.txt'), 'utf8')).not.toBe('earlier phase');
    expect(
      warnings.some((warning) =>
        warning.includes('robotsTxt and llmsTxt both write /robots.txt'),
      ),
    ).toBe(true);
    expect(warnings).toContain(
      'astro-aeo: overwriting an existing robots.txt in the build output',
    );
    expect(writer.count('robotsTxt')).toBe(1);
  });
});

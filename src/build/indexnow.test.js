import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { sha256 } from './indexnow-state.js';
import {
  collectIndexNowFingerprints,
  indexNowPaths,
  indexNowStatePathname,
  readIndexNowPrivateState,
} from './indexnow.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function page(over = {}) {
  return {
    id: '/', pathname: '/', url: 'https://example.com/', canonicalUrl: 'https://example.com/',
    metadata: { title: 'Home' }, representations: { markdown: '# Home' }, markdown: '# Home',
    directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true },
    authors: [], entities: [], dates: {}, alternates: [], aeoTokens: [], diagnostics: [],
    source: { kind: 'rendered' }, rendering: 'prerendered', mdHref: '/index.md', title: 'Home', description: '',
    ...over,
  };
}

describe('build IndexNow helpers', () => {
  test('filters non-indexable pages and diagnoses unsafe canonical URLs', () => {
    const result = collectIndexNowFingerprints([
      page(),
      page({ id: '/private', pathname: '/private', url: 'https://example.com/private', canonicalUrl: 'https://example.com/private', directives: { index: false } }),
      page({ id: '/bad', pathname: '/bad', url: 'http://example.com/bad', canonicalUrl: 'http://example.com/bad' }),
      page({ id: '/404', pathname: '/404', url: 'https://example.com/404', canonicalUrl: 'https://example.com/404' }),
    ], { origins: ['https://example.com'] });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].url).toBe('https://example.com/');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'indexnow-canonical-unsafe', pathname: '/bad' }));
  });

  test('retains an acknowledged fingerprint when semantic normalization fails', () => {
    const cycle = {};
    cycle.self = cycle;
    const acknowledged = { url: 'https://example.com/', fingerprint: sha256('prior') };
    const result = collectIndexNowFingerprints([page()], {
      origins: ['https://example.com'],
      acknowledged: [acknowledged],
      graphFor: () => cycle,
    });
    expect(result.current).toEqual([acknowledged]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'indexnow-fingerprint-failed' }));
  });

  test('does not let a later duplicate hide a canonical fingerprint conflict', () => {
    const acknowledged = { url: 'https://example.com/', fingerprint: sha256('prior') };
    const result = collectIndexNowFingerprints([
      page({ markdown: '# First', representations: { markdown: '# First' } }),
      page({ markdown: '# Conflicting', representations: { markdown: '# Conflicting' } }),
      page({ markdown: '# First', representations: { markdown: '# First' } }),
    ], { origins: ['https://example.com'], acknowledged: [acknowledged] });
    expect(result.current).toEqual([acknowledged]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'indexnow-canonical-conflict' }));
  });

  test('fails private ledgers closed on malformed files, symlinks, and progress journals', () => {
    const malformedRoot = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-state-'));
    roots.push(malformedRoot);
    const malformed = indexNowPaths(malformedRoot);
    mkdirSync(malformed.directory, { recursive: true });
    writeFileSync(malformed.pending, '{}');
    expect(readIndexNowPrivateState(malformedRoot)).toMatchObject({
      readOnly: true,
      diagnostics: [expect.objectContaining({ code: 'indexnow-state-invalid' })],
    });

    const symlinkRoot = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-state-'));
    roots.push(symlinkRoot);
    const symlink = indexNowPaths(symlinkRoot);
    mkdirSync(symlink.directory, { recursive: true });
    const target = join(symlinkRoot, 'target.json');
    writeFileSync(target, '{"version":1,"origins":[]}');
    symlinkSync(target, symlink.acknowledgment);
    expect(readIndexNowPrivateState(symlinkRoot).readOnly).toBe(true);

    const progressRoot = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-state-'));
    roots.push(progressRoot);
    const progress = indexNowPaths(progressRoot);
    mkdirSync(progress.directory, { recursive: true });
    writeFileSync(progress.progress, '{}');
    expect(readIndexNowPrivateState(progressRoot)).toMatchObject({
      readOnly: true,
      diagnostics: [expect.objectContaining({ code: 'indexnow-state-in-progress' })],
    });
  });

  test('forms a base-prefixed deployed state pathname', () => {
    expect(indexNowStatePathname('')).toBe('/.well-known/astro-aeo-indexnow-v1.json');
    expect(indexNowStatePathname('/docs/')).toBe('/docs/.well-known/astro-aeo-indexnow-v1.json');
  });

  test('holds notification state exclusively and releases by nonce', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-indexnow-lock-'));
    roots.push(root);
    const first = readIndexNowPrivateState(root);
    expect(first.readOnly).toBe(false);
    const competing = readIndexNowPrivateState(root);
    expect(competing).toMatchObject({
      readOnly: true,
      diagnostics: [expect.objectContaining({ code: 'indexnow-state-locked' })],
    });
    first.close();
    const resumed = readIndexNowPrivateState(root);
    expect(resumed.readOnly).toBe(false);
    resumed.close();
  });
});

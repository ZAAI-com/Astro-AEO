import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDiagnosticsManifest } from './diagnostics.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('writeDiagnosticsManifest', () => {
  test('writes only private metadata and never page content', () => {
    const root = mkdtempSync(join(tmpdir(), 'astro-aeo-diagnostics-'));
    roots.push(root);
    const output = writeDiagnosticsManifest(
      root,
      [
        {
          pathname: '/x',
          markdown: 'SECRET MARKDOWN',
          htmlPath: '/tmp/x.html',
          mdPath: '/tmp/x.md',
          source: { strategy: 'marker', path: 'src/x.md' },
          extraction: {
            strategy: 'main',
            selectedNodes: 1,
            removedNodes: 2,
            inputCharacters: 100,
            outputCharacters: 20,
          },
          diagnostics: [],
        },
      ],
      [
        {
          version: 1,
          code: 'safe-finding',
          severity: 'warning',
          message: 'Actionable metadata only.',
          pathname: '/x',
          details: { source: 'SECRET SOURCE', marker: '<script data-astro-aeo-marker>' },
        },
      ],
      new Date('2026-08-05T00:00:00.000Z'),
    );
    expect(output).toBe(join(root, '.astro', 'aeo-cache', 'diagnostics-v1.json'));
    const raw = readFileSync(output, 'utf8');
    expect(raw).not.toContain('SECRET MARKDOWN');
    expect(raw).not.toContain('/tmp/x.html');
    expect(raw).not.toContain('SECRET SOURCE');
    expect(raw).not.toContain('astro-aeo-marker');
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      pages: [{ pathname: '/x', source: 'marker', sourcePath: 'src/x.md' }],
      diagnostics: [{ code: 'safe-finding', pathname: '/x' }],
    });
  });
});

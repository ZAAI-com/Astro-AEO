import { expect, test } from 'vitest';
import { pageMarkdown } from './page-markdown.js';
import { renderMarkdownDocument } from './markdown-doc.js';
import { planCorpusArtifacts } from '../corpus-artifacts.js';
import { resolveConfig } from '../../config.js';

test('version footers are opt-in, known-peer only, escaped, and never mutate source text', () => {
  const page = { markdown: '# Guide\n', versionLinks: true, alternates: [
    null,
    { kind: 'version', version: 'v1', url: 'https://example.test/v1/guide/' },
    { language: 'fr', url: 'https://example.test/fr/guide/' },
    { kind: 'version', version: 'v0', url: 'https://user:secret@example.test/' },
    { kind: 'version', version: 'unsafe\nlabel', url: 'https://example.test/' },
  ] };
  expect(pageMarkdown(page)).toBe('# Guide\n\n---\n\n- Version v1: <https://example.test/v1/guide/>\n');
  expect(pageMarkdown({ ...page, versionLinks: false })).toBe(page.markdown);
  expect(pageMarkdown({ ...page, alternates: [] })).toBe(page.markdown);
  expect(page.markdown).toBe('# Guide\n');
});

test('companions, full corpora and chunks include the same opt-in version link bytes', async () => {
  const page = (version) => ({ id: `/${version}/guide`, pathname: `/${version}/guide`, version, versionGroup: 'guide',
    url: `https://example.test/${version}/guide/`, mdHref: `/${version}/guide.md`,
    title: 'Guide', description: '', markdown: '# Guide\n', language: 'en', locale: 'en', versionLinks: true,
    aeoTokens: [], directives: { index: true, includeInLlms: true, includeInLlmsFull: true, generateMarkdown: true }, source: { strategy: 'marker' } });
  const config = resolveConfig({ corpus: { versions: { current: 'v2' }, chunks: { enabled: true }, manifest: { enabled: true } } });
  const plan = await planCorpusArtifacts({ pages: [page('v2'), page('v1')], config, base: '', origin: 'https://example.test', siteMeta: { name: 'Docs', description: '' } });
  const link = '- Version v1: <https://example.test/v1/guide/>';
  expect(plan.artifacts.find((artifact) => artifact.pathname === '/llms-full.txt').contents).toContain(link);
  expect(plan.artifacts.find((artifact) => artifact.kind === 'chunk' && artifact.version === 'v2').contents).toContain(link);
  expect(renderMarkdownDocument({ ...page('v2'), alternates: [{ kind: 'version', version: 'v1', url: 'https://example.test/v1/guide/' }] }, config)).toContain(link);
});

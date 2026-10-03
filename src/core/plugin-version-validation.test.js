import { expect, test } from 'vitest';
import { isPageDescriptor } from './plugin-validation.js';

test('version fields fail closed for malformed hook replacements', () => {
  const valid = { pathname: '/guide', version: 'v2', versionGroup: 'guide',
    alternates: [{ kind: 'version', version: 'v1', url: 'https://example.test/v1/guide/' }] };
  expect(isPageDescriptor(valid)).toBe(true);
  for (const change of [
    { version: '../v1' }, { versionGroup: '\u0000private' },
    { alternates: {} }, { alternates: 'invalid' },
    { alternates: [{ kind: 'version', version: 'v1', url: 'not-a-url' }] },
    { alternates: [{ kind: 'version', version: 'v1', url: 'https://user:secret@example.test/' }] },
    { alternates: [{ kind: 'version', version: 'v1', language: 'en', url: 'https://example.test/' }] },
  ]) expect(isPageDescriptor({ ...valid, ...change })).toBe(false);
});

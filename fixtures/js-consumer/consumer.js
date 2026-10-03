// @ts-check
import aeo from 'astro-aeo';
import { defineAeoPage } from 'astro-aeo/page';
import { createAnalytics } from 'astro-aeo/analytics';
import { createVercelHandler } from 'astro-aeo/edge/vercel';
import starlight from 'astro-aeo/starlight';

/** @type {import('astro-aeo').CanonicalAeoConfig} */
const options = {
  markdown: { cacheControl: 'public, max-age=60' },
  corpus: {
    versions: { current: 'v2', order: ['v2', 'v1'] },
    rag: { enabled: true, maxTokens: 512, publish: false },
  },
  analytics: { enabled: true, scope: 'agents', sampleRate: 1, adapter: { type: 'console' } },
};
aeo(options);
defineAeoPage({ markdown: '# Example', version: 'v2', versionGroup: 'example' });
const observer = createAnalytics({
  enabled: true, surface: 'vercel', inventory: ['/docs'],
  sink(event) { event.crawler.classification.toUpperCase(); },
});
// JS consumers express type contracts through JSDoc, not TypeScript syntax.
observer.observe(new Request('https://example.test/docs'), new Response('Body'));
starlight({ versions: { current: 'v2', archived: [{ version: 'v1', prefix: 'v1' }] } });
function edge() { return createVercelHandler({
  analytics: observer, next: () => new Response('HTML'),
  rewrite: () => new Response('Markdown'),
}); }
void edge;
// @ts-expect-error Unsupported privacy overrides must not type-check.
aeo({ analytics: { privacy: { ip: true } } });
// @ts-expect-error A language alternate cannot masquerade as a version alternate.
defineAeoPage({ markdown: 'Body', alternates: [{ kind: 'version', language: 'en', url: 'https://example.test/v1' }] });

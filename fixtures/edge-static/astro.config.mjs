import { defineConfig } from 'astro/config';
import aeo from '../../src/index.js';
import { cloudflareEdge } from '../../src/edge/cloudflare.js';

// A fully static site with no adapter: content negotiation happens in the host's
// edge layer, from the manifest this build emits.
export default defineConfig({
  site: 'https://edge-static.example.com',
  integrations: [
    aeo({
      markdown: { negotiation: 'response' },
      discovery: { sitemap: { mode: 'disabled' } },
      plugins: [cloudflareEdge()],
    }),
  ],
});

import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import starlight from '@astrojs/starlight';
import starlightAeo from '../../src/starlight.js';

// Docs rendered on demand: the inferred marker must exist only on Astro-AEO's own
// collection rewrite, never on a visitor's request.
export default defineConfig({
  site: 'https://starlight-node.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    starlight({
      title: 'Fixture Docs',
      prerender: false,
      pagefind: false,
      plugins: [starlightAeo({ aeo: { markdown: { negotiation: 'response' } } })],
    }),
  ],
});

import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightAeo from '../../src/starlight.js';

export default defineConfig({
  site: 'https://starlight-static.example.com',
  integrations: [
    starlight({
      title: 'Fixture Docs',
      editLink: { baseUrl: 'https://example.com/edit/' },
      sidebar: [{ label: 'Guides', items: ['guides/install', 'guides/tabs', 'guides/dynamic', 'guides/explicit'] }],
      plugins: [starlightAeo({ links: { edit: true } })],
    }),
  ],
});

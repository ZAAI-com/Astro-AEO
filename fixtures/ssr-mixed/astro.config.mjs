import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import aeo from '../../src/index.js';

export default defineConfig({
  site: 'https://mixed.example.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [aeo({ discovery: { sitemap: { mode: 'disabled' } } })],
});

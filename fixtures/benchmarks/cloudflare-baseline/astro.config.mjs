import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://adapter.example.com',
  base: '/docs',
  output: 'server',
  adapter: cloudflare(),
});

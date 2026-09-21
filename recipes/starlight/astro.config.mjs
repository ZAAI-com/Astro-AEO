import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightAeo from 'astro-aeo/starlight';

export default defineConfig({
  site: 'https://recipe.example.com',
  integrations: [
    starlight({
      title: 'Recipe Docs',
      plugins: [starlightAeo()],
    }),
  ],
});

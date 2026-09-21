import { defineContentCatalog } from 'astro-aeo/content';

// On-demand routes have no build-time inventory, so the catalog names them.
export default defineContentCatalog({
  name: 'items',
  entries: () => [{ slug: 'widget' }],
  toPage: (item) => ({ pathname: `/items/${item.slug}`, rendering: 'on-demand' }),
});

export default {
  listPages(context) {
    if (!context.siteUrl) throw new Error('catalog context is missing siteUrl');
    return [
      {
        pathname: '/catalog-dynamic',
        rendering: 'on-demand',
        title: 'Catalog Dynamic',
        description: 'A dynamic page declared by an importable catalog.',
        markdown: '# Catalog Dynamic\n\nExact catalog source.',
        lastModified: '2026-08-05',
        sourcePath: 'catalog:dynamic',
      },
      {
        pathname: '/catalog-secondary',
        rendering: 'on-demand',
        title: 'Catalog Secondary',
        description: 'A second authored page in the runtime corpus.',
        markdown: '# Catalog Secondary\n\nSecond exact catalog source.',
        lastModified: '2026-08-06',
        sourcePath: 'catalog:secondary',
      },
      // Regression guard: owned artifacts must never self-fetch recursively.
      { pathname: '/llms.txt', markdown: '# Recursive artifact' },
    ];
  },
};

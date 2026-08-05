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
      // Regression guard: owned artifacts must never self-fetch recursively.
      { pathname: '/llms.txt', markdown: '# Recursive artifact' },
    ];
  },
};

export default {
  name: 'adapter-catalog',
  listPages() {
    return [
      {
        pathname: '/catalog-dynamic',
        rendering: 'on-demand',
        title: 'Catalog Dynamic',
        markdown: '# Catalog Dynamic\n\nExact adapter catalog source.',
        sourcePath: 'adapter-catalog:dynamic',
      },
      {
        pathname: '/llms.txt',
        rendering: 'on-demand',
        title: 'Recursive Artifact',
        markdown: '# Recursive Artifact\n\nThis must never recurse.',
      },
    ];
  },
};

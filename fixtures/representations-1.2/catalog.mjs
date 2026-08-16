const mdx = `import Unused from './never-evaluated.js'

# MDX source

<Callout>

**Mapped without evaluation.**

</Callout>
`;

export default {
  name: 'representation-sources',
  listPages() {
    return [
      {
        pathname: '/mdx',
        title: 'MDX source',
        source: {
          kind: 'mdx',
          path: 'content:mdx-guide',
          body: mdx,
        },
      },
      {
        pathname: '/cms',
        title: 'CMS source',
        source: {
          kind: 'cms',
          path: 'cms:entry-42',
          body: '# CMS source\n\nExact body from the CMS adapter.\n',
        },
      },
    ];
  },
};

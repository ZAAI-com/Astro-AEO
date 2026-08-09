if (process.env.ASTRO_AEO_RUNTIME_CATALOG_FAILURE === '1') {
  throw new Error('runtime catalog evaluation failure');
}

export default {
  listPages() {
    return [
      {
        pathname: '/runtime-failure-leaked',
        title: 'Runtime failure leaked',
        markdown: '# Runtime failure leaked\n\nThis must not reach the runtime corpus.',
      },
    ];
  },
};

// Explicit externally inventoried paths, not automatic upstream discovery.
export default {
  listPages() {
    return ['en', 'fr'].flatMap((locale) => [
      { pathname: `/${locale}`, versionGroup: '/' },
      { pathname: `/${locale}/guides/install`, versionGroup: '/guides/install' },
      { pathname: `/${locale}/guides/fallback`, versionGroup: '/guides/fallback' },
      { pathname: `/${locale}/release-1`, version: 'v1', versionGroup: '/' },
      { pathname: `/${locale}/release-1/guides/install`, version: 'v1', versionGroup: '/guides/install' },
    ].map((page) => ({ ...page, locale, rendering: 'on-demand' })));
  },
};

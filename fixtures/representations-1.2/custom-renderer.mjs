export default {
  name: 'fixture-source-renderer',
  apiVersion: 1,
  render(input) {
    if (input.pathname === '/renderer-failure') {
      throw new Error('SECRET RENDERER PAYLOAD');
    }
    if (input.source?.kind === 'cms' && typeof input.source.body === 'string') {
      return { status: 'rendered', markdown: input.source.body };
    }
    return { status: 'decline' };
  },
};

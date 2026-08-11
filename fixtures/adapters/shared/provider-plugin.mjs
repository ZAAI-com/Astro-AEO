const claim = { id: 'answers', pathname: '/answers.txt' };

export default {
  name: 'adapter-runtime-artifact',
  apiVersion: 1,
  runtime: { entrypoint: import.meta.url, options: { fixture: true } },
  setup(api) {
    api.claimArtifact(claim);
    api.on('artifact:generate', ({ value }) => ({
      action: 'replace',
      value: {
        claim: value.claim,
        representation: {
          body: 'PROVIDER-RUNTIME-PLUGIN\n',
          contentType: 'text/plain; charset=utf-8',
        },
      },
    }));
    api.on('artifact:validate', () => ({ action: 'keep' }));
  },
};

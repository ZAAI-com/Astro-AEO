if (process.env['AEO_SINK_RUNTIME_FAILURE'] === '1') throw new Error('private-runtime-details');
export default { apiVersion: 1, createSink(options) {
  if (process.env['AEO_SINK_RUNTIME_FAILURE'] === 'hang') return new Promise(() => {});
  if (options.expected !== true) throw new Error('bad setup');
  return (event) => { console.log(`custom-analytics:${JSON.stringify(event)}`); };
} };

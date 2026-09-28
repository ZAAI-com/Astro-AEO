import { createCloudflareHandler } from '../../src/edge/cloudflare.js';

// A Worker in front of static assets, the shape `wrangler deploy` ships.
export default { fetch: createCloudflareHandler().fetch };

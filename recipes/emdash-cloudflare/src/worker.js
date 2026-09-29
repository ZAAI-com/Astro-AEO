// EmDash's Worker entry: Astro's handler plus EmDash's scheduled maintenance.
import handler, { createScheduledHandler, PluginBridge } from '@emdash-cms/cloudflare/worker';

export { PluginBridge };

export default {
  ...handler,
  scheduled: createScheduledHandler(),
};

---
"astro-aeo": patch
---

Emit the development on-demand dynamic-route warning exactly once. With `pages.devDynamicDiscovery: 'hot'` the generated loader owns the message, because only it sees routes added after the last route resolution, and its guard now lives on the development process so a re-executed loader stays quiet.

# Astro-AEO Setup Prompt

Copy the prompt below into your AI coding assistant (Claude Code, Cursor, Codex, or similar) while it is pointed at your Astro project. It will install and configure Astro-AEO for you.

---

You are setting up the `astro-aeo` integration in this Astro project. Do the following:

1. Confirm this is an Astro 5+ project by reading `package.json` and `astro.config.mjs` (or `.ts`/`.cjs`). If there is no `astro.config`, stop and tell me.

2. Install the package with the project's package manager:
   - Bun: `bun add astro-aeo`
   - npm: `npm install astro-aeo`
   - pnpm: `pnpm add astro-aeo`
   - yarn: `yarn add astro-aeo`
   If the project prefers a git dependency, add `"astro-aeo": "github:ZAAI-com/Astro-AEO"` to `dependencies` and install.

   **EmDash sites.** If `astro.config` registers `emdash()` from `emdash/astro` (an [EmDash CMS](https://emdashcms.com/) site), do not add `aeo()`. Add `emdashAeo()` after `emdash()` instead, and skip step 4:
   ```js
   import emdashAeo from 'astro-aeo/emdash';
   // inside defineConfig, after emdash({ ... }):
   emdashAeo({
     // Blog and Starter templates: list their taxonomy archive pages.
     taxonomies: { category: '/category/{slug}', tag: '/tag/{slug}' },
     // Only current option names are accepted here, for example:
     aeo: { pages: { exclude: ['/search'] } },
   }),
   ```
   Drop `taxonomies` when the project has no `src/pages/category` or `src/pages/tag` routes, and drop the `/search` exclusion when it has no `src/pages/search.astro`. `emdashAeo()` already excludes the admin, turns on content negotiation, and leaves `robots.txt` and sitemaps to EmDash. For steps 6 and 7, EmDash pages render on demand, so start the site (`npm run dev`, or `npm run build && npm start`) and fetch `/llms.txt` and one `.md` companion from it instead of reading `dist/`. See the [EmDash CMS section](https://github.com/ZAAI-com/Astro-AEO#emdash-cms).

   **Starlight sites.** If `astro.config` calls `starlight()` from `@astrojs/starlight` (a [Starlight](https://starlight.astro.build/) docs site, version 0.32 or newer), do not add `aeo()`. In step 4, add `starlightAeo()` to that call's `plugins` array instead, and put the options from step 4 inside its `aeo` key:
   ```js
   import starlightAeo from 'astro-aeo/starlight';
   // inside starlight({ ... }):
   plugins: [
     // ...existing Starlight plugins
     starlightAeo({
       aeo: { /* the options from step 4 */ },
     }),
   ],
   ```
   `starlightAeo()` registers Astro-AEO itself, publishes each docs page's authored Markdown, reads content from `.sl-markdown-content`, excludes `/404`, and leaves the sitemap to Starlight. See the [Starlight section](https://github.com/ZAAI-com/Astro-AEO#starlight).

3. Make sure `astro.config` sets a `site` URL (Astro-AEO needs it for absolute links). If it is missing, ask me for the production URL.

4. Add the integration (on a Starlight site, pass these options as `starlightAeo({ aeo: { ... } })` from step 2 instead):
   ```js
   import aeo from 'astro-aeo';
   // inside defineConfig:
   integrations: [
     // ...existing integrations
     aeo({
       // Optional. Zero config already produces .md pages, llms.txt, and link tags.
       pages: {
         stripTitleSuffix: 'YOUR BRAND',      // strips " | YOUR BRAND" from titles
       },
       discovery: {
         robots: {
           enabled: true,
           allow: ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot'],
           disallow: ['GPTBot', 'ClaudeBot', 'Google-Extended'],
         },
       },
       site: {
         profile: {
           enabled: true,
           name: 'YOUR SITE NAME',
           description: 'ONE LINE ABOUT THE SITE',
           entityType: 'Organization',         // or 'Person'
         },
       },
     }),
   ],
   ```
   Replace the placeholders. If the site groups content (blog, docs, products), propose a `corpus.index.sections` array that matches its URL structure.

5. If the project already generates its own `robots.txt` in `public/`, tell me before enabling `discovery.robots` (Astro-AEO would replace it).

6. Run `astro build`, then `npx astro-aeo validate` and report the result. Fix any errors it reports.

7. Show me the generated `dist/llms.txt` and one `.md` companion so I can review.

Do not commit anything until I have reviewed the changes.

---

For all options, see the [README](https://github.com/ZAAI-com/Astro-AEO#readme).

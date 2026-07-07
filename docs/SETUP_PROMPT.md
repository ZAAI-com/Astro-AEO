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

3. Make sure `astro.config` sets a `site` URL (Astro-AEO needs it for absolute links). If it is missing, ask me for the production URL.

4. Add the integration:
   ```js
   import aeo from 'astro-aeo';
   // inside defineConfig:
   integrations: [
     // ...existing integrations
     aeo({
       // Optional. Zero config already produces .md pages, llms.txt, and link tags.
       stripTitleSuffix: 'YOUR BRAND',        // strips " | YOUR BRAND" from titles
       robotsTxt: {
         enabled: true,
         allow: ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot'],
         disallow: ['GPTBot', 'ClaudeBot', 'Google-Extended'],
       },
       domainProfile: {
         enabled: true,
         name: 'YOUR SITE NAME',
         description: 'ONE LINE ABOUT THE SITE',
         entityType: 'Organization',           // or 'Person'
       },
     }),
   ],
   ```
   Replace the placeholders. If the site groups content (blog, docs, products), propose an `llmsTxt.sections` array that matches its URL structure.

5. If the project already generates its own `robots.txt` in `public/`, tell me before enabling `robotsTxt` (Astro-AEO would replace it).

6. Run `astro build`, then `npx astro-aeo validate` and report the result. Fix any errors it reports.

7. Show me the generated `dist/llms.txt` and one `.md` companion so I can review.

Do not commit anything until I have reviewed the changes.

---

For all options, see the [README](https://github.com/ZAAI-com/Astro-AEO#readme).

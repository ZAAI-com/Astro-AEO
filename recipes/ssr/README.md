# Recipe: ssr

On-demand rendering with the Node adapter: content negotiation at the page URL, and a catalog so request-time pages reach the corpus.

```bash
npm install
npm run build
npm run audit
```

Ask for Markdown at the URL of a page:

```bash
node dist/server/entry.mjs &
curl -H 'Accept: text/markdown' http://localhost:4321/items/widget/
```

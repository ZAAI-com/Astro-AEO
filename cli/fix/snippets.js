// @ts-check
import { MARKDOWN_MIME } from './shared.js';

/**
 * Hosts whose configuration Astro-AEO does not edit. These are printed, never
 * written: the files involved are too varied to change safely.
 */
export const SNIPPETS = Object.freeze({
  nginx: `# nginx: inside the server block\nlocation ~ \\.md$ {\n  types { }\n  default_type "${MARKDOWN_MIME}";\n}\n`,
  apache: `# Apache: .htaccess or the virtual host\nAddType text/markdown .md\nAddDefaultCharset utf-8\n`,
  node: `// Node (express.static and compatible)\napp.use(express.static('dist', {\n  setHeaders(res, path) {\n    if (path.endsWith('.md')) res.setHeader('Content-Type', '${MARKDOWN_MIME}');\n  },\n}));\n`,
  workers: `// Cloudflare Workers with static assets: add a _headers file to the assets directory\n/*.md\n  Content-Type: ${MARKDOWN_MIME}\n`,
  deno: `// Deno (std/http file server)\nimport { serveDir } from 'jsr:@std/http/file-server';\nDeno.serve(async (request) => {\n  const response = await serveDir(request, { fsRoot: 'dist' });\n  if (new URL(request.url).pathname.endsWith('.md')) response.headers.set('content-type', '${MARKDOWN_MIME}');\n  return response;\n});\n`,
});

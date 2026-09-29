// @ts-check
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { defineCmsAdapter } from 'astro-aeo/content';

// On-demand CMS routes have no build-time inventory, so this catalog names them.
// It reads the local EmDash SQLite database directly (Node variant) and lists
// published entries only: drafts and soft-deleted rows stay out of the corpus.
// A catalog must never break the build, so every failure degrades to [] plus a
// warning. EmDash's table layout (ec_<collection>) is internal and beta, so this
// module stays recipe-local on purpose and queries only stable columns.

/** @typedef {{ collection: string; prefix: string; descriptionField: string }} Source */

const SOURCES = [
  { collection: 'posts', prefix: '/posts', descriptionField: 'excerpt' },
  { collection: 'projects', prefix: '/work', descriptionField: 'summary' },
];

function resolveDatabasePath() {
  // Config preflight and astro dev load this module from src/, a build bundles
  // it into dist/server/chunks. In both cases the database sits at the project
  // root, so search upwards from the module URL and fall back to the process
  // cwd, which a standalone Node server keeps at the project root.
  /** @param {string} directory */
  const firstExisting = (directory) => {
    let current = directory;
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = join(current, 'data.db');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  };
  return (
    firstExisting(dirname(fileURLToPath(import.meta.url))) ??
    firstExisting(process.cwd())
  );
}

/** @param {string} databasePath */
async function listPublishedPages(databasePath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    /** @type {import('astro-aeo/page').CmsPage[]} */
    const pages = [];
    for (const source of SOURCES) {
      const rows = db
        .prepare(
          `SELECT slug, title, ${source.descriptionField} AS description, published_at, updated_at
           FROM ec_${source.collection}
           WHERE status = 'published' AND deleted_at IS NULL AND slug IS NOT NULL
           ORDER BY published_at DESC`,
        )
        .all();
      for (const row of rows) {
        pages.push({
          id: String(row.slug),
          pathname: `${source.prefix}/${row.slug}`,
          rendering: 'on-demand',
          title: row.title ?? undefined,
          description: row.description ?? undefined,
          dates: { published: row.published_at ?? undefined, modified: row.updated_at ?? undefined },
        });
      }
    }
    return pages;
  } finally {
    db.close();
  }
}

export default defineCmsAdapter({
  name: 'emdash',
  async listPages() {
    const databasePath = resolveDatabasePath();
    if (!databasePath) {
      console.warn('astro-aeo emdash catalog: no data.db found; listing no pages. Run `npm run db:setup` first.');
      return [];
    }
    try {
      return await listPublishedPages(databasePath);
    } catch (error) {
      console.warn(`astro-aeo emdash catalog: could not read ${databasePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  },
});

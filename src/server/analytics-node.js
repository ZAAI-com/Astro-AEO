// @ts-check
// This module is reachable only through enabled generated Node entrypoints.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** @param {string} filename @param {string} [root] @returns {import('../analytics.js').AnalyticsSink} */
export function createJsonlSink(filename = '.astro/aeo-analytics/events-v1.jsonl', root = process.cwd()) {
  const target = resolve(root, filename);
  const path = relative(root, target);
  if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) throw new TypeError('astro-aeo: analytics JSONL path must stay inside the project');
  let queue = Promise.resolve();
  return (event) => {
    const work = queue.then(async () => {
      // Refuse symlinks at every existing ancestor and the destination. Never
      // truncate existing logs; serialization keeps concurrent lines complete.
      let current = resolve(root);
      const rootStat = await lstat(current);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Unsafe analytics root');
      for (const part of relative(root, dirname(target)).split('/').filter(Boolean)) {
        current = resolve(current, part);
        try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error; }
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe analytics directory');
      }
      const file = await open(target, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        if (!(await file.stat()).isFile()) throw new Error('Unsafe analytics destination');
        await file.chmod(0o600);
        await file.writeFile(`${JSON.stringify(event)}\n`);
      } finally { await file.close(); }
    });
    queue = work.catch(() => {});
    return work;
  };
}

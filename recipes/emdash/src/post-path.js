// Posts use the dated pattern /blog/{year}/{month}/{slug}. EmDash resolves the
// date tokens from the publish date in UTC, and so does this helper.
/** @param {{ id: string; data: { publishedAt?: Date | null } }} post */
export function postPath(post) {
  const published = post.data.publishedAt ?? new Date(0);
  const month = String(published.getUTCMonth() + 1).padStart(2, '0');
  return `/blog/${published.getUTCFullYear()}/${month}/${post.id}`;
}

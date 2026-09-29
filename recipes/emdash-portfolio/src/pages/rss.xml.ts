import type { APIRoute } from 'astro';
import { getEmDashCollection } from 'emdash';

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site, url }) => {
  const origin = site ?? new URL(url.origin);
  const { entries } = await getEmDashCollection('projects', { orderBy: { published_at: 'desc' }, limit: 20 });
  const items = entries
    .map((entry) => {
      const link = new URL(`/work/${entry.id}`, origin).href;
      return `<item><title>${escapeXml(entry.data.title ?? '')}</title><link>${link}</link>` +
        `<guid>${link}</guid><description>${escapeXml(entry.data.summary ?? '')}</description></item>`;
    })
    .join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
    `<title>Studio</title><link>${origin.href}</link><description>Studio</description>${items}</channel></rss>`;
  return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};

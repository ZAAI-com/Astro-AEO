export const prerender = true;

export function GET() {
  return new Response('<owned-sitemap/>', {
    headers: { 'Content-Type': 'application/xml' },
  });
}

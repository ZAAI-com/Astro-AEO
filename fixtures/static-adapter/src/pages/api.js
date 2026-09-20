// The only on-demand route, and an endpoint rather than a page. It is what makes
// Astro report server build output without putting any page beyond the build's reach.
export const prerender = false;

export function GET() {
  return Response.json({ ok: true });
}

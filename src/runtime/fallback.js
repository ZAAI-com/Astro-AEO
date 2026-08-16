// @ts-check

/**
 * Adapter-visible route target. Astro-AEO's pre-middleware responds first for
 * owned representations; reaching this endpoint means the integration declined.
 */
export function GET() {
  return new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

export const HEAD = GET;

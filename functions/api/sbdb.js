// Cloudflare Pages Function: GET /api/sbdb?...  ->  JPL Small-Body Database query API.
//
// Why this exists: browsers block a page from reading another site's data unless
// that site sends CORS headers. Routing the request through our own domain avoids
// that, and lets Cloudflare cache the answer so JPL isn't asked on every visit.

const JPL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const ALLOWED = ["fields", "sb-kind", "sb-cdata", "sb-xfrag", "sb-ns", "full-prec", "limit", "sort"];
const CACHE_SECONDS = 6 * 3600;

export async function onRequestGet({ request }) {
  const incoming = new URL(request.url);
  const upstream = new URL(JPL);
  for (const key of ALLOWED) {
    const value = incoming.searchParams.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }
  if (!upstream.searchParams.has("fields")) {
    return json({ error: "missing 'fields' parameter" }, 400);
  }

  const res = await fetch(upstream.toString(), {
    headers: { "User-Agent": "mars-alien.com sky tracker" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

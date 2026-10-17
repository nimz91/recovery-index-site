// GET /api/market — Shree Ji rates pasted through /ingest in the last ~3 weeks, stored in KV by /api/ingest.
// The page merges these with /data/scrap.json and /data/market.json (committed rows win on the same key).
export async function onRequestGet({ env }) {
  if (!env.LIVE) return Response.json({ scrap: [], market: [] });
  const dates = ((await env.LIVE.get('sj:dates', 'json')) || []).slice(-21);
  const days = await Promise.all(dates.map((d) => env.LIVE.get('sj:' + d, 'json')));
  const scrap = [], market = [];
  days.forEach((d) => { if (d) { scrap.push(...(d.scrap || [])); market.push(...(d.market || [])); } });
  return Response.json({ dates, scrap, market }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

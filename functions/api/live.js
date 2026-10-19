// GET /api/live — latest live metal prices, recent snapshots and daily closes,
// written by the recovery-index-live Worker into KV.
export async function onRequestGet({ env }) {
  if (!env.LIVE) return Response.json({ latest: null, intraday: [], closes: {}, error: 'LIVE KV namespace is not bound' }, { status: 200 });
  const [latest, intraday, closes] = await Promise.all([env.LIVE.get('latest', 'json'), env.LIVE.get('intraday', 'json'), env.LIVE.get('closes', 'json')]);
  return Response.json(
    { latest: latest || null, intraday: (intraday || []).slice(-120), closes: closes || {} },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

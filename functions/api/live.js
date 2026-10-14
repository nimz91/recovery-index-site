// GET /api/live — latest live metal prices and the last 24h of 5-minute
// snapshots, written by the recovery-index-live Worker into KV.
export async function onRequestGet({ env }) {
  if (!env.LIVE) return Response.json({ latest: null, intraday: [], error: 'LIVE KV namespace is not bound' }, { status: 200 });
  const [latest, intraday] = await Promise.all([env.LIVE.get('latest', 'json'), env.LIVE.get('intraday', 'json')]);
  return Response.json(
    { latest: latest || null, intraday: intraday || [] },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}

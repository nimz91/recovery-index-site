// /brief/<YYYY-MM-DD>  -> the web copy of that day's Evening Brief (written to KV by the live worker when it sends)
// /brief/archive.json  -> list of sent briefs, newest first (used by /brief/)
// /brief/ itself is the static sign-up page in public/brief/index.html.

export async function onRequestGet({ params, env, next }) {
  const id = String(params.id || '');
  if (!env.LIVE) return next();
  if (id === 'archive.json') {
    const index = (await env.LIVE.get('brief:index', 'json')) || [];
    return Response.json(index, { headers: { 'Cache-Control': 'public, max-age=300' } });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(id)) {
    const html = await env.LIVE.get('brief:' + id);
    if (html) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  return next();
}

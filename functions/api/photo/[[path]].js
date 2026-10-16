// GET /api/photo/<key> — serves a lot photo from the PHOTOS KV namespace.
// Admins (Bearer ADMIN_KEY) can see every photo; anyone can see photos of lots that are on auction.
import { bad, isAdmin, needDb } from '../../_lib/util.js';

export async function onRequestGet({ request, env, params }) {
  const miss = needDb(env); if (miss) return miss;
  if (!env.PHOTOS) return bad('Photo storage is not set up.', 503);
  const key = (Array.isArray(params.path) ? params.path : [params.path]).join('/');
  const p = await env.DB.prepare('SELECT lot_id FROM photos WHERE key = ?').bind(key).first();
  if (!p) return bad('Photo not found.', 404);
  if (!isAdmin(request, env)) {
    const a = await env.DB.prepare("SELECT 1 FROM auctions WHERE lot_id = ? AND status != 'cancelled'").bind(p.lot_id).first();
    if (!a) return bad('Photo not found.', 404);
  }
  const { value, metadata } = await env.PHOTOS.getWithMetadata(key, 'stream');
  if (!value) return bad('Photo not found.', 404);
  return new Response(value, {
    headers: { 'Content-Type': (metadata && metadata.contentType) || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
  });
}

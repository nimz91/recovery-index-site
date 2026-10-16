// POST /api/photos — attach a photo to a lot that was just submitted (multipart form).
// Fields: lot_id, token (the upload_token returned by POST /api/lots), file, row_no (optional), ai (optional JSON)
import { json, bad, uid, sha256, now, needDb } from '../_lib/util.js';

const MAX_BYTES = 8 * 1024 * 1024; // the browser resizes to ~1600px JPEG first, so real uploads are far smaller
const MAX_PER_LOT = 80;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

export async function onRequestPost({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  if (!env.PHOTOS) return bad('Photo storage is not set up yet (KV binding "PHOTOS" is missing).', 503);
  let form;
  try { form = await request.formData(); } catch { return bad('Send the photo as a multipart form.'); }
  const lotId = String(form.get('lot_id') || ''), token = String(form.get('token') || '');
  const file = form.get('file');
  if (!lotId || !token) return bad('Missing lot or upload token.', 401);
  const lot = await env.DB.prepare('SELECT id, upload_token_hash, created_at FROM lots WHERE id = ?').bind(lotId).first();
  if (!lot || lot.upload_token_hash !== await sha256(token)) return bad('This upload link is not valid.', 401);
  if (now() - lot.created_at > 24 * 3600 * 1000) return bad('Photo uploads for this lot have closed. Send further photos to the inspection team.', 403);
  if (!file || typeof file === 'string') return bad('No photo was attached.');
  if (!EXT[file.type]) return bad('Upload JPEG, PNG, WebP or HEIC photos.');
  if (file.size > MAX_BYTES) return bad('Each photo must be under 8 MB.');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE lot_id = ?').bind(lotId).first();
  if (n >= MAX_PER_LOT) return bad(`A lot can have up to ${MAX_PER_LOT} photos.`);

  const key = `lots/${lotId}/${uid(8)}.${EXT[file.type]}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } });
  const rowNo = parseInt(form.get('row_no'), 10);
  let ai = form.get('ai');
  try { ai = ai ? JSON.stringify(JSON.parse(String(ai))).slice(0, 4000) : null; } catch { ai = null; }
  await env.DB.prepare('INSERT INTO photos (key, lot_id, created_at, content_type, row_no, ai_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(key, lotId, now(), file.type, Number.isFinite(rowNo) ? rowNo : null, ai).run();
  return json({ key }, 201);
}

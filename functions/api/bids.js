// POST /api/bids — place a bid on a sub-lot. Body: { sublot_id, amount }. Requires an approved buyer's access key.
// The insert is a single conditional statement, so two simultaneous bids can't both win the same price.
// A bid in the last `soft_close_sec` seconds extends that sub-lot's close (anti-sniping).
import { json, bad, now, needDb, buyerFromRequest } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  const buyer = await buyerFromRequest(request, env);
  if (!buyer) return bad('Enter your buyer access key to bid.', 401);
  if (buyer.status !== 'approved') return bad('Your buyer account is not approved yet.', 403);
  let b;
  try { b = await request.json(); } catch { return bad('Send the bid as JSON.'); }
  const sublotId = String(b.sublot_id || '');
  const amount = Math.round(Number(b.amount));
  if (!sublotId || !Number.isFinite(amount) || amount <= 0 || amount > 1e10) return bad('Enter a bid amount in rupees.');

  const t = now();
  const ins = env.DB.prepare(`INSERT INTO bids (sublot_id, buyer_id, amount, created_at)
      SELECT s.id, ?2, ?3, ?4 FROM sublots s JOIN auctions a ON a.id = s.auction_id
      WHERE s.id = ?1 AND a.status = 'scheduled' AND a.starts_at <= ?4 AND s.ends_at > ?4
        AND ?3 >= COALESCE((SELECT MAX(amount) FROM bids WHERE sublot_id = s.id) + s.increment, s.opening)
        AND (?3 - s.opening) % s.increment = 0
        AND COALESCE((SELECT buyer_id FROM bids WHERE sublot_id = s.id ORDER BY amount DESC LIMIT 1), '') != ?2`)
    .bind(sublotId, buyer.id, amount, t);
  const ext = env.DB.prepare(`UPDATE sublots SET ends_at = ?2 + (SELECT soft_close_sec FROM auctions WHERE id = sublots.auction_id) * 1000
      WHERE id = ?1 AND ends_at - ?2 < (SELECT soft_close_sec FROM auctions WHERE id = sublots.auction_id) * 1000
        AND EXISTS (SELECT 1 FROM bids WHERE sublot_id = ?1 AND buyer_id = ?3 AND amount = ?4 AND created_at = ?2)`)
    .bind(sublotId, t, buyer.id, amount);
  const [r] = await env.DB.batch([ins, ext]);
  if (r.meta.changes === 1) return json({ ok: true, amount, at: t }, 201);

  // Explain why the bid was refused
  const s = await env.DB.prepare(`SELECT s.*, a.status AS a_status, a.starts_at,
      (SELECT MAX(amount) FROM bids WHERE sublot_id = s.id) AS top,
      (SELECT buyer_id FROM bids WHERE sublot_id = s.id ORDER BY amount DESC LIMIT 1) AS leader
      FROM sublots s JOIN auctions a ON a.id = s.auction_id WHERE s.id = ?`).bind(sublotId).first();
  if (!s) return bad('Sub-lot not found.', 404);
  if (s.a_status !== 'scheduled' || s.ends_at <= t) return bad('Bidding on this sub-lot has closed.', 409);
  if (s.starts_at > t) return bad('This auction has not opened yet.', 409);
  if (s.leader === buyer.id) return bad('You already hold the highest bid on this sub-lot.', 409);
  const min = s.top != null ? s.top + s.increment : s.opening;
  if (amount < min) return json({ error: s.top != null ? `Someone bid first. The next valid bid is ₹${min.toLocaleString('en-IN')}.` : `The opening bid is ₹${min.toLocaleString('en-IN')}.`, next_min: min }, 409);
  return json({ error: `Bids go up in steps of ₹${s.increment.toLocaleString('en-IN')} from the opening bid.`, next_min: min }, 409);
}

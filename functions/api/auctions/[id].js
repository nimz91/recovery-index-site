// GET /api/auctions/:id — the auction room: sub-lots, manifests, standing bids. Polled every few seconds.
import { json, bad, now, needDb, buyerFromRequest } from '../../_lib/util.js';
import { loadAuction } from '../../_lib/auction.js';

export async function onRequestGet({ request, env, params }) {
  const miss = needDb(env); if (miss) return miss;
  const buyer = await buyerFromRequest(request, env);
  const a = await loadAuction(env.DB, params.id, { t: now(), buyerId: buyer && buyer.status === 'approved' ? buyer.id : null });
  if (!a || a.state === 'cancelled') return bad('Auction not found.', 404);
  return json(a);
}

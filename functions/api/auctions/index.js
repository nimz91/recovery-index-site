// GET /api/auctions — live, upcoming and recently ended auctions (no client identities).
import { json, now, needDb } from '../../_lib/util.js';
import { stateOf } from '../../_lib/auction.js';

export async function onRequestGet({ env }) {
  const miss = needDb(env); if (miss) return miss;
  const t = now();
  const { results: auctions } = await env.DB.prepare(
    "SELECT * FROM auctions WHERE status != 'cancelled' AND ends_at > ? ORDER BY starts_at").bind(t - 14 * 86400000).all();
  const out = [];
  for (const a of auctions) {
    const { results: subs } = await env.DB.prepare(`SELECT s.id, s.label, s.units, s.est_lo, s.est_hi, s.ends_at,
        (SELECT COUNT(*) FROM bids b WHERE b.sublot_id = s.id) AS bids
        FROM sublots s WHERE s.auction_id = ?`).bind(a.id).all();
    const photo = await env.DB.prepare('SELECT key FROM photos WHERE lot_id = ? ORDER BY created_at LIMIT 1').bind(a.lot_id).first();
    out.push({
      id: a.id, title: a.title, city: a.city, starts_at: a.starts_at, ends_at: Math.max(a.ends_at, ...subs.map(s => s.ends_at)),
      state: stateOf(a, subs, t), units: subs.reduce((n, s) => n + s.units, 0),
      est_lo: subs.reduce((n, s) => n + s.est_lo, 0), est_hi: subs.reduce((n, s) => n + s.est_hi, 0),
      sublots: subs.map(s => s.label), bids: subs.reduce((n, s) => n + s.bids, 0), cover: photo ? photo.key : null,
    });
  }
  const order = { live: 0, upcoming: 1, ended: 2 };
  out.sort((x, y) => order[x.state] - order[y.state] || x.ends_at - y.ends_at);
  return json({ server_time: t, auctions: out });
}

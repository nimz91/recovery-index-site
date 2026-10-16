// Auction read model shared by the public, buyer and admin endpoints.
import { maskSerial } from './util.js';

export function stateOf(a, sublots, t) {
  if (a.status === 'cancelled') return 'cancelled';
  const end = Math.max(a.ends_at, ...sublots.map(s => s.ends_at));
  if (a.status === 'ended' || t >= end) return 'ended';
  if (t < a.starts_at) return 'upcoming';
  return 'live';
}

// Returns every sub-lot with its standing (top bid, count, reserve met). `admin` adds reserve and bidder identities.
export async function loadAuction(db, id, { t, buyerId = null, admin = false } = {}) {
  const a = await db.prepare('SELECT * FROM auctions WHERE id = ?').bind(id).first();
  if (!a) return null;
  const { results: subs } = await db.prepare('SELECT * FROM sublots WHERE auction_id = ? ORDER BY est_hi DESC').bind(id).all();
  const { results: bids } = await db.prepare(`SELECT b.sublot_id, b.amount, b.created_at, b.buyer_id, u.alias, u.company
      FROM bids b JOIN buyers u ON u.id = b.buyer_id
      WHERE b.sublot_id IN (SELECT id FROM sublots WHERE auction_id = ?) ORDER BY b.amount DESC`).bind(id).all();
  const { results: photos } = await db.prepare('SELECT key, row_no, ai_json FROM photos WHERE lot_id = ? ORDER BY created_at').bind(a.lot_id).all();
  const state = stateOf(a, subs, t);
  const sublots = subs.map(s => {
    const sb = bids.filter(b => b.sublot_id === s.id);
    const top = sb[0];
    const ended = state === 'ended' || t >= s.ends_at;
    const items = JSON.parse(s.items_json || '[]').map(it => (admin ? it : { ...it, serial: maskSerial(it.serial) }));
    const out = {
      id: s.id, label: s.label, bucket: s.bucket, units: s.units, est_lo: s.est_lo, est_hi: s.est_hi,
      opening: s.opening, increment: s.increment, ends_at: s.ends_at, ended,
      top: top ? top.amount : null, bids: sb.length, bidders: new Set(sb.map(b => b.buyer_id)).size,
      next_min: top ? top.amount + s.increment : s.opening,
      reserve_met: !!top && top.amount >= s.reserve,
      leading_alias: top ? top.alias : null,
      you_lead: !!(buyerId && top && top.buyer_id === buyerId),
      you_bid: !!(buyerId && sb.some(b => b.buyer_id === buyerId)),
      history: sb.slice(0, 12).map(b => ({ alias: b.alias, amount: b.amount, at: b.created_at, ...(admin ? { company: b.company } : {}) })),
      items,
    };
    if (admin) { out.reserve = s.reserve; out.leader_company = top ? top.company : null; out.leader_id = top ? top.buyer_id : null; }
    return out;
  });
  return {
    id: a.id, title: a.title, city: a.city, starts_at: a.starts_at, ends_at: Math.max(a.ends_at, ...subs.map(s => s.ends_at)),
    soft_close_sec: a.soft_close_sec, state, server_time: t,
    units: subs.reduce((n, s) => n + (s.units || 0), 0),
    est_lo: subs.reduce((n, s) => n + (s.est_lo || 0), 0), est_hi: subs.reduce((n, s) => n + (s.est_hi || 0), 0),
    sublots,
    photos: photos.map(p => ({ key: p.key, row_no: p.row_no, ai: p.ai_json ? JSON.parse(p.ai_json) : null })),
    ...(admin ? { lot_id: a.lot_id, status: a.status } : {}),
  };
}

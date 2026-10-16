// /api/admin/* — the operator console's API. Every request needs `Authorization: Bearer <ADMIN_KEY>`.
//   GET  lots                     submitted lots
//   GET  lots/:id                 one lot with assets, photos and any auction
//   PUT  lots/:id                 save inspector overrides { assets, status, notes }
//   POST lots/:id/auction         publish an auction { title, city, starts_at, ends_at, soft_close_sec, sublots[] }
//   GET  buyers                   buyer applications
//   POST buyers/:id/approve       approve and issue an access key (shown once)
//   POST buyers/:id/reject
//   GET  auctions                 all auctions
//   GET  auctions/:id             standing incl. reserves and bidder companies
//   POST auctions/:id/end         close now
//   POST auctions/:id/cancel
import { E } from '../../_lib/engine.js';
import { json, bad, uid, sha256, now, needDb, isAdmin, clean } from '../../_lib/util.js';
import { loadAuction, stateOf } from '../../_lib/auction.js';

export async function onRequest({ request, env, params }) {
  const miss = needDb(env); if (miss) return miss;
  if (!env.ADMIN_KEY) return bad('Set the ADMIN_KEY secret to use the console.', 503);
  if (!isAdmin(request, env)) return bad('Wrong admin key.', 401);
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const [res, id, action] = parts;
  const m = request.method;
  const db = env.DB;
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  if (res === 'lots' && !id && m === 'GET') {
    const { results } = await db.prepare(`SELECT l.id, l.ref, l.created_at, l.status, l.company, l.contact, l.email, l.phone, l.city,
        l.units, l.est_lo, l.est_hi, (SELECT COUNT(*) FROM photos p WHERE p.lot_id = l.id) AS photos,
        (SELECT id FROM auctions a WHERE a.lot_id = l.id AND a.status != 'cancelled' ORDER BY created_at DESC LIMIT 1) AS auction_id
        FROM lots l ORDER BY l.created_at DESC LIMIT 500`).all();
    return json({ lots: results });
  }

  if (res === 'lots' && id && !action && m === 'GET') {
    const l = await db.prepare('SELECT * FROM lots WHERE id = ?').bind(id).first();
    if (!l) return bad('Lot not found.', 404);
    const { results: photos } = await db.prepare('SELECT key, row_no, ai_json, created_at FROM photos WHERE lot_id = ? ORDER BY created_at').bind(id).all();
    const auction = await db.prepare("SELECT id FROM auctions WHERE lot_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1").bind(id).first();
    const { rows_json, upload_token_hash, assets_json, ...rest } = l;
    return json({ ...rest, assets: JSON.parse(assets_json || '[]'), photos: photos.map(p => ({ ...p, ai: p.ai_json ? JSON.parse(p.ai_json) : null })), auction_id: auction ? auction.id : null });
  }

  if (res === 'lots' && id && !action && m === 'PUT') {
    const b = await body();
    const l = await db.prepare('SELECT * FROM lots WHERE id = ?').bind(id).first();
    if (!l) return bad('Lot not found.', 404);
    let assets = JSON.parse(l.assets_json || '[]');
    if (Array.isArray(b.assets)) {
      const byRow = new Map(b.assets.map(a => [a.row, a]));
      assets = assets.map(a => {
        const o = byRow.get(a.row);
        if (!o) return a;
        return {
          ...a,
          status: Object.keys(E.STATUS_LABEL).includes(o.status) ? o.status : a.status,
          grade: ['A', 'B', 'C', 'D'].includes(o.grade) ? o.grade : a.grade,
          verified: !!o.verified, gradeKnown: a.gradeKnown || !!o.verified,
          defects: Array.isArray(o.defects) ? o.defects.filter(d => E.DEFECT_LABEL[d]) : a.defects,
        };
      });
    }
    const v = E.valueLot(assets, E.DEFAULTS, null, {});
    const status = ['submitted', 'inspecting', 'ready', 'auction', 'sold', 'withdrawn'].includes(b.status) ? b.status : l.status;
    await db.prepare('UPDATE lots SET assets_json = ?, units = ?, est_lo = ?, est_hi = ?, status = ?, notes = ? WHERE id = ?')
      .bind(JSON.stringify(assets), v.units, v.lo, v.hi, status, b.notes != null ? clean(b.notes, 2000) : l.notes, id).run();
    return json({ ok: true, units: v.units, est_lo: v.lo, est_hi: v.hi, status });
  }

  if (res === 'lots' && id && action === 'auction' && m === 'POST') {
    const b = await body();
    const l = await db.prepare('SELECT id, city FROM lots WHERE id = ?').bind(id).first();
    if (!l) return bad('Lot not found.', 404);
    const starts = Number(b.starts_at), ends = Number(b.ends_at);
    if (!clean(b.title)) return bad('Give the auction a title.');
    if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return bad('The auction must end after it starts.');
    if (ends < now()) return bad('The closing time is in the past.');
    if (!Array.isArray(b.sublots) || !b.sublots.length) return bad('Add at least one sub-lot.');
    const subs = [];
    for (const s of b.sublots) {
      const o = Math.round(+s.opening), r = Math.round(+s.reserve), inc = Math.round(+s.increment);
      if (!(o > 0 && r >= o && inc > 0)) return bad(`Check "${clean(s.label)}": opening > 0, reserve ≥ opening, increment > 0.`);
      subs.push({ id: uid(10), label: clean(s.label, 120), bucket: clean(s.bucket, 20), units: Math.round(+s.units) || 0,
        est_lo: Math.round(+s.est_lo) || 0, est_hi: Math.round(+s.est_hi) || 0, opening: o, reserve: r, increment: inc,
        items: JSON.stringify((Array.isArray(s.items) ? s.items : []).slice(0, 2000)) });
    }
    const aid = uid(10);
    const soft = Math.min(900, Math.max(0, Math.round(+b.soft_close_sec || 120)));
    await db.batch([
      db.prepare('INSERT INTO auctions (id, lot_id, title, city, created_at, starts_at, ends_at, soft_close_sec, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(aid, id, clean(b.title, 160), clean(b.city || l.city, 80), now(), starts, ends, soft, 'scheduled'),
      ...subs.map(s => db.prepare(`INSERT INTO sublots (id, auction_id, label, bucket, units, est_lo, est_hi, opening, reserve, increment, ends_at, items_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s.id, aid, s.label, s.bucket, s.units, s.est_lo, s.est_hi, s.opening, s.reserve, s.increment, ends, s.items)),
      db.prepare("UPDATE lots SET status = 'auction' WHERE id = ?").bind(id),
    ]);
    return json({ id: aid }, 201);
  }

  if (res === 'buyers' && !id && m === 'GET') {
    const { results } = await db.prepare(`SELECT id, created_at, status, company, contact, email, phone, city, gstin, category, authorisation, alias,
        (SELECT COUNT(*) FROM bids b WHERE b.buyer_id = buyers.id) AS bids FROM buyers ORDER BY created_at DESC`).all();
    return json({ buyers: results });
  }
  if (res === 'buyers' && id && action === 'approve' && m === 'POST') {
    const u = await db.prepare('SELECT * FROM buyers WHERE id = ?').bind(id).first();
    if (!u) return bad('Buyer not found.', 404);
    const token = 'rib_' + uid(16);
    let alias = u.alias;
    if (!alias) { const { n } = await db.prepare('SELECT COUNT(*) AS n FROM buyers WHERE alias IS NOT NULL').first(); alias = 'Bidder ' + (n + 1); }
    await db.prepare("UPDATE buyers SET status = 'approved', token_hash = ?, alias = ? WHERE id = ?").bind(await sha256(token), alias, id).run();
    return json({ token, alias, message: 'Send this access key to the buyer. It is shown only once; approving again issues a new key.' });
  }
  if (res === 'buyers' && id && action === 'reject' && m === 'POST') {
    await db.prepare("UPDATE buyers SET status = 'rejected', token_hash = NULL WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  if (res === 'auctions' && !id && m === 'GET') {
    const { results } = await db.prepare(`SELECT a.*, l.ref, l.company FROM auctions a JOIN lots l ON l.id = a.lot_id ORDER BY a.created_at DESC LIMIT 200`).all();
    const t = now();
    const out = [];
    for (const a of results) {
      const { results: subs } = await db.prepare(`SELECT s.ends_at, s.reserve,
          (SELECT MAX(amount) FROM bids WHERE sublot_id = s.id) AS top, (SELECT COUNT(*) FROM bids WHERE sublot_id = s.id) AS n
          FROM sublots s WHERE s.auction_id = ?`).bind(a.id).all();
      out.push({ id: a.id, title: a.title, ref: a.ref, company: a.company, city: a.city, starts_at: a.starts_at,
        ends_at: Math.max(a.ends_at, ...subs.map(s => s.ends_at)), state: stateOf(a, subs, t),
        bids: subs.reduce((n, s) => n + s.n, 0), top_total: subs.reduce((n, s) => n + (s.top || 0), 0),
        sold_value: subs.reduce((n, s) => n + (s.top && s.top >= s.reserve ? s.top : 0), 0) });
    }
    return json({ auctions: out });
  }
  if (res === 'auctions' && id && !action && m === 'GET') {
    const a = await loadAuction(db, id, { t: now(), admin: true });
    return a ? json(a) : bad('Auction not found.', 404);
  }
  if (res === 'auctions' && id && (action === 'end' || action === 'cancel') && m === 'POST') {
    const t = now();
    await db.batch([
      db.prepare('UPDATE auctions SET status = ?, ends_at = MIN(ends_at, ?) WHERE id = ?').bind(action === 'end' ? 'ended' : 'cancelled', t, id),
      db.prepare('UPDATE sublots SET ends_at = MIN(ends_at, ?) WHERE auction_id = ?').bind(t, id),
    ]);
    return json({ ok: true });
  }

  return bad('Unknown admin route.', 404);
}

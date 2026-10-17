// POST /api/ingest — paste Shree Ji Rate Service WhatsApp bulletins; rows are parsed and stored in KV.
// Body (JSON): { text, date?: "YYYY-MM-DD" (for messages copied without a WhatsApp header), save?: boolean }
// Header: Authorization: Bearer <INGEST_TOKEN>   (INGEST_TOKEN is a secret set on the Pages project)
// Without save=true it only previews (parsed rows, values dropped as implausible, big moves vs the last rate).
import { parse } from '../../lib/shreeji.js';

const MOVE_WARN = 0.06; // flag a Delhi grade whose mid moved more than this vs its last known rate

function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function onRequestPost({ request, env }) {
  if (!env.INGEST_TOKEN) return Response.json({ ok: false, error: 'Ingest is switched off: set the INGEST_TOKEN secret on the Pages project.' }, { status: 503 });
  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameToken(auth, env.INGEST_TOKEN)) return Response.json({ ok: false, error: 'Wrong access code.' }, { status: 401 });
  if (!env.LIVE) return Response.json({ ok: false, error: 'LIVE KV namespace is not bound.' }, { status: 500 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Send JSON.' }, { status: 400 }); }
  const text = String(body.text || '');
  if (text.length < 20) return Response.json({ ok: false, error: 'Paste at least one bulletin.' }, { status: 400 });
  if (text.length > 400000) return Response.json({ ok: false, error: 'Too long; paste up to a few days at a time.' }, { status: 413 });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : istToday();
  const nowIST = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 16);
  const out = parse(text, { fallbackDate: date, fallbackTime: nowIST });
  const future = istToday();
  out.scrap = out.scrap.filter((r) => r.date <= future);
  out.market = out.market.filter((r) => r.date <= future);

  // Compare Delhi grades with their last known mid (site data + earlier pastes).
  const last = {};
  try {
    const res = await env.ASSETS.fetch(new URL('/data/scrap.json', request.url));
    if (res.ok) (await res.json()).forEach((r) => { if (!last[r.code] || r.date > last[r.code].date) last[r.code] = r; });
  } catch { /* preview still works */ }
  const index = (await env.LIVE.get('sj:dates', 'json')) || [];
  for (const d of index.slice(-10)) {
    const day = await env.LIVE.get('sj:' + d, 'json');
    (day?.scrap || []).forEach((r) => { if (!last[r.code] || r.date > last[r.code].date) last[r.code] = r; });
  }
  const warnings = [];
  for (const r of out.scrap) {
    const p = last[r.code];
    if (!p || p.date >= r.date) continue;
    const a = (Number(p.buy) + Number(p.sell)) / 2, b = (r.buy + r.sell) / 2;
    const move = b / a - 1;
    if (Math.abs(move) > MOVE_WARN) warnings.push({ code: r.code, grade: `${r.metal} ${r.grade}`, from: a, to: b, since: p.date, move: Math.round(move * 1000) / 10 });
  }

  let saved = null;
  if (body.save) {
    const byDate = {};
    for (const r of out.scrap) (byDate[r.date] = byDate[r.date] || { scrap: [], market: [] }).scrap.push(r);
    for (const r of out.market) (byDate[r.date] = byDate[r.date] || { scrap: [], market: [] }).market.push(r);
    for (const [d, add] of Object.entries(byDate)) {
      const cur = (await env.LIVE.get('sj:' + d, 'json')) || { scrap: [], market: [] };
      const S = new Map(cur.scrap.map((r) => [r.code, r])), M = new Map(cur.market.map((r) => [[r.section, r.market, r.item].join('|'), r]));
      add.scrap.forEach((r) => S.set(r.code, r));
      add.market.forEach((r) => { const k = [r.section, r.market, r.item].join('|'); const o = M.get(k); if (!o || (o.time || '') <= (r.time || '')) M.set(k, r); });
      await env.LIVE.put('sj:' + d, JSON.stringify({ scrap: [...S.values()], market: [...M.values()], updated: new Date().toISOString() }));
      if (!index.includes(d)) index.push(d);
    }
    index.sort();
    while (index.length > 60) index.shift();
    await env.LIVE.put('sj:dates', JSON.stringify(index));
    saved = Object.keys(byDate).sort();
  }

  const count = (rows) => rows.reduce((a, r) => { a[r.date] = (a[r.date] || 0) + 1; return a; }, {});
  return Response.json({
    ok: true, saved, messages: out.messages,
    delhi: out.scrap.sort((a, b) => (a.date + a.code < b.date + b.code ? -1 : 1)),
    market_counts: count(out.market), delhi_counts: count(out.scrap),
    sections: [...new Set(out.market.map((r) => r.section))],
    dropped: out.dropped, unknown: out.unknown, warnings,
  });
}

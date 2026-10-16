// POST /api/lots — a client submits an asset register for inspection and auction.
// The server re-runs the valuation itself so the stored estimate can't be edited in the browser.
import { E } from '../_lib/engine.js';
import { json, bad, uid, ref, sha256, now, needDb, clean, validEmail, validPhone } from '../_lib/util.js';

const DEFECTS = new Set(Object.keys(E.DEFECT_LABEL));

export function applyHints(assets, hints) {
  if (!hints || typeof hints !== 'object') return;
  for (const a of assets) {
    const h = hints[a.row];
    if (!h) continue;
    if (['A', 'B', 'C', 'D'].includes(h.grade)) { a.grade = h.grade; a.gradeKnown = true; a.aiGraded = true; }
    if (Array.isArray(h.defects)) for (const d of h.defects) if (DEFECTS.has(d) && !a.defects.includes(d)) a.defects.push(d);
    a.photos = Math.max(a.photos || 0, 1);
  }
}

export async function onRequestPost({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  let body;
  try { body = await request.json(); } catch { return bad('Send the lot as JSON.'); }

  const f = {
    company: clean(body.company, 160), contact: clean(body.contact, 120), email: clean(body.email, 160).toLowerCase(),
    phone: clean(body.phone, 20), city: clean(body.city, 80), address: clean(body.address, 400), gstin: clean(body.gstin, 20).toUpperCase(),
    file_name: clean(body.file_name, 160), notes: clean(body.notes, 1000),
  };
  if (!f.company || !f.contact) return bad('Company and contact name are required.');
  if (!validEmail(f.email)) return bad('Enter a valid email address.');
  if (!validPhone(f.phone)) return bad('Enter a valid phone number.');
  if (!f.city) return bad('Enter the pickup city.');
  if (body.consent !== true) return bad('Please confirm the declaration before submitting.');
  if (!Array.isArray(body.rows) || body.rows.length < 2) return bad('The asset register is empty.');
  if (body.rows.length > 5001) return bad('Split registers over 5,000 rows into separate lots.');

  const rows = body.rows.map(r => (Array.isArray(r) ? r.slice(0, 60).map(c => (typeof c === 'number' ? c : clean(c, 300))) : []));
  const parsed = E.parseSheet(rows);
  if (!parsed.assets.length) return bad('No device rows were found. Make sure the sheet has a header row with Model or Brand.');
  applyHints(parsed.assets, body.hints);
  const lot = E.valueLot(parsed.assets, E.DEFAULTS, null, {});

  const id = uid(12), uploadToken = uid(16);
  let lotRef = ref();
  for (let i = 0; i < 3; i++) {
    const clash = await env.DB.prepare('SELECT 1 FROM lots WHERE ref = ?').bind(lotRef).first();
    if (!clash) break;
    lotRef = ref();
  }
  await env.DB.prepare(`INSERT INTO lots (id, ref, created_at, status, company, contact, email, phone, city, address, gstin, file_name,
      rows_json, assets_json, units, est_lo, est_hi, upload_token_hash, notes)
      VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, lotRef, now(), f.company, f.contact, f.email, f.phone, f.city, f.address, f.gstin, f.file_name,
      JSON.stringify(rows), JSON.stringify(parsed.assets), lot.units, lot.lo, lot.hi, await sha256(uploadToken), f.notes)
    .run();

  return json({ id, ref: lotRef, upload_token: uploadToken, units: lot.units, est_lo: lot.lo, est_hi: lot.hi }, 201);
}

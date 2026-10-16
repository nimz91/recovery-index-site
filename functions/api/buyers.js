// POST /api/buyers — a registered ITAD, refurbisher or recycler applies to bid. An admin approves and issues an access key.
import { json, bad, uid, now, needDb, clean, validEmail, validPhone } from '../_lib/util.js';

// E-Waste (Management) Rules, 2022: bulk consumers may hand e-waste only to registered producers, refurbishers or recyclers,
// so every bidder must give a CPCB EPR-portal registration (or SPCB authorisation) number.
const CATS = ['itad', 'refurbisher', 'recycler'];

export async function onRequestPost({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  let b;
  try { b = await request.json(); } catch { return bad('Send the application as JSON.'); }
  const f = {
    company: clean(b.company, 160), contact: clean(b.contact, 120), email: clean(b.email, 160).toLowerCase(), phone: clean(b.phone, 20),
    city: clean(b.city, 80), gstin: clean(b.gstin, 20).toUpperCase(), category: clean(b.category, 20), authorisation: clean(b.authorisation, 80),
  };
  if (!f.company || !f.contact) return bad('Company and contact name are required.');
  if (!validEmail(f.email)) return bad('Enter a valid email address.');
  if (!validPhone(f.phone)) return bad('Enter a valid phone number.');
  if (!CATS.includes(f.category)) return bad('Choose what kind of buyer you are.');
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(f.gstin)) return bad('Enter a valid 15-character GSTIN.');
  if (!f.authorisation) return bad('Enter your CPCB EPR-portal registration or SPCB authorisation number.');
  if (b.consent !== true) return bad('Please accept the bidding terms.');
  const dup = await env.DB.prepare("SELECT status FROM buyers WHERE email = ? AND status != 'rejected'").bind(f.email).first();
  if (dup) return json({ status: dup.status, message: 'An application with this email already exists.' });
  await env.DB.prepare(`INSERT INTO buyers (id, created_at, status, company, contact, email, phone, city, gstin, category, authorisation)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(uid(10), now(), f.company, f.contact, f.email, f.phone, f.city, f.gstin, f.category, f.authorisation).run();
  return json({ status: 'pending' }, 201);
}

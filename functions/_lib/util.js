// Shared helpers for the ITAD valuation + auction API.

export const now = () => Date.now();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
export const bad = (message, status = 400) => json({ error: message }, status);

export function uid(len = 16) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Human-friendly reference without look-alike characters
export function ref(prefix = 'RI') {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  return prefix + '-' + [...a].map(b => abc[b % abc.length]).join('');
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Constant-time-ish compare for the admin key
export function sameKey(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function isAdmin(request, env) {
  return !!env.ADMIN_KEY && sameKey(bearer(request), env.ADMIN_KEY);
}

export async function buyerFromRequest(request, env) {
  const t = bearer(request);
  if (!t) return null;
  const h = await sha256(t);
  return env.DB.prepare('SELECT * FROM buyers WHERE token_hash = ?').bind(h).first();
}

export function needDb(env) {
  if (!env.DB) return bad('The ITAD database is not set up yet (D1 binding "DB" is missing).', 503);
  return null;
}

export const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const validPhone = p => /^[+\d][\d\s-]{7,15}$/.test(p);

// Masks a serial for buyers: last 4 visible
export const maskSerial = s => (s && s.length > 4 ? '••••' + s.slice(-4) : s || '');

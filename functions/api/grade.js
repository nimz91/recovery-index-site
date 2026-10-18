// POST /api/grade — AI condition grading of one device photo with Claude (vision).
// Body: { image: <base64, no data: prefix>, media_type: "image/jpeg" }
// Returns a suggested cosmetic grade A–D, defects in the valuation engine's vocabulary, and any lock/no-display signs.
import { json, bad, now, needDb } from '../_lib/util.js';

const DAILY_LIMIT = 120; // per IP
const DEFECTS = ['screen_broken', 'screen_blemish', 'keyboard', 'keycap_wear', 'battery_missing', 'hinge', 'body_damage'];

const PROMPT = `You are grading a used IT asset (laptop, desktop, workstation or monitor) for a bulk resale auction in India.
Look only at what is visible in this photo. Grade cosmetics on the ITAD scale:
A = like new, no visible marks. B = light wear, minor scratches or scuffs. C = clear wear: deep scratches, dents, worn or discoloured paint, rubber feet missing, visible key shine.
D = damaged: cracks, broken plastics, bent lid or base, missing parts.
Laptop parts are named A (lid/top cover), B (screen bezel), C (palm rest/keyboard deck), D (bottom base).
Defect codes (use only these): screen_broken (cracked or smashed LCD), screen_blemish (dots, lines, patches, pressure marks on the screen),
keyboard (missing or broken keys), keycap_wear (faded or shiny keys), battery_missing (empty bay or swollen battery lifting the case),
hinge (broken or loose hinge, cracked hinge cover), body_damage (cracked or broken casing).
Status hints: "locked" if a BIOS password, Computrace, MDM, iCloud or Activation Lock screen is shown; "no_display" if powered with a black screen;
"on" if a working desktop/BIOS/OS screen is shown; otherwise "unknown".
Reply with JSON only, no prose, in exactly this shape:
{"device":"laptop|desktop|workstation|monitor|other","model_guess":"brand and model if readable, else empty",
"label_text":"serial or asset tag text if readable, else empty","parts_visible":["A","B","C","D","screen","ports"],
"grade":"A|B|C|D","defects":[],"status_hint":"on|locked|no_display|unknown","confidence":0.0,"notes":"one short sentence a buyer would want to know"}
If the photo does not show an IT device, set device to "other", grade to "B" and confidence to 0.`;

export async function onRequestPost({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  if (!env.ANTHROPIC_API_KEY) return bad('AI grading is not set up yet (ANTHROPIC_API_KEY secret is missing).', 503);
  let body;
  try { body = await request.json(); } catch { return bad('Send the photo as JSON.'); }
  const media = String(body.media_type || 'image/jpeg');
  const data = String(body.image || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(media)) return bad('Use a JPEG, PNG or WebP photo.');
  if (!data || data.length > 6_000_000) return bad('The photo is missing or too large. Resize it under 4 MB.');

  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(`INSERT INTO grade_log (ip, day, n) VALUES (?, ?, 1)
      ON CONFLICT(ip, day) DO UPDATE SET n = n + 1 RETURNING n`).bind(ip, day).first();
  if (row && row.n > DAILY_LIMIT) return bad('Daily photo-grading limit reached. The inspection team will grade the rest on site.', 429);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': String(env.ANTHROPIC_API_KEY).trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: media, data } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  if (!res.ok) {
    let e = {};
    try { e = (await res.json()).error || {}; } catch {}
    console.log('grade error', res.status, e.type, e.message);
    // Plain-language reason for the operator; never includes the key itself.
    const why = res.status === 401 ? 'the API key was not accepted'
      : res.status === 404 ? `the model "${env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'}" was not found`
      : res.status === 429 ? 'the API rate limit was hit' : res.status === 529 ? 'the API is overloaded'
      : /credit/i.test(e.message || '') ? 'the API account is out of credit' : `the API returned ${res.status}`;
    return json({ error: `Photo grading is unavailable: ${why}. The inspector will grade on site.`, upstream: { status: res.status, type: e.type || null, message: String(e.message || '').slice(0, 200) } }, 502);
  }
  const out = await res.json();
  const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return json(normalise(text));
}

export function normalise(text) {
  let g = {};
  const m = text.match(/\{[\s\S]*\}/);
  try { g = m ? JSON.parse(m[0]) : {}; } catch { g = {}; }
  const conf = Math.max(0, Math.min(1, Number(g.confidence) || 0));
  return {
    device: ['laptop', 'desktop', 'workstation', 'monitor', 'other'].includes(g.device) ? g.device : 'other',
    model_guess: String(g.model_guess || '').slice(0, 80),
    label_text: String(g.label_text || '').slice(0, 60),
    parts_visible: Array.isArray(g.parts_visible) ? g.parts_visible.map(String).slice(0, 8) : [],
    grade: ['A', 'B', 'C', 'D'].includes(g.grade) ? g.grade : 'B',
    defects: Array.isArray(g.defects) ? g.defects.filter(d => DEFECTS.includes(d)) : [],
    status_hint: ['on', 'locked', 'no_display', 'unknown'].includes(g.status_hint) ? g.status_hint : 'unknown',
    confidence: conf,
    notes: String(g.notes || '').slice(0, 200),
    graded_at: now(),
  };
}

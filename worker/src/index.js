// The Recovery Index — live metals updater.
// Runs on the schedule in wrangler.toml (4 times each weekday, IST business hours), pulls the latest metal prices
// and USD/INR from metals.dev, checks them, and stores them in the LIVE KV namespace that the website's
// /api/live endpoint reads.
//
// Accuracy safeguards:
//  - Plausibility check: a price that moved more than MAX_MOVE from the last accepted value is held back
//    (the last good value is kept and the rejection is logged in `anomalies`), unless a second fetch confirms it.
//  - Daily closes: the last accepted snapshot of each IST day is kept in `closes`, so the site has a
//    machine-recorded daily history that does not depend on anyone copying numbers by hand.
//  - Quota guard: metals.dev requests are counted per month and never exceed MONTHLY_LIMIT.

const TROY_OZ_KG = 0.0311034768;

// Our instrument code -> metals.dev keys to try, in order of preference.
const MAP = {
  CU: ['lme_copper', 'copper'],
  AL: ['lme_aluminum', 'aluminum'],
  ZN: ['lme_zinc', 'zinc'],
  PB: ['lme_lead', 'lead'],
  NI: ['lme_nickel', 'nickel'],
  XAU: ['gold'],
  XAG: ['silver'],
  XPT: ['platinum'],
  XPD: ['palladium'],
};
// India prices that metals.dev may include in the same response (converted back to rupees).
// Captured only if present; no extra request is made.
const INDIA = {
  'MCX-CU': ['mcx_copper'], 'MCX-AL': ['mcx_aluminum'], 'MCX-ZN': ['mcx_zinc'], 'MCX-PB': ['mcx_lead'], 'MCX-NI': ['mcx_nickel'],
  'MCX-XAU': ['mcx_gold'], 'MCX-XAG': ['mcx_silver'], 'IBJA-XAU': ['ibja_gold'],
};
const PRECIOUS = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const MAX_MOVE = { default: 0.08, USDINR: 0.02 }; // vs last accepted value
const KEEP_POINTS = 400;
const KEEP_CLOSE_DAYS = 400;
const MONTHLY_LIMIT_DEFAULT = 100;

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const monthKey = (d = new Date()) => 'calls:' + d.toISOString().slice(0, 7);

async function fetchMetals(env) {
  const limit = Number(env.MONTHLY_LIMIT || MONTHLY_LIMIT_DEFAULT);
  const mk = monthKey();
  const used = Number((await env.LIVE.get(mk)) || 0);
  if (used >= limit) throw new Error(`monthly metals.dev limit reached (${used}/${limit}); skipping`);
  await env.LIVE.put(mk, String(used + 1), { expirationTtl: 40 * 86400 });
  const url = `https://api.metals.dev/v1/latest?api_key=${encodeURIComponent(env.METALS_API_KEY)}&currency=USD&unit=kg`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`metals.dev HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success' || !body.metals) throw new Error(`metals.dev error: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function extract(body) {
  const prices = {}, india = {};
  const pick = (keys) => keys.find((k) => typeof body.metals[k] === 'number' && body.metals[k] > 0);
  for (const [code, keys] of Object.entries(MAP)) {
    const key = pick(keys);
    if (!key) continue;
    const perKg = body.metals[key];
    prices[code] = PRECIOUS.has(code) ? round(perKg * TROY_OZ_KG, 2) : round(perKg * 1000, 2);
  }
  // currencies.INR is USD per 1 INR; we publish INR per 1 USD.
  const inr = body.currencies && body.currencies.INR;
  if (typeof inr === 'number' && inr > 0) prices.USDINR = round(1 / inr, 4);
  if (prices.USDINR) {
    for (const [code, keys] of Object.entries(INDIA)) {
      const key = pick(keys);
      if (!key) continue;
      const inrPerKg = body.metals[key] * prices.USDINR;
      // Gold in ₹/10 g (Indian convention), others ₹/kg.
      india[code] = /XAU/.test(code) ? round(inrPerKg / 100, 0) : round(inrPerKg, 2);
    }
  }
  return { prices, india };
}

async function update(env) {
  if (!env.METALS_API_KEY) throw new Error('METALS_API_KEY secret is not set');
  const now = new Date();
  const body = await fetchMetals(env);
  const { prices, india } = extract(body);
  const prev = (await env.LIVE.get('latest', 'json')) || null;
  const anomalies = (await env.LIVE.get('anomalies', 'json')) || [];
  const pending = (await env.LIVE.get('pending', 'json')) || {};

  // Plausibility: hold back an implausible jump unless the previous run saw the same new level (pending).
  const accepted = { ...prices };
  const held = {};
  if (prev && prev.prices) {
    for (const [code, p] of Object.entries(prices)) {
      const old = prev.prices[code];
      if (!old) continue;
      const lim = MAX_MOVE[code] || MAX_MOVE.default;
      const move = p / old - 1;
      if (Math.abs(move) <= lim) { delete pending[code]; continue; }
      const confirm = pending[code] && Math.abs(p / pending[code] - 1) <= lim / 4;
      if (confirm) { delete pending[code]; continue; }
      pending[code] = p;
      accepted[code] = old;
      held[code] = { old, new: p, move: round(move, 4) };
      anomalies.push({ at: now.toISOString(), code, old, new: p, move: round(move, 4), action: 'held' });
    }
  }
  while (anomalies.length > 100) anomalies.shift();

  const snap = {
    ts: body.timestamp || now.toISOString(),
    fetched: now.toISOString(),
    source: 'metals.dev',
    prices: accepted,
    ...(Object.keys(india).length ? { india } : {}),
    ...(Object.keys(held).length ? { held } : {}),
  };
  const intraday = (await env.LIVE.get('intraday', 'json')) || [];
  intraday.push({ ts: snap.ts, prices: snap.prices });
  while (intraday.length > KEEP_POINTS) intraday.shift();

  // Daily close: last accepted snapshot of each IST day.
  const closes = (await env.LIVE.get('closes', 'json')) || {};
  closes[istDate(now)] = { ts: snap.ts, prices: snap.prices, ...(snap.india ? { india: snap.india } : {}) };
  const days = Object.keys(closes).sort();
  while (days.length > KEEP_CLOSE_DAYS) delete closes[days.shift()];

  await Promise.all([
    env.LIVE.put('latest', JSON.stringify(snap)),
    env.LIVE.put('intraday', JSON.stringify(intraday)),
    env.LIVE.put('closes', JSON.stringify(closes)),
    env.LIVE.put('pending', JSON.stringify(pending)),
    env.LIVE.put('anomalies', JSON.stringify(anomalies)),
    env.LIVE.put('last_ok', snap.fetched),
    env.LIVE.put('raw_keys', JSON.stringify({ metals: Object.keys(body.metals || {}), currencies: Object.keys(body.currencies || {}).length })),
  ]);
  return snap;
}

function weekday(now = new Date()) {
  const d = new Date(now.getTime() + 5.5 * 3600e3).getUTCDay(); // IST day
  return d >= 1 && d <= 5;
}

export default {
  async scheduled(event, env, ctx) {
    await env.LIVE.put('last_cron', new Date().toISOString());
    if (!weekday()) return;
    ctx.waitUntil(
      update(env).catch(async (err) => {
        await env.LIVE.put('last_error', JSON.stringify({ at: new Date().toISOString(), message: String(err.message || err) }));
      }),
    );
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    // GET /refresh runs one update now (for setup checks). It reuses the stored result if the last successful
    // fetch is under 3 hours old, so it cannot burn through the monthly quota.
    if (url.pathname === '/refresh') {
      const lastOk = await env.LIVE.get('last_ok');
      if (lastOk && Date.now() - new Date(lastOk) < 3 * 3600 * 1000) {
        return Response.json({ ok: true, cached: true, latest: await env.LIVE.get('latest', 'json') });
      }
      try {
        return Response.json({ ok: true, cached: false, latest: await update(env) });
      } catch (err) {
        const e = { at: new Date().toISOString(), message: String(err.message || err) };
        await env.LIVE.put('last_error', JSON.stringify(e));
        return Response.json({ ok: false, error: e }, { status: 502 });
      }
    }
    if (url.pathname === '/status') {
      const keys = ['latest', 'last_error', 'last_ok', 'last_cron', 'anomalies', 'raw_keys', monthKey()];
      const [latest, err, ok, cron, anomalies, raw, used] = await Promise.all(keys.map((k) => (/^(latest|last_error|anomalies|raw_keys)$/.test(k) ? env.LIVE.get(k, 'json') : env.LIVE.get(k))));
      return Response.json({
        last_cron: cron, last_ok: ok, last_error: err,
        calls_this_month: Number(used || 0), monthly_limit: Number(env.MONTHLY_LIMIT || MONTHLY_LIMIT_DEFAULT),
        recent_anomalies: (anomalies || []).slice(-10), api_fields: raw, latest,
      });
    }
    return new Response('Recovery Index live updater. See /status or /refresh.', { status: 200 });
  },
};

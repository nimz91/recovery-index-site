// The Recovery Index — live metals updater.
// Runs every 5 minutes (see wrangler.toml), pulls the latest metal prices and
// USD/INR from metals.dev, and stores them in the LIVE KV namespace that the
// website's /api/live endpoint reads.

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
const PRECIOUS = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const KEEP_POINTS = 288; // 24 hours of 5-minute snapshots

async function update(env) {
  if (!env.METALS_API_KEY) throw new Error('METALS_API_KEY secret is not set');
  // Prices are requested per kg in USD so every metal comes back in one unit;
  // we convert to USD/t (industrial) and USD/oz (precious) below.
  const url = `https://api.metals.dev/v1/latest?api_key=${encodeURIComponent(env.METALS_API_KEY)}&currency=USD&unit=kg`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`metals.dev HTTP ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success' || !body.metals) throw new Error(`metals.dev error: ${JSON.stringify(body).slice(0, 300)}`);

  const prices = {};
  for (const [code, keys] of Object.entries(MAP)) {
    const key = keys.find((k) => typeof body.metals[k] === 'number' && body.metals[k] > 0);
    if (!key) continue;
    const perKg = body.metals[key];
    prices[code] = PRECIOUS.has(code) ? round(perKg * TROY_OZ_KG, 2) : round(perKg * 1000, 2);
  }
  // currencies.INR is USD per 1 INR; we publish INR per 1 USD.
  const inr = body.currencies && body.currencies.INR;
  if (typeof inr === 'number' && inr > 0) prices.USDINR = round(1 / inr, 4);

  const snap = { ts: body.timestamp || new Date().toISOString(), fetched: new Date().toISOString(), source: 'metals.dev', prices };
  const intraday = (await env.LIVE.get('intraday', 'json')) || [];
  intraday.push(snap);
  while (intraday.length > KEEP_POINTS) intraday.shift();
  await env.LIVE.put('latest', JSON.stringify(snap));
  await env.LIVE.put('intraday', JSON.stringify(intraday));
  await env.LIVE.put('last_ok', snap.fetched);
  return snap;
}

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

function marketOpen(now = new Date()) {
  // Metals trade roughly Sunday 22:00 UTC to Friday 22:00 UTC. Skipping the
  // weekend keeps 5-minute polling inside a ~6,500 requests/month quota.
  const d = now.getUTCDay(), h = now.getUTCHours();
  if (d === 6) return false;
  if (d === 0 && h < 22) return false;
  if (d === 5 && h >= 22) return false;
  return true;
}

export default {
  async scheduled(event, env, ctx) {
    if (!marketOpen()) return;
    ctx.waitUntil(
      update(env).catch(async (err) => {
        await env.LIVE.put('last_error', JSON.stringify({ at: new Date().toISOString(), message: String(err.message || err) }));
      }),
    );
  },
  // GET /status shows the last update and error; useful when setting up.
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/status') {
      const [latest, err, ok] = await Promise.all([env.LIVE.get('latest', 'json'), env.LIVE.get('last_error', 'json'), env.LIVE.get('last_ok')]);
      return Response.json({ last_ok: ok, last_error: err, latest });
    }
    return new Response('Recovery Index live updater. See /status.', { status: 200 });
  },
};

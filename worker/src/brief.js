// The Recovery Index — Evening Brief.
// Runs Mon–Sat at 20:00 IST (cron in wrangler.toml). Builds one email from what is already live on the site:
//   - news stories Nimit has merged (public/data/news.json) that no earlier brief has carried, India first;
//   - a price snapshot from this worker's own metals.dev daily closes (LME base metals, gold, silver, USD/INR).
// Third-party prices (Fastmarkets, Benchmark, SMM, dealer boards) are deliberately NOT emailed; the email links
// to the site for those.
//
// Sending: Brevo (free plan) email campaign to one list, created and sent through the Brevo API.
// Safety:
//   - BRIEF_MODE = "off"     -> do nothing
//                = "preview" -> build the email and store it (served at /brief/preview), never send   [default]
//                = "send"    -> build, store and send to the list
//   - Never sends twice for the same IST date (KV lock written before the send call).
//   - Skips the day when there are no new stories and the prices have not moved since the last brief.
//   - On any failure, emails ALERT_EMAIL (if set) through Brevo's transactional API and records brief:last_error.

const BREVO = 'https://api.brevo.com/v3';
const ROWS = [ // code, label, unit kind
  ['CU', 'Copper', 't'], ['AL', 'Aluminium', 't'], ['ZN', 'Zinc', 't'], ['PB', 'Lead', 't'], ['NI', 'Nickel', 't'],
  ['XAU', 'Gold', 'oz'], ['XAG', 'Silver', 'oz'], ['USDINR', 'US dollar', 'fx'],
];
const KEEP_SENT_URLS = 300;
const MAX_AGE_DAYS = 4; // only stories dated within the last 4 days (covers Sunday and a day's approval lag)

const istNow = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3);
export const istDate = (d = new Date()) => istNow(d).toISOString().slice(0, 10);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Same anchor scheme as the news page (djb2 hash of the source URL).
export function sid(u) { let h = 5381; for (let i = 0; i < u.length; i++) h = ((h << 5) + h + u.charCodeAt(i)) >>> 0; return 's-' + h.toString(36); }

// ---------------------------------------------------------------- data
export function pickStories(items, sentUrls, today) {
  const sent = new Set(sentUrls || []);
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
  const fresh = (items || []).filter((i) => i && i.url && !sent.has(i.url) && i.date >= cutoff && i.date <= today);
  const byDate = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return { india: fresh.filter((i) => i.region === 'India').sort(byDate), world: fresh.filter((i) => i.region !== 'India').sort(byDate) };
}

// Latest daily close and the close before it, from the live worker's `closes` (keyed by IST date).
export function priceSnapshot(closes) {
  const days = Object.keys(closes || {}).sort();
  if (!days.length) return null;
  const day = days[days.length - 1];
  const prevDay = days.length > 1 ? days[days.length - 2] : null;
  const now = closes[day].prices || {};
  const prev = prevDay ? closes[prevDay].prices || {} : {};
  const rows = ROWS.filter(([c]) => typeof now[c] === 'number').map(([code, label, kind]) => {
    const v = now[code], p = prev[code];
    return { code, label, kind, value: v, change: typeof p === 'number' && p > 0 ? v / p - 1 : null };
  });
  return { day, prevDay, rows };
}

const fmtPrice = (r) => {
  if (r.kind === 'fx') return '₹' + r.value.toFixed(2);
  if (r.kind === 'oz') return '$' + r.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/oz';
  return '$' + Math.round(r.value).toLocaleString('en-US') + '/t';
};
const fmtChange = (c) => (c == null ? '–' : (c > 0 ? '▲ ' : c < 0 ? '▼ ' : '') + Math.abs(c * 100).toFixed(2) + '%');
const changeColor = (c) => (c == null || Math.abs(c) < 5e-5 ? '#67706b' : c > 0 ? '#13804f' : '#c0392b');

// ---------------------------------------------------------------- email HTML (inline styles, table layout)
export function renderBrief({ today, stories, prices, site, web = false }) {
  const F = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;";
  const S = "font-family:Georgia,'Source Serif 4',serif;";
  const newsPage = site + '/news/';
  const total = stories.india.length + stories.world.length;

  const story = (it) => `
<tr><td style="padding:14px 0;border-bottom:1px solid #e3e1da;">
  <div style="${F}font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#0f5d4a;font-weight:600;">${esc(it.topic)} <span style="color:#67706b;font-weight:400;text-transform:none;letter-spacing:0;">· ${esc(shortDate(it.date))}</span></div>
  <div style="${S}font-size:18px;line-height:1.3;font-weight:600;margin:4px 0 6px;"><a href="${esc(it.url)}" style="color:#17201c;text-decoration:none;">${esc(it.title)}</a></div>
  <div style="${F}font-size:14px;line-height:1.55;color:#17201c;">${esc(it.summary)}</div>
  <div style="${F}font-size:13px;line-height:1.5;color:#67706b;border-left:3px solid #b36b1f;padding-left:9px;margin-top:8px;"><b style="color:#17201c;">Why it matters:</b> ${esc(it.why)}</div>
  <div style="${F}font-size:12px;color:#67706b;margin-top:6px;">Source: <a href="${esc(it.url)}" style="color:#0f5d4a;">${esc(it.source)}</a> · <a href="${esc(newsPage + '#' + sid(it.url))}" style="color:#67706b;">On our site</a></div>
</td></tr>`;
  const section = (title, list) => !list.length ? '' : `
<tr><td style="${F}font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#67706b;padding:22px 0 6px;border-bottom:1px solid #e3e1da;">${title}</td></tr>${list.map(story).join('')}`;

  const priceRows = prices && prices.rows.length ? prices.rows.map((r) => `
<tr>
  <td style="${F}font-size:14px;padding:7px 0;border-bottom:1px solid #ecebe5;color:#17201c;">${esc(r.label)}${r.code === 'USDINR' ? '' : r.kind === 't' ? ' <span style="color:#67706b;font-size:12px;">LME</span>' : ''}</td>
  <td style="${F}font-size:14px;padding:7px 0;border-bottom:1px solid #ecebe5;text-align:right;font-variant-numeric:tabular-nums;color:#17201c;">${fmtPrice(r)}</td>
  <td style="${F}font-size:13px;padding:7px 0 7px 12px;border-bottom:1px solid #ecebe5;text-align:right;white-space:nowrap;color:${changeColor(r.change)};">${fmtChange(r.change)}</td>
</tr>`).join('') : '';
  const priceBlock = !priceRows ? '' : `
<tr><td style="${F}font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#67706b;padding:22px 0 6px;border-bottom:1px solid #e3e1da;">Prices · ${esc(shortDate(prices.day))}${prices.prevDay ? ` <span style="text-transform:none;letter-spacing:0;font-weight:400;">change vs ${esc(shortDate(prices.prevDay))} close</span>` : ''}</td></tr>
<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${priceRows}</table>
<div style="${F}font-size:13px;margin-top:10px;"><a href="${site}/" style="color:#0f5d4a;font-weight:600;">Scrap rates, black mass, rare earths and the RI indices →</a></div></td></tr>`;

  const intro = total
    ? `${total} ${total === 1 ? 'story' : 'stories'} today${stories.india.length ? `, ${stories.india.length} from India` : ''}, and the day's closing prices.`
    : 'No new stories today. Here are the day\'s closing prices.';
  const footer = web
    ? `<a href="${site}/brief/" style="color:#67706b;">Get the Evening Brief by email</a>`
    : `You are receiving this because you signed up for the Evening Brief at therecoveryindex.in. <a href="{{ unsubscribe }}" style="color:#67706b;">Unsubscribe</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evening Brief · ${esc(longDate(today))}</title></head>
<body style="margin:0;padding:0;background:#f6f5f1;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f1;"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e3e1da;border-radius:10px;">
<tr><td style="padding:22px 24px 6px;">
  <div style="${S}font-size:22px;font-weight:600;color:#17201c;">The Recovery Index</div>
  <div style="${F}font-size:13px;color:#67706b;margin-top:2px;">Evening Brief · ${esc(longDate(today))}</div>
  <div style="${F}font-size:15px;line-height:1.5;color:#17201c;margin-top:12px;">${esc(intro)}</div>
</td></tr>
<tr><td style="padding:0 24px 8px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
${priceBlock}
${section('India', stories.india)}
${section('World roundup', stories.world)}
</table></td></tr>
<tr><td style="padding:16px 24px 22px;${F}font-size:13px;line-height:1.6;color:#67706b;">
  <a href="${newsPage}" style="color:#0f5d4a;">All news</a> · <a href="${site}/" style="color:#0f5d4a;">Prices</a> · <a href="${site}/epr/" style="color:#0f5d4a;">EPR calculator</a><br>
  Summaries are written by The Recovery Index; original reporting belongs to the linked publishers. Metal prices: metals.dev, latest reading of the day (LME base metals); indicative, not trading advice.<br>
  ${footer}
</td></tr>
</table></td></tr></table></body></html>`;
}

export function subjectFor(today, stories) {
  const lead = stories.india[0] || stories.world[0];
  const base = `Evening Brief, ${shortDate(today)}`;
  return lead ? `${base}: ${lead.title}`.slice(0, 150) : `${base}: today's closing prices`;
}

// ---------------------------------------------------------------- Brevo
async function brevo(env, path, body) {
  const res = await fetch(BREVO + path, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function alert(env, subject, message) {
  if (!env.BREVO_API_KEY || !env.ALERT_EMAIL || !env.SENDER_EMAIL) return;
  try {
    await brevo(env, '/smtp/email', {
      sender: { name: 'Recovery Index robot', email: env.SENDER_EMAIL },
      to: [{ email: env.ALERT_EMAIL }],
      subject, textContent: message,
    });
  } catch (e) { /* alert is best-effort */ }
}

// ---------------------------------------------------------------- main
export async function runBrief(env, { now = new Date(), force = false } = {}) {
  const mode = (env.BRIEF_MODE || 'preview').toLowerCase();
  if (mode === 'off') return { skipped: 'BRIEF_MODE=off' };
  const today = istDate(now);
  const site = (env.SITE_ORIGIN || 'https://prices.therecoveryindex.in').replace(/\/$/, '');

  try {
    if (!force && mode === 'send' && await env.LIVE.get('brief:sent:' + today)) return { skipped: 'already sent today' };

    const res = await fetch(site + '/data/news.json', { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error('news.json HTTP ' + res.status);
    const news = await res.json();
    const [sentUrls, closes, last] = await Promise.all([
      env.LIVE.get('brief:sent_urls', 'json'), env.LIVE.get('closes', 'json'), env.LIVE.get('brief:last', 'json'),
    ]);
    const stories = pickStories(news.items, sentUrls, today);
    const prices = priceSnapshot(closes);
    const nStories = stories.india.length + stories.world.length;
    const pricesNew = prices && (!last || last.priceDay !== prices.day);

    if (!nStories && !pricesNew && !force) {
      await env.LIVE.put('brief:last_check', JSON.stringify({ at: now.toISOString(), today, result: 'skipped: nothing new' }));
      return { skipped: 'nothing new' };
    }

    const subject = subjectFor(today, stories);
    const html = renderBrief({ today, stories, prices, site });
    const web = renderBrief({ today, stories, prices, site, web: true });
    await env.LIVE.put('brief:preview', JSON.stringify({ at: now.toISOString(), today, subject, html: web, stories: nStories, mode }));
    if (mode !== 'send') return { preview: true, subject, stories: nStories };

    for (const k of ['BREVO_API_KEY', 'BREVO_LIST_ID', 'SENDER_EMAIL']) if (!env[k]) throw new Error(k + ' is not set');
    await env.LIVE.put('brief:sent:' + today, now.toISOString(), { expirationTtl: 3 * 86400 }); // lock first: never twice a day
    const camp = await brevo(env, '/emailCampaigns', {
      name: 'Evening Brief ' + today,
      subject,
      previewText: nStories ? `${nStories} ${nStories === 1 ? 'story' : 'stories'} and today's closing prices` : "Today's closing prices",
      sender: { name: env.SENDER_NAME || 'The Recovery Index', email: env.SENDER_EMAIL },
      ...(env.REPLY_TO ? { replyTo: env.REPLY_TO } : {}),
      recipients: { listIds: [Number(env.BREVO_LIST_ID)] },
      htmlContent: html,
    });
    await brevo(env, `/emailCampaigns/${camp.id}/sendNow`);

    // Record what went out: archive copy for /brief/<date>, sent URLs, last price day.
    const allSent = (sentUrls || []).concat(stories.india, stories.world).map((i) => (typeof i === 'string' ? i : i.url));
    const index = (await env.LIVE.get('brief:index', 'json')) || [];
    index.unshift({ date: today, subject, stories: nStories });
    await Promise.all([
      env.LIVE.put('brief:' + today, web),
      env.LIVE.put('brief:index', JSON.stringify(index.filter((x, i, a) => a.findIndex((y) => y.date === x.date) === i).slice(0, 120))),
      env.LIVE.put('brief:sent_urls', JSON.stringify(allSent.slice(-KEEP_SENT_URLS))),
      env.LIVE.put('brief:last', JSON.stringify({ at: now.toISOString(), today, campaign: camp.id, stories: nStories, priceDay: prices && prices.day })),
    ]);
    return { sent: true, campaign: camp.id, subject, stories: nStories };
  } catch (err) {
    const e = { at: now.toISOString(), today, message: String(err.message || err) };
    await env.LIVE.put('brief:last_error', JSON.stringify(e));
    await alert(env, 'Evening Brief failed ' + today, `The Evening Brief for ${today} did not go out.\n\n${e.message}\n\nCheck /status on the live worker.`);
    return { error: e.message };
  }
}

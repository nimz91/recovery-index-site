# The Recovery Index — price site

Live metals, scrap and e-waste prices for India, published at **prices.therecoveryindex.in**.

## How it fits together

| Part | What it does | Where it runs |
|---|---|---|
| `public/` | The website: price board and indices at `/`, news at `/news/`, EPR Target Calculator at `/epr/`; shared menu in `site-nav.css` | Cloudflare Pages |
| `public/data/news.json` | News stories (own-words summaries + source links). Drafted daily by the Claude scheduled task "Recovery Index daily news draft" as a pull request; merging the PR publishes it | Pull request → main |
| `public/data/*.json` | Daily prices (scrap grades, e-waste observations, plastics grades and virgin polymer references, battery metals, black mass, history) | Committed to this repo every weekday evening by the Claude scheduled task; each commit redeploys the site |
| `worker/` | Fetches metal prices + USD/INR from metals.dev (4×/weekday: 10:00, 14:00, 18:00, 21:30 IST), holds back implausible jumps until confirmed, keeps a daily close per IST day, caps requests at `MONTHLY_LIMIT` | Cloudflare Worker (cron) |
| `functions/api/ingest.js`, `public/ingest/` | Paste page for Shree Ji Rate Service WhatsApp bulletins: parses them (`lib/shreeji.js`) and stores the rates in KV; needs the `INGEST_TOKEN` secret on the Pages project | Cloudflare Pages Function |
| `functions/api/market.js` | Serves pasted rates (last 3 weeks) to the page | Cloudflare Pages Function |
| `.github/workflows/` | `merge-daily.yml` merges the evening update's `daily/*` branch into main; `sync-pasted-rates.yml` copies pasted rates into `public/data` nightly | GitHub Actions |
| `functions/api/live.js` | Serves the latest live prices to the page at `/api/live` | Cloudflare Pages Function |

The page polls `/api/live` every minute. Between daily observations, every scrap and e-waste price
moves with its metals' live prices in rupees, so both indices update with every live price refresh.

## Evening Brief (daily email)

A free email at **20:00 IST, Mon–Sat**: news stories already merged into `news.json` that no earlier brief carried
(India first, last 4 days only) plus a price snapshot from the live worker's metals.dev readings (LME base metals, gold,
silver, USD/INR). Third-party prices (Fastmarkets, Benchmark, SMM, dealer boards) are not emailed; the email links to the site.

| Part | What it does |
|---|---|
| `worker/src/brief.js` | Builds and sends the brief through Brevo (cron `30 14 * * MON-SAT` in `worker/wrangler.toml`). Skips a day with nothing new, never sends twice a day, emails `ALERT_EMAIL` on failure |
| `public/brief/` | Sign-up page with the archive of past briefs |
| `functions/api/subscribe.js` | Sign-up → Brevo double opt-in (people get a confirmation email first) |
| `functions/brief/[id].js` | Web copy of each sent brief at `/brief/YYYY-MM-DD` |

`BRIEF_MODE` in `worker/wrangler.toml` is `preview` by default: the brief is built every evening but **not sent**.
Look at it at `https://recovery-index-live.<subdomain>.workers.dev/brief/preview?key=<ADMIN_KEY>`, and see the last run
under `brief` at `/status`. Switch to `send` when you're happy.

**Setup (once, about 20 minutes):**
1. Create a free Brevo account. Senders, Domains & Dedicated IPs → add and authenticate `therecoveryindex.in`
   (add the DKIM/DMARC records Brevo shows in Cloudflare → therecoveryindex.in → DNS; the domain's DNS moved to Cloudflare on 16 Oct), and add the sender `brief@therecoveryindex.in`.
   Fill in the company address (Brevo shows it in the footer; required for bulk email).
2. Contacts → Lists → create **Evening Brief**; note its ID. Templates → create a double opt-in confirmation
   template (the confirm button must link to `{{ params.DOIurl }}`); note its ID.
3. Brevo → SMTP & API → API keys → create a key.
4. Worker: set `BREVO_LIST_ID` in `worker/wrangler.toml`, then from `worker/`:
   `npx wrangler secret put BREVO_API_KEY`, `npx wrangler secret put ADMIN_KEY`, `npx wrangler secret put ALERT_EMAIL`, `npx wrangler deploy`.
5. Pages project → Settings → Variables and secrets: `BREVO_API_KEY` (secret), `BREVO_LIST_ID`, `BREVO_DOI_TEMPLATE_ID`. Redeploy.
6. Sign yourself up at `/brief/`, check the preview for a few evenings, then set `BRIEF_MODE = "send"` and `npx wrangler deploy`.

Brevo's free plan has a daily sending cap; when the list outgrows it, move to a paid Brevo plan (no code change).

## Search pages and the daily rate card

`scripts/build_static.py` turns `public/data/*.json` into plain HTML that Google can read and people can share:

| Output | What it is |
|---|---|
| `public/rates/` | One page per Delhi scrap grade ("Copper Super D scrap rate today in Delhi") plus an index |
| `public/card/latest.png` | 1080×1350 WhatsApp rate card (rendered by `scripts/render_card.mjs` with Playwright) |
| `public/news/index.html` | Story list written into the page between the `STATIC-NEWS` markers |
| `public/sitemap.xml`, `public/robots.txt` | For Google Search Console |

Run `python3 scripts/build_static.py && node scripts/render_card.mjs` from the repo root. The evening price refresh does this automatically.
Fonts for the card are self-hosted in `public/fonts/` (Inter, Source Serif 4; SIL Open Font License).

## One-time setup

You need: a Cloudflare account (free), a metals.dev account, and this repo on GitHub.

1. **metals.dev key.** Sign up at metals.dev and pick a plan that covers the schedule: the 2-hourly schedule uses about 155 requests a month
   (just over the 100 free); switching to 5-minute updates would need about 6,500. Copy your API key.
2. **KV namespace.** In the Cloudflare dashboard: Storage & Databases → KV → Create namespace, name it `recovery-index-live`.
   Copy its ID into `worker/wrangler.toml` (`REPLACE_WITH_KV_NAMESPACE_ID`).
3. **Worker.** From the `worker/` folder:
   ```
   npx wrangler login
   npx wrangler secret put METALS_API_KEY   # paste the metals.dev key when asked
   npx wrangler deploy
   ```
   Check it after 5 minutes at `https://recovery-index-live.<your-subdomain>.workers.dev/status`.
4. **Pages site.** Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → choose this repo.
   Build command: *(none)*. Build output directory: `public`. Deploy.
   Then Settings → Bindings → add KV namespace, variable name `LIVE`, namespace `recovery-index-live`. Redeploy.
5. **Domain.** In the Pages project: Custom domains → Set up a domain → `prices.therecoveryindex.in`.
   Cloudflare shows a CNAME target (`<project>.pages.dev`). At GoDaddy → DNS for therecoveryindex.in → add
   a **CNAME** record: name `prices`, value `<project>.pages.dev`. The main domain's forwarding to the newsletter is unaffected.

## Pasting trade rates

Open `/ingest`, paste one or more Shree Ji bulletins (copied from WhatsApp or a chat export), press Preview, check the warnings, then Save. Rates show on the page within a minute and are committed to `public/data` at 22:15 IST. Test the parser with `node scripts/test_shreeji.mjs <chat export>`.

## Daily data

The Claude scheduled task "Recovery Index daily price refresh" updates `public/data/*.json` and commits here.
To edit an item by hand (for example a new observed e-waste rate, or new metal value shares for an item),
edit `public/data/ewaste.json` and commit; the site redeploys in about a minute.

## Licensing

Several prices are third-party (LME via news reports, Fastmarkets, Benchmark, dealer boards, MetalMandi).
They are credited and linked on the page. Before commercialising, get permission or licences from these
owners, or replace them with The Recovery Index's own observed prices.

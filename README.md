# The Recovery Index — price site

Live metals, scrap and e-waste prices for India, published at **prices.therecoveryindex.in**.

## How it fits together

| Part | What it does | Where it runs |
|---|---|---|
| `public/` | The website: price board and indices at `/`, news at `/news/`, EPR Target Calculator at `/epr/`; shared menu in `site-nav.css` | Cloudflare Pages |
| `public/data/news.json` | News stories (own-words summaries + source links). Drafted daily by the Claude scheduled task "Recovery Index daily news draft" as a pull request; merging the PR publishes it | Pull request → main |
| `public/data/*.json` | Daily prices (scrap grades, e-waste observations, plastics grades and virgin polymer references, battery metals, black mass, history) | Committed to this repo every weekday evening by the Claude scheduled task; each commit redeploys the site |
| `worker/` | Fetches metal prices + USD/INR from metals.dev (every 2 hours, 9 am–9 pm IST, Mon–Fri) and stores them in KV | Cloudflare Worker (cron) |
| `functions/api/live.js` | Serves the latest live prices to the page at `/api/live` | Cloudflare Pages Function |

The page polls `/api/live` every minute. Between daily observations, every scrap and e-waste price
moves with its metals' live prices in rupees, so both indices update with every live price refresh.

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

## Daily data

The Claude scheduled task "Recovery Index daily price refresh" updates `public/data/*.json` and commits here.
To edit an item by hand (for example a new observed e-waste rate, or new metal value shares for an item),
edit `public/data/ewaste.json` and commit; the site redeploys in about a minute.

## Licensing

Several prices are third-party (LME via news reports, Fastmarkets, Benchmark, dealer boards, MetalMandi).
They are credited and linked on the page. Before commercialising, get permission or licences from these
owners, or replace them with The Recovery Index's own observed prices.

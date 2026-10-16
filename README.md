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
| `public/sell/` | **Sell IT Assets**: a company uploads its asset register and photos, gets a per-device and lot price range, and requests inspection | Cloudflare Pages |
| `public/auction/` | **Auctions**: registered refurbishers and recyclers apply, sign in with an access key and bid per sub-lot | Cloudflare Pages |
| `public/admin/` | **Console** (not linked, `noindex`): review lots, record inspection grades, approve buyers, publish and close auctions | Cloudflare Pages |
| `public/itad/engine.js` | The valuation engine and price book. The browser and the API load the same file, so they price identically | Pages + Functions |
| `functions/api/{lots,photos,grade,buyers,me,bids,auctions,admin,photo}` | ITAD API. Data in D1 (`DB`), photos in KV (`PHOTOS`), AI photo grading through the Claude API | Cloudflare Pages Functions |

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

## ITAD valuation and auctions

**How a lot moves:** client uploads at `/sell/` → instant range → *Send lot for inspection* (lands in the console) →
inspector grades every device and you record it in the console → *Publish auction* (sub-lots, opening, reserve, increment, times) →
buyers bid at `/auction/` → close → you collect payment from winners and release pickup.

**Test site:** every branch except `main` deploys as a preview that uses separate test storage (`recovery-index-itad-test` database,
`recovery-index-itad-photos-test` photos), shows a red TEST SITE banner and is hidden from search engines. The `staging` branch is the
fixed test address: https://staging.recovery-index-prices.pages.dev. Push or merge work into `staging` to update it.
Secrets for previews are set separately: Pages → Settings → Variables and Secrets → **Preview**.

**Already set up:** the D1 database `recovery-index-itad` (tables from `migrations/0001_itad.sql` are applied) and the KV namespace
`recovery-index-itad-photos`. Both are bound in `wrangler.toml`.

**You need to add two secrets** in the Pages project → Settings → Variables and Secrets (Production), then redeploy:
- `ADMIN_KEY`: a long random string. Open `/admin/` and enter it to unlock the console.
- `ANTHROPIC_API_KEY`: from console.anthropic.com, for AI photo grading. Without it, photos still upload and the page says grading is off.
- Optional plain variable `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).

**How the auction is kept fair:** each bid is one conditional SQL insert, so two bids can't both take the same step; bids must be at least
the standing bid plus the increment and on the increment ladder; a buyer can't outbid themselves; a bid in the last 2 minutes (configurable)
extends that sub-lot's close; the reserve is never sent to buyers, only "reserve met / not met"; buyers see each other only as "Bidder N";
client names never appear on the auction pages and serials are masked to the last four characters.

**Recalibrating prices:** edit `ref` values in the `BOOK` list and the factors in `DEFAULTS` in `public/itad/engine.js`. As auctions close,
compare hammer prices with the estimates and move the reference prices and channel factors toward what buyers actually paid.

**Not built yet:** email/WhatsApp notifications (approvals, outbid alerts, results), online payment or EMD collection, and
per-buyer invoices. Buyer access keys are sent by hand from the console.

## Daily data

The Claude scheduled task "Recovery Index daily price refresh" updates `public/data/*.json` and commits here.
To edit an item by hand (for example a new observed e-waste rate, or new metal value shares for an item),
edit `public/data/ewaste.json` and commit; the site redeploys in about a minute.

## Licensing

Several prices are third-party (LME via news reports, Fastmarkets, Benchmark, dealer boards, MetalMandi).
They are credited and linked on the page. Before commercialising, get permission or licences from these
owners, or replace them with The Recovery Index's own observed prices.

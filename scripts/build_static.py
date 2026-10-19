#!/usr/bin/env python3
"""Build the static, search-friendly parts of the site from public/data/*.json.

Generates (all inside public/):
  card/index.html             1080x1350 daily rate card (rendered to PNG by render_card.mjs)
  rates/index.html            index of today's Delhi scrap rates
  rates/<slug>/index.html     one page per scrap grade ("<grade> scrap rate today in Delhi")
  news/index.html             story list written into the page (between STATIC-NEWS markers)
  sitemap.xml, robots.txt

Run from the repo root:  python3 scripts/build_static.py
Safe to re-run; it only rewrites generated files.
"""
import html
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
DATA = PUB / "data"
BASE_URL = "https://therecoveryindex.in"
SUBSCRIBE = "https://therecoveryindex.beehiiv.com/subscribe"

# Grades shown on the daily card, in order (code, label).
CARD_GRADES = [
    ("CU-ARM-PLANT", "Copper armature"),
    ("CU-SUPERD", "Copper Super D"),
    ("BR-PURJA", "Brass purja"),
    ("AL-WIRE", "Aluminium wire"),
    ("AL-BARTAN", "Aluminium bartan"),
    ("PB-BATT", "Lead battery scrap"),
    ("ZN-TUKADI", "Zinc tukadi"),
]
CARD_GLOBAL = [
    ("CU", "LME copper", "USD/t"),
    ("AL", "LME aluminium", "USD/t"),
    ("LI2CO3", "Lithium carbonate", "USD/t"),
    ("NDPR", "NdPr oxide, China", "USD/kg"),
    ("BM-NCM-ASIA", "NCM black mass, Asia", "% payable"),
    ("USDINR", "USD / INR", ""),
]

e = html.escape


def load(name):
    return json.loads((DATA / name).read_text())


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def dlabel(d, year=True):
    dt = datetime.strptime(d, "%Y-%m-%d")
    return dt.strftime("%-d %b %Y" if year else "%-d %b")


def inr(v, dp=0):
    if v is None:
        return "—"
    s = f"{v:,.{dp}f}"
    # Indian grouping for the integer part
    neg = s.startswith("-")
    s = s.lstrip("-")
    ip, _, fp = s.partition(".")
    ip = ip.replace(",", "")
    if len(ip) > 3:
        head, tail = ip[:-3], ip[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        ip = head + "," + tail
    return ("-" if neg else "") + "₹" + ip + (("." + fp) if fp else "")


def num(v, dp=0):
    return "—" if v is None else f"{v:,.{dp}f}"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


# ---------------------------------------------------------------- data
scrap = load("scrap.json")
board = load("board.json")
news = load("news.json")
B = {r["code"]: r for r in board}

delhi = [r for r in scrap if r.get("city", "Delhi") == "Delhi"]
by_code = defaultdict(list)
for r in delhi:
    by_code[r["code"]].append(r)
for v in by_code.values():
    v.sort(key=lambda r: r["date"])
LAST = max(r["date"] for r in delhi)


def mid(r):
    return (float(r["buy"]) + float(r["sell"])) / 2


def latest(code):
    rows = by_code.get(code) or []
    if not rows:
        return None, None
    cur = rows[-1]
    prev = rows[-2] if len(rows) > 1 else None
    return cur, prev


def chg_html(d, unit="₹"):
    if d is None:
        return '<span class="flat">—</span>'
    if abs(d) < 1e-9:
        return '<span class="flat">unch</span>'
    cls = "up" if d > 0 else "dn"
    arrow = "▲" if d > 0 else "▼"
    val = inr(abs(d), 1 if abs(d) % 1 else 0) if unit == "₹" else f"{abs(d):,.1f}{unit}"
    return f'<span class="{cls}">{arrow} {val}</span>'


# ---------------------------------------------------------------- shared head bits
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' "
           "fill='%230f5d4a'/%3E%3Cpath d='M8 21l5-6 4 3 7-9' stroke='%23fff' stroke-width='2.6' fill='none' stroke-linecap='round' "
           "stroke-linejoin='round'/%3E%3C/svg%3E")
NAV = ('<nav class="ri-nav" aria-label="Site"><a href="/news/">News</a><a href="/prices/">Prices</a>'
       '<a href="/rates/"{cur}>Scrap rates</a><a href="/epr/">EPR Calculator</a>'
       f'<a class="sub" href="{SUBSCRIBE}" target="_blank" rel="noopener">Newsletter</a></nav>')


def page(title, desc, canonical, body, cur=True, jsonld=None):
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{BASE_URL}{canonical}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{BASE_URL}{canonical}">
<meta property="og:image" content="{BASE_URL}/card/latest.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/site-nav.css">
<link rel="icon" href="{FAVICON}">
<style>
.rates-table{{width:100%;table-layout:fixed;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}}
.rates-table th,.rates-table td{{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left}}
.rates-table th:first-child{{width:38%}}
.rates-table th{{font-size:12px;color:var(--muted);font-weight:600}}
.rates-table td.r,.rates-table th.r{{text-align:right}}
.big-rate{{font-family:var(--serif);font-size:clamp(34px,6vw,52px);margin:6px 0 2px;font-variant-numeric:tabular-nums}}
.kv{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:12px;margin:14px 0}}
.crumbs{{font-size:13px;color:var(--muted);margin:18px 0 0}}
.crumbs a{{color:var(--accent)}}
.prose p{{max-width:70ch}}
.cta-inline{{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:600;font-size:14px;margin-top:6px}}
</style>
{ld}
</head>
<body>
<header class="ri-bar top"><div class="in"><a class="brand-l" href="/">The Recovery Index</a>{NAV.format(cur=' aria-current="page"' if cur else '')}</div></header>
<main class="wrap">
{body}
</main>
<footer class="wrap foot">© {date.today().year} The Recovery Index · therecoveryindex.in · Rates are indicative trade quotes, ex-GST, not offers. Sources are credited on each page.</footer>
</body>
</html>
"""


# ---------------------------------------------------------------- rate pages
def grade_title(r):
    g = re.sub(r"\s*scrap\b", "", r["grade"], flags=re.I).strip()
    m = r["metal"]
    name = g if m.lower() in g.lower() else f"{m} {g}"
    return name


def is_scrap(r):
    return not re.search(r"\b(ingot|rod)\b", r["grade"], re.I)


def kind(r):
    return "scrap rate" if is_scrap(r) else "rate"


def gslug(r):
    return slugify(f"{grade_title(r)} {kind(r)} delhi")


grade_codes = sorted(by_code, key=lambda c: (by_code[c][-1]["metal"], c))
rate_urls = []
index_rows = []
for code in grade_codes:
    cur, prev = latest(code)
    if cur["date"] < LAST:  # grade no longer quoted
        continue
    name = grade_title(cur)
    slug = gslug(cur)
    url = f"/rates/{slug}/"
    rate_urls.append((url, cur["date"]))
    m_now = mid(cur)
    d = (m_now - mid(prev)) if prev else None
    index_rows.append((cur, prev, name, url, d))
    hist = by_code[code][-10:][::-1]
    hist_rows = "".join(
        f'<tr><td>{dlabel(h["date"])}</td><td class="r">{inr(float(h["buy"]))}</td><td class="r">{inr(float(h["sell"]))}</td>'
        f'<td class="r">{inr(mid(h), 1 if mid(h) % 1 else 0)}</td></tr>' for h in hist)
    title = f"{name} {kind(cur)} today in Delhi: {inr(m_now)}/kg ({dlabel(cur['date'], False)}) · The Recovery Index"
    desc = (f"{name} {kind(cur)} in Delhi on {dlabel(cur['date'])}: buy {inr(float(cur['buy']))}, sell {inr(float(cur['sell']))} per kg "
            f"(ex-GST). Daily history, related grades and live LME prices.")
    siblings = [x for x in grade_codes if x != code and by_code[x][-1]["metal"] == cur["metal"] and by_code[x][-1]["date"] == LAST]
    sib_html = " · ".join(f'<a href="/rates/{gslug(by_code[x][-1])}/">{e(grade_title(by_code[x][-1]))}</a>' for x in siblings)
    lme_code = {"Copper": "CU", "Aluminium": "AL", "Zinc": "ZN", "Lead": "PB", "Nickel": "NI", "Tin": "SN"}.get(cur["metal"])
    lme = B.get(lme_code) if lme_code else None
    lme_html = ""
    if lme:
        lme_html = (f'<div class="tile"><div class="lbl">LME {e(lme["name"].lower())}, 3-month</div>'
                    f'<div class="num">${num(float(lme["price"]))}/t</div><div class="chg flat">{dlabel(lme["date"])}</div></div>')
    body = f"""
<p class="crumbs"><a href="/rates/">Scrap rates</a> › {e(cur['metal'])} › {e(name)}</p>
<section class="hero">
  <h1>{e(name)} {kind(cur)} today in Delhi</h1>
  <p class="lede">Delhi wholesale rate for {e(name)} on <b>{dlabel(cur['date'])}</b>, in rupees per kg, excluding 18% GST.</p>
</section>
<section class="card">
  <div class="lbl note">Mid rate (average of buy and sell)</div>
  <div class="big-rate">{inr(m_now, 1 if m_now % 1 else 0)}<span style="font-size:.45em;color:var(--muted)"> /kg</span></div>
  <div>{chg_html(d)} vs previous quote{(' (' + dlabel(prev['date'], False) + ')') if prev else ''}</div>
  <div class="kv">
    <div class="tile"><div class="lbl">Buy</div><div class="num">{inr(float(cur['buy']))}</div></div>
    <div class="tile"><div class="lbl">Sell</div><div class="num">{inr(float(cur['sell']))}</div></div>
    {lme_html}
  </div>
  <p class="note">Source: {e(cur['source'])}. Indicative trade quotes, not offers.</p>
</section>
<section class="card">
  <h2>Recent rates</h2>
  <div class="tw"><table class="rates-table"><thead><tr><th>Date</th><th class="r">Buy</th><th class="r">Sell</th><th class="r">Mid</th></tr></thead><tbody>{hist_rows}</tbody></table></div>
</section>
<section class="card prose">
  <h2>Related {e(cur['metal'].lower())} grades</h2>
  <p>{sib_html or 'No other grades quoted today.'}</p>
  <p>See every grade on the <a href="/rates/">Delhi scrap rates</a> page, or the <a href="/prices/">live price board</a> for LME metals, battery metals, rare earths and black mass.</p>
  <p><b>Get these rates in your inbox.</b> The Recovery Index is a free weekly brief on India's recycling markets.<br><a class="cta-inline" href="{SUBSCRIBE}" target="_blank" rel="noopener">Subscribe free</a></p>
</section>
"""
    jsonld = {"@context": "https://schema.org", "@type": "WebPage", "name": title, "description": desc,
              "dateModified": cur["date"], "url": BASE_URL + url,
              "breadcrumb": {"@type": "BreadcrumbList", "itemListElement": [
                  {"@type": "ListItem", "position": 1, "name": "Scrap rates", "item": BASE_URL + "/rates/"},
                  {"@type": "ListItem", "position": 2, "name": name, "item": BASE_URL + url}]}}
    write(PUB / "rates" / slug / "index.html", page(title, desc, url, body, jsonld=jsonld))

# rates index
rows_by_metal = defaultdict(list)
for cur, prev, name, url, d in index_rows:
    rows_by_metal[cur["metal"]].append((cur, name, url, d))
tables = ""
for metal in sorted(rows_by_metal, key=lambda m: ["Copper", "Brass", "Aluminium", "Lead", "Zinc", "Gun metal", "Nickel", "Tin"].index(m) if m in ["Copper", "Brass", "Aluminium", "Lead", "Zinc", "Gun metal", "Nickel", "Tin"] else 99):
    trs = "".join(
        f'<tr><td><a href="{u}">{e(n)}</a></td><td class="r">{inr(float(c["buy"]))}</td><td class="r">{inr(float(c["sell"]))}</td>'
        f'<td class="r">{inr(mid(c), 1 if mid(c) % 1 else 0)}</td><td class="r">{chg_html(dd)}</td></tr>' for c, n, u, dd in rows_by_metal[metal])
    tables += (f'<section class="card"><h2 id="{slugify(metal)}">{e(metal)}</h2><div class="tw"><table class="rates-table">'
               f'<thead><tr><th>Grade</th><th class="r">Buy</th><th class="r">Sell</th><th class="r">Mid</th><th class="r">Change</th></tr></thead>'
               f'<tbody>{trs}</tbody></table></div></section>')
idx_title = f"Delhi scrap rates today ({dlabel(LAST, False)}): copper, brass, aluminium, lead, zinc · The Recovery Index"
idx_desc = f"Today's Delhi wholesale scrap rates for {dlabel(LAST)}: copper, brass, aluminium, lead and zinc grades, in ₹/kg ex-GST, updated every weekday."
idx_body = f"""
<section class="hero">
  <h1>Delhi scrap rates today</h1>
  <p class="lede">Wholesale rates for non-ferrous scrap in Delhi on <b>{dlabel(LAST)}</b>, ₹ per kg, excluding GST. Updated every weekday evening.</p>
  <p class="note">Share today's rates: <a href="/card/latest.png">download the rate card</a> (image).</p>
</section>
{tables}
<section class="card prose"><p>Rates are indicative trade quotes compiled from Delhi trade boards, not offers. For LME metals, battery metals, rare earths and black mass, see the <a href="/prices/">price board</a>.</p>
<p><a class="cta-inline" href="{SUBSCRIBE}" target="_blank" rel="noopener">Get the weekly brief free</a></p></section>
"""
write(PUB / "rates" / "index.html", page(idx_title, idx_desc, "/rates/", idx_body))

# ---------------------------------------------------------------- daily card
def card_row(code, label):
    cur, prev = latest(code)
    if not cur or cur["date"] < LAST:
        return ""
    m_now = mid(cur)
    d = (m_now - mid(prev)) if prev else None
    return f'<tr><td>{e(label)}</td><td class="r">{inr(m_now, 1 if m_now % 1 else 0)}</td><td class="r">{chg_html(d)}</td></tr>'


def glob_row(code, label, unit):
    r = B.get(code)
    if not r:
        return ""
    p = float(r["price"])
    pv = float(r["prev"]) if r.get("prev") not in (None, "") else None
    if unit == "% payable":
        val, d = f"{p:.1f}%", (chg_html(p - pv, " pts") if pv is not None else '<span class="flat">—</span>')
    else:
        val = (f"${num(p, 2)}/kg" if unit == "USD/kg" else (f"${num(p)}/t" if unit == "USD/t" else num(p, 2)))
        d = '<span class="flat">—</span>' if pv in (None, 0) else (
            f'<span class="{"up" if p > pv else "dn" if p < pv else "flat"}">{"▲" if p > pv else "▼" if p < pv else ""} {abs(p / pv - 1) * 100:.1f}%</span>')
    return f'<tr><td>{e(label)}</td><td class="r">{val}</td><td class="r">{d}</td></tr>'


card_srcs = sorted({by_code[c][-1]["source"].split(" (")[0] for c, _ in CARD_GRADES if c in by_code})
card = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Rate card {LAST}</title>
<meta name="robots" content="noindex">
<style>
@font-face{{font-family:Inter;font-weight:400;src:url(/fonts/inter-latin-400-normal.woff2) format('woff2')}}
@font-face{{font-family:Inter;font-weight:600;src:url(/fonts/inter-latin-600-normal.woff2) format('woff2')}}
@font-face{{font-family:Inter;font-weight:700;src:url(/fonts/inter-latin-700-normal.woff2) format('woff2')}}
@font-face{{font-family:'Source Serif 4';font-weight:600;src:url(/fonts/source-serif-4-latin-600-normal.woff2) format('woff2')}}
*{{box-sizing:border-box}}
html,body{{margin:0;background:#e9e7e0}}
.card{{width:1080px;height:1350px;background:#f6f5f1;color:#17201c;font-family:Inter,'DejaVu Sans',sans-serif;padding:64px 72px;display:flex;flex-direction:column}}
.top{{display:flex;justify-content:space-between;align-items:center}}
.brand{{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:40px}}
.logo{{width:64px;height:64px;border-radius:14px;background:#0f5d4a;display:grid;place-items:center}}
h1{{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:64px;line-height:1.05;margin:44px 0 6px}}
.sub{{font-size:26px;color:#67706b;margin:0 0 30px}}
table{{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}}
td{{padding:15px 0;border-bottom:2px solid #e3e1da;font-size:31px}}
td.r{{text-align:right;font-weight:600}}
td:first-child{{color:#17201c}}
.up{{color:#13804f}}.dn{{color:#c0392b}}.flat{{color:#67706b;font-weight:400}}
h2{{font-size:22px;letter-spacing:.12em;text-transform:uppercase;color:#0f5d4a;margin:38px 0 4px;font-weight:700}}
.g td{{font-size:27px;padding:11px 0}}
.foot{{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:24px}}
.url{{font-size:34px;font-weight:700;color:#0f5d4a}}
.small{{font-size:19px;color:#67706b;line-height:1.4;max-width:620px}}
</style></head><body>
<div class="card">
  <div class="top"><div class="brand">The Recovery Index</div>
    <div class="logo"><svg width="40" height="40" viewBox="0 0 32 32"><path d="M8 21l5-6 4 3 7-9" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>
  <h1>Delhi scrap rates</h1>
  <p class="sub">{datetime.strptime(LAST, '%Y-%m-%d').strftime('%A, %-d %B %Y')} · ₹/kg mid rate, ex-GST · change vs last quote</p>
  <table>{''.join(card_row(c, l) for c, l in CARD_GRADES)}</table>
  <h2>Global</h2>
  <table class="g">{''.join(glob_row(c, l, u) for c, l, u in CARD_GLOBAL)}</table>
  <div class="foot">
    <div class="small">Indicative trade quotes, not offers. Scrap: {e(', '.join(card_srcs))}. LME via Reuters; rare earths SMM; black mass Benchmark (quarterly).</div>
    <div style="text-align:right"><div class="url">therecoveryindex.in</div><div class="small" style="text-align:right">Free daily rates · weekly brief</div></div>
  </div>
</div>
</body></html>
"""
write(PUB / "card" / "index.html", card)

# ---------------------------------------------------------------- static news list
items = sorted(news.get("items", []), key=lambda i: i["date"], reverse=True)


def story(it, lead):
    return (f'<article class="story{" lead" if lead else ""}"><div class="meta"><span class="tag">{e(it["topic"])}</span>'
            f'<span>{e(it["region"])}</span><time datetime="{e(it["date"])}">{dlabel(it["date"])}</time></div>'
            f'<h3><a href="{e(it["url"])}" target="_blank" rel="noopener">{e(it["title"])}</a></h3>'
            f'<p>{e(it["summary"])}</p><p class="why"><b>Why it matters: </b>{e(it["why"])}</p>'
            f'<p class="src">Source: <a href="{e(it["url"])}" target="_blank" rel="noopener">{e(it["source"])}</a></p></article>')


static = ""
for region, head in (("India", "India"), ("World", "World roundup")):
    lst = [i for i in items if i["region"] == region]
    static += f'<h2 class="sec-h">{head}</h2>' + ("".join(story(i, n == 0) for n, i in enumerate(lst)) or '<p class="empty">No stories yet.</p>')
np = PUB / "news" / "index.html"
nhtml = np.read_text()
block = f"<!--STATIC-NEWS-START-->{static}<!--STATIC-NEWS-END-->"
if "<!--STATIC-NEWS-START-->" in nhtml:
    nhtml = re.sub(r"<!--STATIC-NEWS-START-->.*?<!--STATIC-NEWS-END-->", lambda _: block, nhtml, flags=re.S)
else:
    nhtml = nhtml.replace('<div id="feed"></div>', f'<div id="feed">{block}</div>')
np.write_text(nhtml)

# ---------------------------------------------------------------- sitemap + robots
today = date.today().isoformat()
urls = [("/", news.get("updated", today)), ("/prices/", today), ("/rates/", LAST), ("/epr/", today)] + rate_urls
sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
    f"  <url><loc>{BASE_URL}{u}</loc><lastmod>{d}</lastmod></url>\n" for u, d in urls) + "</urlset>\n"
write(PUB / "sitemap.xml", sm)
write(PUB / "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {BASE_URL}/sitemap.xml\n")

print(f"Built: {len(rate_urls)} rate pages (latest {LAST}), card, news ({len(items)} stories), sitemap ({len(urls)} URLs)")

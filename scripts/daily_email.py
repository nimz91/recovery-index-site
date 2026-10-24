#!/usr/bin/env python3
"""Build the daily price + news email from the site's own data files.

    python3 scripts/daily_email.py [--date YYYY-MM-DD] [--out email.html]

Writes the HTML email to --out (default: daily-email.html) and prints a JSON line with the subject,
how many stories it carries and the story URLs, so the sender can skip a day with nothing new.

News: stories in public/data/news.json dated within the last 2 days (India first), newest first.
Prices: public, dated prints from public/data/board.json (LME base metals, precious metals, USD/INR,
Indian exchange/benchmark rates). Third-party assessments (Fastmarkets, Benchmark, SMM, dealer boards,
Shree Ji trade rates) are NOT copied into the email; it links to the price board instead.
"""
import argparse
import html
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
SITE = "https://therecoveryindex.in"
PRICES = "https://prices.therecoveryindex.in/"
SUBSCRIBE = "https://therecoveryindex.beehiiv.com/subscribe"

EMAIL_CODES = ["CU", "AL", "ZN", "PB", "NI", "SN", "XAU", "XAG", "USDINR",
               "MCX-CU", "MCX-AL", "MCX-ZN", "MCX-PB", "IBJA-XAU", "IBJA-XAG", "FBIL-USDINR"]
GROUP_LABEL = {"Base metals": "LME base metals", "Precious metals": "Precious metals", "FX": "Currency",
               "India benchmarks": "India benchmarks"}

e = lambda s: html.escape(str(s), quote=True)
F = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;"
SERIF = "font-family:'Source Serif 4',Georgia,serif;"


def dlabel(d, year=True):
    dt = datetime.strptime(d, "%Y-%m-%d")
    return f"{dt.day} {dt:%b}" + (f" {dt.year}" if year else "")


def fmt(v, unit):
    if v is None:
        return "–"
    if unit.startswith("INR") and unit not in ("INR per USD",):
        return "₹" + (f"{v:,.0f}" if v >= 1000 else f"{v:,.2f}".rstrip("0").rstrip("."))
    if unit == "INR per USD":
        return f"₹{v:.2f}"
    if unit == "USD/oz":
        return f"${v:,.2f}"
    return f"${v:,.0f}" if v >= 100 else f"${v:,.2f}"


def unit_label(unit):
    return {"USD/t": "/t", "USD/oz": "/oz", "INR/kg": "/kg", "INR/10 g": "/10 g", "INR per USD": " per $"}.get(unit, " " + unit)


def build(today):
    news = json.loads((DATA / "news.json").read_text())
    board = json.loads((DATA / "board.json").read_text())

    cutoff = (date.fromisoformat(today) - timedelta(days=2)).isoformat()
    fresh = [i for i in news.get("items", []) if cutoff <= i["date"] <= today]
    fresh.sort(key=lambda i: (i["region"] != "India", i["date"]), reverse=False)
    india = sorted([i for i in fresh if i["region"] == "India"], key=lambda i: i["date"], reverse=True)
    world = sorted([i for i in fresh if i["region"] != "India"], key=lambda i: i["date"], reverse=True)
    stories = india + world

    rows = {r["code"]: r for r in board}
    prices = [rows[c] for c in EMAIL_CODES if c in rows and rows[c].get("price") is not None]
    latest_price_day = max((r["date"] for r in prices), default=None)

    # ---- news block
    def story(it):
        return f"""
<tr><td style="padding:16px 0 14px;border-bottom:1px solid #ecebe5;">
  <div style="{F}font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#0f5d4a;font-weight:600;">{e(it['topic'])} · {e(it['region'])} · {e(dlabel(it['date'], False))}</div>
  <div style="{SERIF}font-size:19px;line-height:1.3;font-weight:600;margin:5px 0 6px;"><a href="{e(it['url'])}" style="color:#17201c;text-decoration:none;">{e(it['title'])}</a></div>
  <div style="{F}font-size:14px;line-height:1.55;color:#33403a;">{e(it['summary'])}</div>
  <div style="{F}font-size:14px;line-height:1.55;color:#33403a;margin-top:6px;"><b>Why it matters:</b> {e(it['why'])}</div>
  <div style="{F}font-size:12px;color:#67706b;margin-top:6px;">Source: <a href="{e(it['url'])}" style="color:#0f5d4a;">{e(it['source'])}</a></div>
</td></tr>"""

    def head(t, sub=""):
        s = f' <span style="text-transform:none;letter-spacing:0;font-weight:400;">{e(sub)}</span>' if sub else ""
        return f'<tr><td style="{F}font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#67706b;padding:24px 0 6px;border-bottom:1px solid #e3e1da;">{e(t)}{s}</td></tr>'

    news_html = ""
    if india:
        news_html += head("India") + "".join(story(i) for i in india)
    if world:
        news_html += head("World") + "".join(story(i) for i in world)
    if not stories:
        news_html = head("News") + f'<tr><td style="{F}font-size:14px;color:#33403a;padding:12px 0;">No new stories in the last two days. <a href="{SITE}/" style="color:#0f5d4a;">Recent coverage is on the site.</a></td></tr>'

    # ---- price block
    price_html = ""
    group = None
    for r in prices:
        g = GROUP_LABEL.get(r["group"], r["group"])
        if g != group:
            group = g
            price_html += f'<tr><td colspan="3" style="{F}font-size:11px;font-weight:600;color:#67706b;padding:12px 0 2px;">{e(g)}</td></tr>'
        chg = ""
        if r.get("prev"):
            pct = (r["price"] - r["prev"]) / r["prev"] * 100
            col = "#0f7a4a" if pct >= 0.05 else "#b3261e" if pct <= -0.05 else "#67706b"
            arrow = "▲" if pct >= 0.05 else "▼" if pct <= -0.05 else "■"
            chg = f'<span style="color:{col};">{arrow} {abs(pct):.1f}%</span>'
        price_html += f"""<tr>
  <td style="{F}font-size:14px;padding:6px 0;border-bottom:1px solid #ecebe5;color:#17201c;">{e(r['name'])} <span style="color:#8a918c;font-size:12px;">{e(dlabel(r['date'], False))}</span></td>
  <td style="{F}font-size:14px;padding:6px 0;border-bottom:1px solid #ecebe5;text-align:right;font-variant-numeric:tabular-nums;color:#17201c;white-space:nowrap;">{e(fmt(r['price'], r['unit']))}<span style="color:#8a918c;font-size:12px;">{e(unit_label(r['unit']))}</span></td>
  <td style="{F}font-size:13px;padding:6px 0 6px 12px;border-bottom:1px solid #ecebe5;text-align:right;white-space:nowrap;width:70px;">{chg}</td>
</tr>"""
    price_section = head("Prices", "change vs previous close") + f'<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0">{price_html}</table></td></tr>' + \
        f'<tr><td style="{F}font-size:13px;color:#33403a;padding:10px 0 0;">Delhi scrap rates, battery metals, black mass payables and rare earths: <a href="{PRICES}" style="color:#0f5d4a;">see the price board</a>.</td></tr>'

    n = len(stories)
    lead = stories[0]["title"] if stories else None
    subject = f"The Recovery Index · {dlabel(today, False)}: " + (lead if lead else "today's prices")
    subject = subject[:150]
    intro = (f"{n} new {'story' if n == 1 else 'stories'}" + (f", {len(india)} from India" if india else "") + ", and the latest prices."
             if n else "No new stories today. Here are the latest prices.")

    html_out = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f5f1;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f5f1;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e3e1da;border-radius:10px;"><tr><td style="padding:26px 26px 22px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="{F}font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0f5d4a;">The Recovery Index</td></tr>
<tr><td style="{SERIF}font-size:26px;font-weight:600;color:#17201c;padding:6px 0 4px;">Daily brief · {e(dlabel(today))}</td></tr>
<tr><td style="{F}font-size:14px;color:#33403a;padding-bottom:4px;">{e(intro)}</td></tr>
{news_html}
{price_section}
<tr><td style="{F}font-size:12px;line-height:1.6;color:#67706b;padding-top:24px;border-top:1px solid #e3e1da;margin-top:20px;">
  <a href="{SITE}/" style="color:#0f5d4a;">All news</a> · <a href="{PRICES}" style="color:#0f5d4a;">Prices</a> · <a href="{SITE}/epr/" style="color:#0f5d4a;">EPR calculator</a> · <a href="{SUBSCRIBE}" style="color:#0f5d4a;">Weekly newsletter</a><br>
  Summaries are written by The Recovery Index; original reporting belongs to the linked publishers. Prices are the latest public dated prints we hold (each row shows its date); indicative only, not trading advice.
</td></tr>
</table></td></tr></table></td></tr></table></body></html>"""
    meta = {"subject": subject, "stories": n, "india": len(india), "urls": [i["url"] for i in stories],
            "latest_price_date": latest_price_day, "price_rows": len(prices)}
    return html_out, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat())
    ap.add_argument("--out", default="daily-email.html")
    a = ap.parse_args()
    out, meta = build(a.date)
    Path(a.out).write_text(out)
    print(json.dumps(meta))


if __name__ == "__main__":
    sys.exit(main())

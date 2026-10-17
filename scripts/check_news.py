#!/usr/bin/env python3
"""Check public/data/news.json before it is published.

Run from the repo root:  python3 scripts/check_news.py
Exits 1 and lists every problem if the file would break or mislead the news page.
Standard library only, so it runs anywhere (GitHub Actions, the daily draft task, a laptop).
"""
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "news.json"
TOPICS = {"E-waste", "EPR", "Battery recycling", "Black mass", "Rare earths",
          "Critical minerals", "Solar waste", "Policy", "Deals"}
REGIONS = {"India", "World"}
FIELDS = ["date", "region", "topic", "title", "summary", "why", "source", "url"]
MAX_ITEMS = 40
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_day(s):
    if not isinstance(s, str) or not DAY.match(s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def main():
    errors, warnings = [], []
    try:
        data = json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL: {PATH.name} does not parse: {e}")
        return 1

    today_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
    updated = parse_day(data.get("updated"))
    if not updated:
        errors.append('"updated" must be a YYYY-MM-DD date')
    elif updated > today_ist:
        errors.append(f'"updated" ({updated}) is in the future')

    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append('"items" must be a non-empty list')
        items = []
    if len(items) > MAX_ITEMS:
        errors.append(f"{len(items)} items; keep at most {MAX_ITEMS} (drop the oldest)")

    seen_urls, seen_titles = {}, {}
    for n, it in enumerate(items, 1):
        tag = f"item {n}"
        if not isinstance(it, dict):
            errors.append(f"{tag}: not an object")
            continue
        tag = f"item {n} ({str(it.get('title', ''))[:50]!r})"
        missing = [f for f in FIELDS if not str(it.get(f, "")).strip()]
        if missing:
            errors.append(f"{tag}: missing {', '.join(missing)}")
        extra = sorted(set(it) - set(FIELDS))
        if extra:
            warnings.append(f"{tag}: unknown field(s) {', '.join(extra)}")

        d = parse_day(it.get("date"))
        if not d:
            errors.append(f"{tag}: date must be YYYY-MM-DD")
        else:
            if d > today_ist:
                errors.append(f"{tag}: date {d} is in the future")
            if updated and d > updated:
                errors.append(f"{tag}: date {d} is after \"updated\" ({updated})")
        if it.get("region") not in REGIONS:
            errors.append(f"{tag}: region must be one of {sorted(REGIONS)}")
        if it.get("topic") not in TOPICS:
            errors.append(f"{tag}: topic {it.get('topic')!r} is not one of {sorted(TOPICS)}")

        url = str(it.get("url", ""))
        u = urlparse(url)
        if u.scheme != "https" or not u.netloc:
            errors.append(f"{tag}: url must be a full https:// link")
        key = url.rstrip("/").lower()
        if key in seen_urls:
            errors.append(f"{tag}: same url as item {seen_urls[key]}")
        seen_urls.setdefault(key, n)
        t = str(it.get("title", "")).strip().lower()
        if t in seen_titles:
            errors.append(f"{tag}: same title as item {seen_titles[t]}")
        seen_titles.setdefault(t, n)

        title = str(it.get("title", ""))
        if len(title) > 140:
            warnings.append(f"{tag}: title is {len(title)} characters; aim for one line (<= 140)")
        if "\n" in title:
            errors.append(f"{tag}: title has a line break")
        summary = str(it.get("summary", ""))
        if len(summary) > 600:
            warnings.append(f"{tag}: summary is {len(summary)} characters; aim for two sentences")
        if re.search(r"\bnamo\s*e-?waste\b", " ".join(str(it.get(f, "")) for f in FIELDS), re.I):
            errors.append(f"{tag}: mentions Namo eWaste, which the news page must not cover")

    dates = [it.get("date") for it in items if isinstance(it, dict) and parse_day(it.get("date"))]
    if updated and dates and max(dates) < str(updated - timedelta(days=7)):
        warnings.append(f"newest story is {max(dates)}, more than a week before \"updated\"")

    for w in warnings:
        print("warn:", w)
    for e in errors:
        print("FAIL:", e)
    if errors:
        print(f"\n{len(errors)} problem(s) in {PATH.relative_to(PATH.parent.parent.parent)}")
        return 1
    print(f"OK: {len(items)} stories, updated {updated}"
          + (f", {len(warnings)} warning(s)" if warnings else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())

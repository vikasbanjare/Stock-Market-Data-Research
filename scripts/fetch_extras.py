#!/usr/bin/env python3
"""Fetch the remaining newsletter data from alternative sources.

1. Trendlyne public FII/DII macro pages — the GitHub Actions runner sits
   on a different network than the sandbox/fetchers that were blocked, so
   we attempt them here: weekly + YTD cash and F&O splits for FIIs and
   DIIs (the only clean public source for DII F&O and YTD).
   Tables are extracted to compact JSON — the agent never reads raw HTML.
2. Macro economic calendar for next week (India) from Forex Factory's
   free JSON feed (CPI, WPI, FX reserves, trade balance, etc.).

Usage:
    python3 scripts/fetch_extras.py [--date YYYY-MM-DD]
Writes data/raw/<date>/extras.json and prints a compact summary.
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys
import time
from html.parser import HTMLParser

import requests

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

TRENDLYNE_PAGES = {
    "cash_week": "https://trendlyne.com/macro-data/fii-dii/latest/cash-pastmonth/",
    "fii_fno_index_week": "https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-index-pastmonth/",
    "fii_fno_stock_week": "https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-stock-pastmonth/",
    "dii_fno_index_week": "https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-index-pastmonth/",
    "dii_fno_stock_week": "https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-stock-pastmonth/",
    "cash_ytd": "https://trendlyne.com/macro-data/fii-dii/year/cash-year/",
    "fii_fno_index_ytd": "https://trendlyne.com/macro-data/fii-dii/year/fii-fno-index-year/",
    "fii_fno_stock_ytd": "https://trendlyne.com/macro-data/fii-dii/year/fii-fno-stock-year/",
    "dii_fno_index_ytd": "https://trendlyne.com/macro-data/fii-dii/year/mf-fno-index-year/",
    "dii_fno_stock_ytd": "https://trendlyne.com/macro-data/fii-dii/year/mf-fno-stock-year/",
}

FF_CAL_NEXTWEEK = "https://nfs.faireconomy.media/ff_calendar_nextweek.json"
FF_CAL_THISWEEK = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


class TableExtractor(HTMLParser):
    """Pull all <table> contents as lists of row-cell text."""

    def __init__(self):
        super().__init__()
        self.tables, self._table, self._row = [], None, None
        self._cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag in ("td", "th") and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def extract_tables(html: str, max_rows: int = 40, max_tables: int = 4):
    parser = TableExtractor()
    parser.feed(html)
    return [t[:max_rows] for t in parser.tables[:max_tables]]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    report = {"run_date": run_date.isoformat(), "trendlyne": {}, "macro_calendar": None,
              "errors": []}

    # ---- Trendlyne FII/DII pages (attempt; may be bot-blocked) ----
    for name, url in TRENDLYNE_PAGES.items():
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 200:
                tables = extract_tables(resp.text)
                report["trendlyne"][name] = tables if tables else "page ok but no tables found"
            else:
                report["errors"].append(f"trendlyne {name}: HTTP {resp.status_code}")
        except requests.RequestException as exc:
            report["errors"].append(f"trendlyne {name}: {type(exc).__name__}")
        time.sleep(1)

    # ---- Macro calendar (India events; each feed independent) ----
    events = []
    for url in (FF_CAL_THISWEEK, FF_CAL_NEXTWEEK):
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            for ev in resp.json():
                if ev.get("country") == "INR":
                    events.append({"date": ev.get("date"), "title": ev.get("title"),
                                   "impact": ev.get("impact")})
        except Exception as exc:
            report["errors"].append(f"macro_calendar {url.rsplit('/', 1)[-1]}: {type(exc).__name__}")
    report["macro_calendar"] = sorted(events, key=lambda e: e["date"] or "") if events else None

    (out_dir / "extras.json").write_text(json.dumps(report, indent=1), encoding="utf-8")

    ok = [k for k, v in report["trendlyne"].items() if isinstance(v, list)]
    print(f"Trendlyne tables extracted: {len(ok)}/{len(TRENDLYNE_PAGES)} pages -> {ok}")
    if report["macro_calendar"] is not None:
        print(f"India macro events found: {len(report['macro_calendar'])}")
        for ev in report["macro_calendar"][:12]:
            print(f"  {ev['date']}  {ev['title']}")
    if report["errors"]:
        print("ERRORS:")
        for e in report["errors"]:
            print(f"  - {e}")
    print(f"Saved {out_dir / 'extras.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

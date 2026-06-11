#!/usr/bin/env python3
"""Download all Echo data-source pages into data/raw/<YYYY-MM-DD>/.

Saves raw HTML for the agent to read and extract numbers from. Prints a
per-URL status summary at the end; non-zero exit if anything failed so
the failure is impossible to miss.

Usage:
    python3 scripts/fetch_pages.py [--date YYYY-MM-DD]
"""
import argparse
import datetime as dt
import pathlib
import re
import sys
import time

import requests

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

URLS = {
    # Market breadth
    "breadth_gainers": "https://trendlyne.com/fundamentals/stock-screener/692095/top-gainers-all/",
    "breadth_losers": "https://trendlyne.com/fundamentals/stock-screener/692099/top-losers-all/",
    # Nifty 100 gainers/losers with delivery volume
    "n100_gainers": "https://trendlyne.com/fundamentals/stock-screener/677797/top-gainers-stocks-with-delivery-volume/index/NIFTY100/nifty-100/",
    "n100_losers": "https://trendlyne.com/fundamentals/stock-screener/677798/top-losers-stocks-with-delivery-volume/index/NIFTY100/nifty-100/",
    # 52-week high/low (Nifty 200)
    "n200_52w_high": "https://trendlyne.com/fundamentals/stock-screener/674839/stocks-that-hit-their-52-week-high-in-the-past-week/index/NIFTY200/nifty-200/",
    "n200_52w_low": "https://trendlyne.com/fundamentals/stock-screener/674842/stocks-that-hit-their-52-week-low-in-the-past-week/index/NIFTY200/nifty-200/",
    # Delivery-volume movers (Nifty 500)
    "n500_delivery_rising": "https://trendlyne.com/fundamentals/stock-screener/670507/rising-delivery-percentage-weekly-average-monthly-average/index/NIFTY500/nifty-500/",
    "n500_delivery_falling": "https://trendlyne.com/fundamentals/stock-screener/678211/falling-delivery-percentage-weekly-average-monthly-average/index/NIFTY500/nifty-500/",
    # FII/DII — last week
    "fii_dii_cash_week": "https://trendlyne.com/macro-data/fii-dii/latest/cash-pastmonth/",
    "fii_fno_index_week": "https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-index-pastmonth/",
    "fii_fno_stock_week": "https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-stock-pastmonth/",
    "dii_fno_index_week": "https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-index-pastmonth/",
    "dii_fno_stock_week": "https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-stock-pastmonth/",
    # FII/DII — year to date
    "fii_dii_cash_ytd": "https://trendlyne.com/macro-data/fii-dii/year/cash-year/",
    "fii_fno_index_ytd": "https://trendlyne.com/macro-data/fii-dii/year/fii-fno-index-year/",
    "fii_fno_stock_ytd": "https://trendlyne.com/macro-data/fii-dii/year/fii-fno-stock-year/",
    "dii_fno_index_ytd": "https://trendlyne.com/macro-data/fii-dii/year/mf-fno-index-year/",
    "dii_fno_stock_ytd": "https://trendlyne.com/macro-data/fii-dii/year/mf-fno-stock-year/",
    # Commodities — live + historical
    "brent_live": "https://www.investing.com/commodities/brent-oil",
    "brent_hist": "https://www.investing.com/commodities/brent-oil-historical-data",
    "gold_live": "https://www.investing.com/commodities/gold",
    "gold_hist": "https://www.investing.com/commodities/gold-historical-data",
    "silver_live": "https://www.investing.com/commodities/silver",
    "silver_hist": "https://www.investing.com/commodities/silver-historical-data",
    "natgas_live": "https://www.investing.com/commodities/natural-gas",
    "natgas_hist": "https://www.investing.com/commodities/natural-gas-historical-data",
    "copper_live": "https://www.investing.com/commodities/copper",
    "copper_hist": "https://www.investing.com/commodities/copper-historical-data",
    # Forex — live + historical
    "usdinr_live": "https://www.investing.com/currencies/usd-inr",
    "usdinr_hist": "https://www.investing.com/currencies/usd-inr-historical-data",
    "eurinr_live": "https://www.investing.com/currencies/eur-inr",
    "eurinr_hist": "https://www.investing.com/currencies/eur-inr-historical-data",
    "gbpinr_live": "https://www.investing.com/currencies/gbp-inr",
    "gbpinr_hist": "https://www.investing.com/currencies/gbp-inr-historical-data",
}


def earnings_calendar_url(run_date: dt.date) -> str:
    """Trendlyne results calendar for the upcoming Mon-Fri (Nifty 50)."""
    next_monday = run_date + dt.timedelta(days=(7 - run_date.weekday()))
    next_sunday = next_monday + dt.timedelta(days=6)
    return (
        "https://trendlyne.com/equity/calendar/all/all/"
        f"?start_date={next_monday}&end_date={next_sunday}"
        "&corporate_actions=Results"
        "&defaultStockgroup=index%2FNIFTY50%2Fnifty-50%2F"
    )


def fetch(session: requests.Session, name: str, url: str, out_dir: pathlib.Path) -> str:
    for attempt, delay in enumerate((0, 3, 8), start=1):
        if delay:
            time.sleep(delay)
        try:
            resp = session.get(url, headers=HEADERS, timeout=30)
        except requests.RequestException as exc:
            status = f"ERROR {type(exc).__name__}"
            continue
        body = resp.text
        if resp.status_code == 200 and "Host not in allowlist" not in body:
            (out_dir / f"{name}.html").write_text(body, encoding="utf-8")
            return f"OK ({len(body):,} bytes)"
        if "Host not in allowlist" in body:
            return "BLOCKED: domain not in environment network allowlist"
        status = f"HTTP {resp.status_code}"
    return f"FAILED after {attempt} attempts: {status}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat(),
                        help="Run date YYYY-MM-DD (default: today)")
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)

    urls = dict(URLS)
    urls["earnings_calendar"] = earnings_calendar_url(run_date)

    session = requests.Session()
    results = {}
    for name, url in urls.items():
        results[name] = fetch(session, name, url, out_dir)
        print(f"{results[name]:<55} {name}")
        time.sleep(1)  # be polite between hosts

    failures = {n: s for n, s in results.items() if not s.startswith("OK")}
    print(f"\nSaved to {out_dir}")
    print(f"{len(results) - len(failures)}/{len(results)} pages fetched")
    if failures:
        print("\nFAILED SOURCES (need user upload or network policy fix):")
        for name, status in failures.items():
            print(f"  - {name}: {status}")
        report = out_dir / "_failures.txt"
        report.write_text(
            "\n".join(f"{n}\t{s}\t{urls[n]}" for n, s in failures.items()),
            encoding="utf-8",
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

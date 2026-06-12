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
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

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


# Screener pages above are JS shells; the table rows come from this API.
# One JSON per live screener is saved alongside the HTML.
# API quirks: pagination is `pageNumber` (0-indexed), rows are capped at
# 25/page regardless of perPageCount, `sortBy`+`order` are mandatory, and
# requests must accept application/json or the DRF endpoint renders HTML.
SCREENER_API = "https://trendlyne.com/fundamentals/tl-all-in-one-screener-data-get/"
SCREENER_QUERIES = {
    # name: (screenpk, groupName, sort order for week_changeP)
    "n100_gainers": (677797, "NIFTY100", "DESC"),
    "n100_losers": (677798, "NIFTY100", "ASC"),
    "n200_52w_high": (674839, "NIFTY200", "DESC"),
}

# The original breadth / 52w-low / delivery-movers screeners were deleted
# on Trendlyne (404). Their data is rebuilt from the same API: raw
# queries for breadth and 52w highs/lows, and the two delivery screeners
# regrouped to NIFTY500 with explicit delivery columns for the movers.
HILO_COLUMNS = ("Stock,currentPrice,week_changeP,week_low,year_low,"
                "week_high,year_high")
DELIVERY_COLUMNS = ("Stock,week_changeP,delivery_5day_avg,delivery_30day_avg,"
                    "delivery_6M_avg,delivery_5day_avg_vol,delivery_30day_avg_vol")


def screener_json_url(screenpk: int, group_name: str, order: str) -> str:
    return (
        f"{SCREENER_API}?screenpk={screenpk}&groupType=index"
        f"&groupName={group_name}&pageNumber=0&perPageCount=25"
        f"&sortBy=week_changeP&order={order}"
    )


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


def body_ok(body: str, ext: str) -> bool:
    """A 200 response can still be a WAF/HTML error page; JSON endpoints
    must actually return JSON."""
    if "Host not in allowlist" in body:
        return False
    if ext == "json":
        return body.lstrip().startswith(("{", "["))
    return True


def fetch_via_curl(name: str, url: str, out_dir: pathlib.Path,
                   ext: str = "html") -> str | None:
    """Fallback for hosts that reject python-requests outright (Trendlyne's
    WAF intermittently 405s one client while serving the other). Downloads
    to a temp path so a failure never clobbers a good copy from an earlier
    run."""
    target = out_dir / f"{name}.{ext}"
    tmp = out_dir / f".{name}.{ext}.curl"
    cmd = [
        "curl", "-sS", "-L", "--max-time", "45",
        "-A", HEADERS["User-Agent"],
        "-H", f"Accept-Language: {HEADERS['Accept-Language']}",
    ]
    if ext == "json":
        cmd += ["-H", "X-Requested-With: XMLHttpRequest"]
    cmd += ["-o", str(tmp), "-w", "%{http_code}", url]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (subprocess.SubprocessError, OSError):
        proc = None
    if proc and proc.stdout.strip() == "200" and tmp.exists():
        body = tmp.read_text(encoding="utf-8", errors="replace")
        if body_ok(body, ext):
            tmp.replace(target)
            return f"OK via curl ({len(body):,} bytes)"
    tmp.unlink(missing_ok=True)
    return None


def fetch(session: requests.Session, name: str, url: str,
          out_dir: pathlib.Path, ext: str = "html") -> str:
    headers = dict(HEADERS)
    if ext == "json":
        headers["Accept"] = "application/json"
        headers["X-Requested-With"] = "XMLHttpRequest"
    for attempt, delay in enumerate((0, 3, 8), start=1):
        if delay:
            time.sleep(delay)
        try:
            resp = session.get(url, headers=headers, timeout=30)
        except requests.RequestException as exc:
            status = f"ERROR {type(exc).__name__}"
        else:
            body = resp.text
            if resp.status_code == 200 and body_ok(body, ext):
                (out_dir / f"{name}.{ext}").write_text(body, encoding="utf-8")
                return f"OK ({len(body):,} bytes)"
            if "Host not in allowlist" in body:
                return "BLOCKED: domain not in environment network allowlist"
            status = f"HTTP {resp.status_code}"
        curl_status = fetch_via_curl(name, url, out_dir, ext)
        if curl_status:
            return curl_status
    return f"FAILED after {attempt} attempts: {status}"


def api_get(session: requests.Session, params: dict) -> dict | None:
    """One screener-API call; returns the parsed body or None."""
    url = SCREENER_API + "?" + urllib.parse.urlencode(params)
    headers = dict(HEADERS)
    headers["Accept"] = "application/json"
    headers["X-Requested-With"] = "XMLHttpRequest"
    for delay in (0, 3, 8):
        if delay:
            time.sleep(delay)
        try:
            resp = session.get(url, headers=headers, timeout=30)
            if resp.status_code == 200 and body_ok(resp.text, "json"):
                body = resp.json().get("body") or {}
                if "tableHeaders" in body:
                    return body
        except requests.RequestException:
            pass
        try:
            proc = subprocess.run(
                ["curl", "-sS", "-L", "--max-time", "45",
                 "-A", HEADERS["User-Agent"],
                 "-H", "X-Requested-With: XMLHttpRequest", url],
                capture_output=True, text=True, timeout=60)
            if proc.returncode == 0 and body_ok(proc.stdout, "json"):
                body = json.loads(proc.stdout).get("body") or {}
                if "tableHeaders" in body:
                    return body
        except (subprocess.SubprocessError, OSError, ValueError):
            pass
    return None


def api_get_all(session: requests.Session, params: dict) -> list[dict] | None:
    """Paginate a screener-API query; rows deduped by stock_id."""
    rows, page = {}, 0
    while page <= 30:
        body = api_get(session, dict(params, pageNumber=page, perPageCount=25))
        if body is None:
            return None
        hdrs = [h["unique_name"] for h in body["tableHeaders"]]
        for r in body["tableData"]:
            d = dict(zip(hdrs, r))
            rows[d.get("stock_id") or d["shortname"]] = d
        if not body.get("isNextPage"):
            return list(rows.values())
        page += 1
        time.sleep(2)
    return list(rows.values())


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_computed(session: requests.Session, out_dir: pathlib.Path) -> dict:
    """Rebuild the data of the deleted Trendlyne screeners (market breadth,
    Nifty 200 52w high/low, Nifty 500 delivery movers) from the screener
    API and save one JSON artifact per section."""
    statuses = {}

    # Market breadth: total weekly gainers/losers across all stocks.
    counts = {}
    for key, q, order in (("gainers", "week_changeP > 0", "DESC"),
                          ("losers", "week_changeP < 0", "ASC")):
        body = api_get(session, {
            "query": q, "columns": "Stock,week_changeP", "groupType": "all",
            "groupName": "", "pageNumber": 0, "perPageCount": 5,
            "sortBy": "week_changeP", "order": order})
        counts[key] = body.get("totalCount") if body else None
        time.sleep(1)
    if counts["gainers"] is not None and counts["losers"] is not None:
        (out_dir / "breadth_counts.json").write_text(json.dumps(counts))
        statuses["breadth_counts"] = (
            f"OK (gainers={counts['gainers']}, losers={counts['losers']})")
    else:
        statuses["breadth_counts"] = "FAILED: screener API unreachable"

    # Nifty 200 52-week highs/lows in the past week.
    n200 = []
    for q, order in (("week_changeP > 0", "DESC"), ("week_changeP < 0", "ASC")):
        part = api_get_all(session, {
            "query": q, "columns": HILO_COLUMNS, "groupType": "index",
            "groupName": "NIFTY200", "sortBy": "week_changeP", "order": order})
        if part is None:
            n200 = None
            break
        n200 += part
    if n200:
        highs = sorted(r["shortname"].strip() for r in n200
                       if _num(r.get("week_high")) is not None
                       and _num(r.get("year_high")) is not None
                       and _num(r["week_high"]) >= _num(r["year_high"]))
        lows = sorted(r["shortname"].strip() for r in n200
                      if _num(r.get("week_low")) is not None
                      and _num(r.get("year_low")) is not None
                      and _num(r["week_low"]) <= _num(r["year_low"]))
        (out_dir / "n200_52w_highlow.json").write_text(json.dumps(
            {"highs": highs, "lows": lows, "stocks_scanned": len(n200)}))
        statuses["n200_52w_highlow"] = (
            f"OK ({len(highs)} highs, {len(lows)} lows, {len(n200)} scanned)")
    else:
        statuses["n200_52w_highlow"] = "FAILED: screener API unreachable"

    # Nifty 500 delivery movers: the two delivery screeners regrouped to
    # NIFTY500 jointly cover the index; rank by week-vs-month delivery
    # volume multiple.
    n500 = []
    for pk, order in ((677797, "DESC"), (677798, "ASC")):
        part = api_get_all(session, {
            "screenpk": pk, "columns": DELIVERY_COLUMNS, "groupType": "index",
            "groupName": "NIFTY500", "sortBy": "week_changeP", "order": order})
        if part is None:
            n500 = None
            break
        n500 += part
    if n500:
        seen, scored = set(), []
        for r in n500:
            key = r.get("stock_id") or r["shortname"]
            if key in seen:
                continue
            seen.add(key)
            wv = _num(r.get("delivery_5day_avg_vol"))
            mv = _num(r.get("delivery_30day_avg_vol"))
            if wv and mv and mv > 0:
                r["week_vs_month_vol_multiple"] = round(wv / mv, 2)
                scored.append(r)
        scored.sort(key=lambda r: r["week_vs_month_vol_multiple"], reverse=True)
        (out_dir / "n500_delivery_movers.json").write_text(json.dumps(
            {"rising_top6": scored[:6], "falling_bottom6": scored[-6:][::-1],
             "stocks_scored": len(scored)}))
        statuses["n500_delivery_movers"] = (
            f"OK ({len(scored)} stocks scored)")
    else:
        statuses["n500_delivery_movers"] = "FAILED: screener API unreachable"

    return statuses


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

    # The screener pages are JS shells; save the actual table data too.
    for name, (screenpk, group, order) in SCREENER_QUERIES.items():
        json_name = f"{name}_data"
        url = screener_json_url(screenpk, group, order)
        urls[json_name] = url
        results[json_name] = fetch(session, json_name, url, out_dir, ext="json")
        print(f"{results[json_name]:<55} {json_name}")
        time.sleep(1)

    # Rebuild the deleted screeners' data (breadth, 52w low, delivery movers).
    for name, status in fetch_computed(session, out_dir).items():
        urls[name] = SCREENER_API
        results[name] = status
        print(f"{status:<55} {name}")

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

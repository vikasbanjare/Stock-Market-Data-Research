#!/usr/bin/env python3
"""Compute the Echo screener tables from official NSE data — no Trendlyne.

Downloads NSE's daily full bhavcopy (close + delivery % for every stock),
index constituent lists, and FII/DII provisional figures, then computes:

  - Top 5 weekly gainers/losers (Nifty 100) with delivery-volume ratio
    (week avg vs prev-month avg)
  - Market breadth (weekly gainers vs losers, all EQ stocks)
  - Rising/falling delivery-volume movers (Nifty 500): week avg %,
    month avg %, 6-month avg % requires ~125 files, so we use week vs
    month and report what we have
  - FII/DII daily cash figures for the week (provisional)

Emits compact JSON + markdown so the agent reads only the summary.

Usage:
    python3 scripts/fetch_nse_data.py [--date YYYY-MM-DD]
"""
import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import sys
import time

import requests

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

BHAV_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv"
INDEX_LIST_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty{n}list.csv"
FIIDII_API = "https://www.nseindia.com/api/fiidiiTradeReact"


def weekdays_back(end: dt.date, count: int) -> list[dt.date]:
    days, d = [], end
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d)
        d -= dt.timedelta(days=1)
    return days


def fetch_bhavcopy(session, day: dt.date, cache_dir: pathlib.Path):
    """Return {symbol: (close, deliv_pct)} for EQ series, or None if unavailable."""
    cache = cache_dir / f"bhav_{day.isoformat()}.csv"
    if cache.exists():
        text = cache.read_text(encoding="utf-8")
    else:
        url = BHAV_URL.format(ddmmyyyy=day.strftime("%d%m%Y"))
        resp = session.get(url, headers=HEADERS, timeout=30)
        if resp.status_code != 200 or "SYMBOL" not in resp.text[:200]:
            return None  # holiday or missing file
        text = resp.text
        cache.write_text(text, encoding="utf-8")
        time.sleep(0.4)
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        row = {k.strip(): (v or "").strip() for k, v in row.items()}
        if row.get("SERIES") != "EQ":
            continue
        try:
            out[row["SYMBOL"]] = (float(row["CLOSE_PRICE"]), float(row["DELIV_PER"]))
        except (KeyError, ValueError):
            continue
    return out


def fetch_index_members(session, n: int) -> dict[str, str]:
    """symbol -> company name for Nifty <n>."""
    resp = session.get(INDEX_LIST_URL.format(n=n), headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return {
        row["Symbol"].strip(): row["Company Name"].strip()
        for row in csv.DictReader(io.StringIO(resp.text))
    }


def avg(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)
    this_friday = run_date - dt.timedelta(days=(run_date.weekday() - 4) % 7)

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    cache_dir = out_dir / "bhavcopies"
    cache_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    # Warm up cookies for the nseindia.com API endpoints.
    try:
        session.get("https://www.nseindia.com", headers=HEADERS, timeout=30)
    except requests.RequestException:
        pass

    report = {"run_date": run_date.isoformat(), "week_ending": this_friday.isoformat(),
              "sections": {}, "errors": []}

    # ---- Load ~27 trading days of bhavcopies (5 week + ~22 prior month) ----
    days = weekdays_back(this_friday, 40)  # extra to absorb holidays
    daily = {}
    for day in days:
        try:
            data = fetch_bhavcopy(session, day, cache_dir)
        except requests.RequestException as exc:
            report["errors"].append(f"bhavcopy {day}: {type(exc).__name__}: {exc}")
            data = None
        if data:
            daily[day] = data
        if len(daily) >= 27:
            break
    if len(daily) < 7:
        report["errors"].append(
            f"only {len(daily)} bhavcopies available - NSE may be blocking or domain not allowlisted")
        (out_dir / "nse_data.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        print(json.dumps(report, indent=1))
        return 1

    sessions_sorted = sorted(daily, reverse=True)
    week_days = sessions_sorted[:5]
    month_days = sessions_sorted[5:27]
    last_day, week_start_prev = week_days[0], sessions_sorted[5]

    def weekly_change(sym):
        new = daily[last_day].get(sym)
        old = daily[week_start_prev].get(sym)
        if new and old and old[0]:
            return round((new[0] / old[0] - 1) * 100, 2)
        return None

    def deliv_avg(sym, day_list):
        return avg([daily[d][sym][1] for d in day_list if sym in daily[d]])

    # ---- Market breadth (all EQ) ----
    common = set(daily[last_day]) & set(daily[week_start_prev])
    gainers = sum(1 for s in common if daily[last_day][s][0] > daily[week_start_prev][s][0])
    losers = sum(1 for s in common if daily[last_day][s][0] < daily[week_start_prev][s][0])
    report["sections"]["market_breadth"] = {"total_gainers": gainers, "total_losers": losers,
                                            "universe": "all NSE EQ-series stocks, weekly close vs close"}

    # ---- Nifty 100 gainers/losers with delivery ratio ----
    try:
        n100 = fetch_index_members(session, 100)
        moves = []
        for sym, name in n100.items():
            chg = weekly_change(sym)
            if chg is None:
                continue
            wk, mo = deliv_avg(sym, week_days), deliv_avg(sym, month_days)
            ratio = round(wk / mo, 1) if wk and mo else None
            moves.append({"symbol": sym, "name": name, "weekly_pct": chg,
                          "deliv_week_vs_month": ratio})
        moves.sort(key=lambda m: m["weekly_pct"], reverse=True)
        report["sections"]["nifty100_top_gainers"] = moves[:5]
        report["sections"]["nifty100_top_losers"] = sorted(moves[-5:], key=lambda m: m["weekly_pct"])
    except Exception as exc:
        report["errors"].append(f"nifty100: {type(exc).__name__}: {exc}")

    # ---- Delivery-volume movers (Nifty 500) ----
    try:
        n500 = fetch_index_members(session, 500)
        deliv = []
        for sym, name in n500.items():
            wk, mo = deliv_avg(sym, week_days), deliv_avg(sym, month_days)
            if wk and mo and mo > 0:
                deliv.append({"symbol": sym, "name": name, "week_avg_pct": wk,
                              "month_avg_pct": mo, "ratio": round(wk / mo, 2)})
        deliv.sort(key=lambda m: m["ratio"], reverse=True)
        report["sections"]["delivery_rising"] = deliv[:5]
        report["sections"]["delivery_falling"] = sorted(deliv[-5:], key=lambda m: m["ratio"])
        report["sections"]["delivery_note"] = (
            "6-month averages need ~125 bhavcopies; run scripts/fetch_nse_data.py with a "
            "warmed cache or take the 6M column from Trendlyne/user upload")
    except Exception as exc:
        report["errors"].append(f"nifty500 delivery: {type(exc).__name__}: {exc}")

    # ---- FII/DII provisional cash ----
    try:
        resp = session.get(FIIDII_API, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        report["sections"]["fii_dii_daily_raw"] = resp.json()
        report["sections"]["fii_dii_note"] = (
            "Daily provisional cash figures (₹ cr); sum the week's days for the table. "
            "F&O and YTD figures still come from Trendlyne or user upload.")
    except Exception as exc:
        report["errors"].append(f"fii_dii: {type(exc).__name__}: {exc}")

    (out_dir / "nse_data.json").write_text(json.dumps(report, indent=1), encoding="utf-8")

    # Compact human/agent-readable summary
    print(f"Week ending {last_day} (prev close ref {week_start_prev}); "
          f"{len(daily)} bhavcopies loaded")
    mb = report["sections"]["market_breadth"]
    print(f"Breadth: {mb['total_gainers']} gainers / {mb['total_losers']} losers")
    for key in ("nifty100_top_gainers", "nifty100_top_losers", "delivery_rising", "delivery_falling"):
        if key in report["sections"]:
            print(f"\n{key}:")
            for m in report["sections"][key]:
                pct = m.get("weekly_pct", m.get("ratio"))
                extra = m.get("deliv_week_vs_month", m.get("week_avg_pct"))
                print(f"  {m['name']:<40} {pct:>8}  {extra}")
    if report["errors"]:
        print("\nERRORS:")
        for e in report["errors"]:
            print(f"  - {e}")
    print(f"\nSaved {out_dir / 'nse_data.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

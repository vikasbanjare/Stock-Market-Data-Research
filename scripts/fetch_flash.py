#!/usr/bin/env python3
"""Flash data minutes after market close (15:35 IST) — before NSE
publishes its evening files.

Combines LIVE Yahoo closes for every Nifty 500 stock with the cached
official bhavcopies (this week's earlier sessions + ~250 prior sessions)
to produce at 15:35 IST:
  - Nifty 100 top weekly gainers/losers (price-only; delivery column
    arrives with the evening full run)
  - Weekly market breadth over the Nifty 500 universe
  - Nifty 200 52-week high/low hits for the week INCLUDING today
Benchmarks/commodities/forex come from fetch_market_data.py.

Usage:
    python3 scripts/fetch_flash.py [--date YYYY-MM-DD]
Writes data/raw/<date>/flash_data.json and prints a compact summary.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.parse

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_nse_data import (  # noqa: E402
    HEADERS, REPO_ROOT, fetch_bhavcopy, fetch_index_members, weekdays_back,
)

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"


def yahoo_today(session, nse_symbol: str, run_date: dt.date):
    """(close, day_high, day_low) for today's candle, or None."""
    sym = urllib.parse.quote(f"{nse_symbol}.NS", safe="")
    try:
        resp = session.get(CHART_URL.format(sym=sym),
                           params={"range": "5d", "interval": "1d"},
                           headers=HEADERS, timeout=20)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        stamps = result["timestamp"]
        quote = result["indicators"]["quote"][0]
        for i in range(len(stamps) - 1, -1, -1):
            day = dt.datetime.utcfromtimestamp(stamps[i]).date()
            if day == run_date and quote["close"][i] is not None:
                return (quote["close"][i],
                        quote["high"][i] or quote["close"][i],
                        quote["low"][i] or quote["close"][i])
            if day < run_date:
                break
    except Exception:
        return None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = REPO_ROOT / "data" / "cache" / "bhavcopies"
    cache_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    report = {"run_date": run_date.isoformat(), "mode": "flash-15:35-IST",
              "sections": {}, "errors": []}

    # Official history up to YESTERDAY (today's bhavcopy doesn't exist yet).
    daily = {}
    for day in weekdays_back(run_date - dt.timedelta(days=1), 380):
        try:
            data = fetch_bhavcopy(session, day, cache_dir)
        except requests.RequestException as exc:
            report["errors"].append(f"bhavcopy {day}: {type(exc).__name__}")
            data = None
        if data:
            daily[day] = data
        if len(daily) >= 250:
            break
    if len(daily) < 30:
        report["errors"].append(f"only {len(daily)} bhavcopies — cache cold or NSE blocked")
        (out_dir / "flash_data.json").write_text(json.dumps(report, indent=1))
        print(json.dumps(report, indent=1))
        return 1

    sessions_sorted = sorted(daily, reverse=True)
    prev_friday = run_date - dt.timedelta(days=7)
    base_day = next((d for d in sessions_sorted if d <= prev_friday), None)
    this_week_days = [d for d in sessions_sorted if prev_friday < d < run_date]
    report["base_day"] = base_day.isoformat() if base_day else None
    report["sessions_loaded"] = len(daily)

    n100 = fetch_index_members(session, 100)
    n200 = fetch_index_members(session, 200)
    n500 = fetch_index_members(session, 500)

    # Live closes for the whole Nifty 500 (one chart call per symbol).
    live = {}
    for i, sym in enumerate(n500):
        q = yahoo_today(session, sym, run_date)
        if q:
            live[sym] = q
        time.sleep(0.15)
    report["live_quotes"] = len(live)
    if len(live) < 300:
        report["errors"].append(
            f"only {len(live)}/{len(n500)} live quotes — Yahoo throttling? treat results as partial")

    # Weekly breadth (Nifty 500 universe, live close vs prev-Friday close).
    up = down = 0
    for sym, (close, _, _) in live.items():
        base = daily.get(base_day, {}).get(sym)
        if base and base[0]:
            if close > base[0]:
                up += 1
            elif close < base[0]:
                down += 1
    report["sections"]["breadth_n500_weekly"] = {
        "gainers": up, "losers": down,
        "note": "Nifty 500 universe at 15:35 IST; the evening run computes all-NSE breadth"}

    # Nifty 100 weekly gainers/losers by price.
    moves = []
    for sym, name in n100.items():
        q, base = live.get(sym), daily.get(base_day, {}).get(sym)
        if q and base and base[0]:
            moves.append({"symbol": sym, "name": name,
                          "weekly_pct": round((q[0] / base[0] - 1) * 100, 2),
                          "deliv_week_vs_month": "evening run"})
    moves.sort(key=lambda m: m["weekly_pct"], reverse=True)
    report["sections"]["nifty100_top_gainers"] = moves[:5]
    report["sections"]["nifty100_top_losers"] = sorted(
        moves[-5:], key=lambda m: m["weekly_pct"])

    # Nifty 200 52-week hits including today's session.
    prior = sessions_sorted  # all loaded history (up to yesterday)
    highs, lows = [], []
    for sym, name in n200.items():
        hist_hi = [daily[d][sym][2] for d in prior if sym in daily[d]]
        hist_lo = [daily[d][sym][3] for d in prior if sym in daily[d]]
        if len(hist_hi) < 100:
            continue
        wk_hi = [daily[d][sym][2] for d in this_week_days if sym in daily[d]]
        wk_lo = [daily[d][sym][3] for d in this_week_days if sym in daily[d]]
        if sym in live:
            wk_hi.append(live[sym][1])
            wk_lo.append(live[sym][2])
        if not wk_hi:
            continue
        # Threshold = history EXCLUDING this week.
        thresh_days = [d for d in prior if d <= prev_friday]
        t_hi = [daily[d][sym][2] for d in thresh_days if sym in daily[d]]
        t_lo = [daily[d][sym][3] for d in thresh_days if sym in daily[d]]
        if t_hi and max(wk_hi) >= max(t_hi):
            highs.append(name)
        if t_lo and min(wk_lo) <= min(t_lo):
            lows.append(name)
    report["sections"]["week_52w_highs_nifty200"] = sorted(highs)
    report["sections"]["week_52w_lows_nifty200"] = sorted(lows)

    (out_dir / "flash_data.json").write_text(json.dumps(report, indent=1), encoding="utf-8")

    b = report["sections"]["breadth_n500_weekly"]
    print(f"FLASH {run_date} | {len(live)} live quotes | base {report['base_day']}")
    print(f"Breadth (N500 weekly): {b['gainers']} up / {b['losers']} down")
    print("Gainers:")
    for m in report["sections"]["nifty100_top_gainers"]:
        print(f"  {m['name']:<45} {m['weekly_pct']:+6.2f}%")
    print("Losers:")
    for m in report["sections"]["nifty100_top_losers"]:
        print(f"  {m['name']:<45} {m['weekly_pct']:+6.2f}%")
    print(f"52W highs ({len(highs)}): {', '.join(sorted(highs))}")
    print(f"52W lows ({len(lows)}): {', '.join(sorted(lows))}")
    if report["errors"]:
        print("ERRORS:", *report["errors"], sep="\n  - ")
    print(f"Saved {out_dir / 'flash_data.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

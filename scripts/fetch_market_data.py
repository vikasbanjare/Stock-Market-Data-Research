#!/usr/bin/env python3
"""Fetch index, commodity and forex weekly closes from Yahoo Finance.

Zero-LLM-token data layer: emits a compact JSON + markdown summary so the
agent never reads raw pages. Weekly change = last Friday close vs the
previous Friday close (falls back to the nearest prior trading day).

Forex sign convention (per the published newsletter): positive weekly %
means the RUPEE STRENGTHENED, i.e. displayed % = old/new - 1.

Usage:
    python3 scripts/fetch_market_data.py [--date YYYY-MM-DD]
Writes data/raw/<date>/market_data.json and prints a markdown summary.
"""
import argparse
import datetime as dt
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
    "Accept": "application/json",
}

# label -> (yahoo symbol, kind)  kind: index | commodity | forex
SYMBOLS = {
    "Nifty 50": ("^NSEI", "index"),
    "Sensex": ("^BSESN", "index"),
    "Bank Nifty": ("^NSEBANK", "index"),
    "Brent Crude": ("BZ=F", "commodity"),
    "Gold Futures": ("GC=F", "commodity"),
    "Silver Futures": ("SI=F", "commodity"),
    "Natural Gas Futures (NYMEX)": ("NG=F", "commodity"),
    "Copper Futures": ("HG=F", "commodity"),
    "USD/INR": ("USDINR=X", "forex"),
    "EUR/INR": ("EURINR=X", "forex"),
    "GBP/INR": ("GBPINR=X", "forex"),
}

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"


def fetch_daily_closes(session: requests.Session, symbol: str,
                       start: dt.date, end: dt.date) -> dict[dt.date, float]:
    resp = session.get(
        CHART_URL.format(sym=symbol),
        params={
            "period1": int(dt.datetime.combine(start, dt.time()).timestamp()),
            "period2": int(dt.datetime.combine(end, dt.time()).timestamp()),
            "interval": "1d",
        },
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    stamps = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]
    out = {}
    for ts, close in zip(stamps, closes):
        if close is not None:
            out[dt.datetime.utcfromtimestamp(ts).date()] = close
    return out


def close_on_or_before(closes: dict[dt.date, float], day: dt.date):
    for back in range(7):
        d = day - dt.timedelta(days=back)
        if d in closes:
            return d, closes[d]
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat(),
                        help="Run date YYYY-MM-DD (default today); week ends on the Friday on/before this date")
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)
    this_friday = run_date - dt.timedelta(days=(run_date.weekday() - 4) % 7)
    prev_friday = this_friday - dt.timedelta(days=7)

    # Chain-base: prefer our own stored close for the previous Friday —
    # immune to Yahoo's lagged INR bars.
    stored_prev = {}
    prev_file = REPO_ROOT / "data" / "raw" / prev_friday.isoformat() / "market_data.json"
    if prev_file.exists():
        try:
            for r in json.loads(prev_file.read_text())["rows"]:
                if r.get("close_date") == prev_friday.isoformat():
                    stored_prev[r["symbol"]] = r["close"]
        except Exception:
            pass

    session = requests.Session()
    rows, errors = [], []
    for label, (symbol, kind) in SYMBOLS.items():
        try:
            closes = fetch_daily_closes(
                session, symbol,
                start=prev_friday - dt.timedelta(days=14),
                end=this_friday + dt.timedelta(days=4),
            )
            new_day, new = close_on_or_before(closes, this_friday)
            old_day, old = close_on_or_before(closes, prev_friday)
            if symbol in stored_prev:
                old, old_day = stored_prev[symbol], prev_friday
            if new is None or old is None:
                raise ValueError(f"missing closes (new={new_day}, old={old_day})")
            # First close INSIDE the issue window (usually Monday) — the
            # published weekly-% convention for the index table.
            win_day = min((d for d in closes if d > prev_friday), default=None)
            win_base = closes.get(win_day)
            raw_pct = new / old - 1
            display_pct = (old / new - 1) if kind == "forex" else raw_pct
            win_pct = None
            if win_base and win_day != new_day:
                wp = new / win_base - 1
                win_pct = round(((win_base / new - 1) if kind == "forex" else wp) * 100, 2)
            rows.append({
                "name": label, "symbol": symbol, "kind": kind,
                "close": round(new, 4), "close_date": new_day.isoformat(),
                "prev_close": round(old, 4), "prev_close_date": old_day.isoformat(),
                "weekly_pct_display": round(display_pct * 100, 2),
                "weekly_pct_raw": round(raw_pct * 100, 2),
                "weekly_pct_window": win_pct,
                "window_base_date": win_day.isoformat() if win_day else None,
            })
        except Exception as exc:
            errors.append({"name": label, "symbol": symbol, "error": f"{type(exc).__name__}: {exc}"})
        time.sleep(0.5)

    # Sanity check: Brent trading below WTI (or an extreme spread) means a
    # stale/rolled contract on one feed — flag loudly, never publish silently.
    by_sym = {r["symbol"]: r for r in rows}
    if "BZ=F" in by_sym:
        try:
            wti_closes = fetch_daily_closes(session, "CL=F",
                                            start=prev_friday - dt.timedelta(days=14),
                                            end=this_friday + dt.timedelta(days=4))
            _, wti = close_on_or_before(wti_closes, this_friday)
            if wti:
                spread = by_sym["BZ=F"]["close"] - wti
                by_sym["BZ=F"]["wti_close"] = round(wti, 2)
                by_sym["BZ=F"]["brent_wti_spread"] = round(spread, 2)
                if spread < -1 or spread > 15:
                    errors.append({"name": "Brent Crude", "symbol": "BZ=F",
                                   "error": f"suspicious Brent-WTI spread {spread:+.2f} — "
                                            "possible stale/rolled contract, verify close"})
        except Exception as exc:
            errors.append({"name": "Brent sanity check", "symbol": "CL=F",
                           "error": f"{type(exc).__name__}: {exc}"})

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_date": run_date.isoformat(),
        "week_ending": this_friday.isoformat(),
        "prev_week_ending": prev_friday.isoformat(),
        "note_forex": "weekly_pct_display is rupee-perspective (positive = rupee strengthened)",
        "rows": rows, "errors": errors,
    }
    (out_dir / "market_data.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")

    print(f"Week ending {this_friday} (vs {prev_friday})\n")
    print("| Instrument | Close | Date | Weekly % (display) |")
    print("|---|---|---|---|")
    for r in rows:
        print(f"| {r['name']} | {r['close']} | {r['close_date']} | {r['weekly_pct_display']:+.2f}% |")
    if errors:
        print("\nFAILED:")
        for e in errors:
            print(f"  - {e['name']} ({e['symbol']}): {e['error']}")
    print(f"\nSaved {out_dir / 'market_data.json'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

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
HIGH52_URL = "https://nsearchives.nseindia.com/content/CM_52_wk_High_low_{ddmmyyyy}.csv"
FII_STATS_URL = "https://nsearchives.nseindia.com/content/fo/fii_stats_{dmony}.xls"
EVENT_CAL_API = "https://www.nseindia.com/api/event-calendar?index=equities&from_date={frm}&to_date={to}"


def weekdays_back(end: dt.date, count: int) -> list[dt.date]:
    days, d = [], end
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d)
        d -= dt.timedelta(days=1)
    return days


def fetch_bhavcopy(session, day: dt.date, cache_dir: pathlib.Path):
    """Return {symbol: (close, deliv_pct, high, low)} for EQ series, or None."""
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
            out[row["SYMBOL"]] = (float(row["CLOSE_PRICE"]), float(row["DELIV_PER"]),
                                  float(row["HIGH_PRICE"]), float(row["LOW_PRICE"]),
                                  float(row["DELIV_QTY"]))
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


def parse_date_any(text: str):
    text = (text or "").strip()
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%b-%y"):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def compute_52wk_lists(daily: dict, sessions_sorted: list, week_days: list,
                       members: dict):
    """Nifty-200 stocks that made a new 52-week high/low this week, computed
    from ~250 sessions of bhavcopy highs/lows (no fragile NSE report)."""
    prior_days = sessions_sorted[5:]
    highs, lows = [], []
    for sym, name in members.items():
        wk_hi = [daily[d][sym][2] for d in week_days if sym in daily[d]]
        wk_lo = [daily[d][sym][3] for d in week_days if sym in daily[d]]
        pr_hi = [daily[d][sym][2] for d in prior_days if sym in daily[d]]
        pr_lo = [daily[d][sym][3] for d in prior_days if sym in daily[d]]
        if not wk_hi or len(pr_hi) < 100:
            continue
        if max(wk_hi) >= max(pr_hi):
            highs.append(name)
        if min(wk_lo) <= min(pr_lo):
            lows.append(name)
    return sorted(highs), sorted(lows)


def fetch_index_closes(session, day: dt.date, cache_dir: pathlib.Path):
    """{index name: close} from NSE's daily all-indices file (official)."""
    cache = cache_dir / f"ind_close_{day.isoformat()}.csv"
    if cache.exists():
        text = cache.read_text(encoding="utf-8")
    else:
        url = ("https://nsearchives.nseindia.com/content/indices/"
               f"ind_close_all_{day.strftime('%d%m%Y')}.csv")
        resp = session.get(url, headers=HEADERS, timeout=30)
        if resp.status_code != 200 or "Index Name" not in resp.text[:200]:
            return None
        text = resp.text
        cache.write_text(text, encoding="utf-8")
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        try:
            out[row["Index Name"]] = float(row["Closing Index Value"])
        except (KeyError, ValueError):
            continue
    return out


def fetch_fii_fno_week(session, week_days: list):
    """FII derivatives net buy/sell (₹ cr) summed over the week, per segment,
    from NSE's daily fii_stats_<dd-Mon-yyyy>.xls."""
    import xlrd  # noqa: PLC0415 — optional dep, only needed for this section
    segments = {"index futures": 0.0, "index options": 0.0,
                "stock futures": 0.0, "stock options": 0.0}
    days_used = []
    for day in week_days:
        url = FII_STATS_URL.format(dmony=day.strftime("%d-%b-%Y"))
        resp = session.get(url, headers=HEADERS, timeout=30)
        if resp.status_code != 200:
            continue
        try:
            sheet = xlrd.open_workbook(file_contents=resp.content).sheet_by_index(0)
        except Exception:
            continue
        for r in range(sheet.nrows):
            label = str(sheet.cell_value(r, 0)).strip().lower()
            if label in segments:
                # Columns: name, buy contracts, buy ₹cr, sell contracts,
                # sell ₹cr, OI contracts, OI ₹cr — net = buy_cr - sell_cr.
                try:
                    buy_cr = float(sheet.cell_value(r, 2))
                    sell_cr = float(sheet.cell_value(r, 4))
                except (TypeError, ValueError):
                    continue
                segments[label] += buy_cr - sell_cr
        days_used.append(day.isoformat())
        time.sleep(0.3)
    return ({k: round(v, 2) for k, v in segments.items()}, days_used)


def fetch_upcoming_results(session, after: dt.date, members: dict):
    """Nifty-50 results scheduled in the 9 days after `after`, from NSE's
    corporate event calendar API."""
    frm, to = after + dt.timedelta(days=1), after + dt.timedelta(days=9)
    url = EVENT_CAL_API.format(frm=frm.strftime("%d-%m-%Y"), to=to.strftime("%d-%m-%Y"))
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    out = []
    for ev in resp.json():
        purpose = (ev.get("purpose") or "").lower()
        if ev.get("symbol") in members and "result" in purpose:
            out.append({"date": ev.get("date"), "symbol": ev.get("symbol"),
                        "company": members[ev.get("symbol")], "purpose": ev.get("purpose")})
    return sorted(out, key=lambda e: e["date"] or "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)
    this_friday = run_date - dt.timedelta(days=(run_date.weekday() - 4) % 7)

    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = REPO_ROOT / "data" / "cache" / "bhavcopies"
    cache_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    # Warm up cookies for the nseindia.com API endpoints.
    try:
        session.get("https://www.nseindia.com", headers=HEADERS, timeout=30)
    except requests.RequestException:
        pass

    report = {"run_date": run_date.isoformat(), "week_ending": this_friday.isoformat(),
              "sections": {}, "errors": []}

    # ---- Load ~125 trading days of bhavcopies (week + month + 6 months) ----
    days = weekdays_back(this_friday, 380)  # extra to absorb holidays
    daily = {}
    for day in days:
        try:
            data = fetch_bhavcopy(session, day, cache_dir)
        except requests.RequestException as exc:
            report["errors"].append(f"bhavcopy {day}: {type(exc).__name__}: {exc}")
            data = None
        if data:
            daily[day] = data
        if len(daily) >= 250:
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
    six_month_days = sessions_sorted[:125]
    last_day, week_start_prev = week_days[0], sessions_sorted[5]
    report["sessions_loaded"] = len(daily)
    # Freshness marker: on a live Friday-evening run this must equal the
    # run date. If it's the previous session, NSE hasn't published
    # today's bhavcopy yet — re-run later rather than shipping stale tables.
    report["latest_session"] = last_day.isoformat()

    prev_friday = this_friday - dt.timedelta(days=7)
    window_days = [d for d in sessions_sorted if d > prev_friday]
    window_base_day = min(window_days) if window_days else None
    report["window_base_day"] = window_base_day.isoformat() if window_base_day else None

    def weekly_change(sym):
        """Published convention: change within the issue window
        (last close vs the week's first close, usually Monday)."""
        new = daily[last_day].get(sym)
        old = daily.get(window_base_day, {}).get(sym)
        if new and old and old[0]:
            return round((new[0] / old[0] - 1) * 100, 2)
        return None

    def weekly_change_fri(sym):
        new = daily[last_day].get(sym)
        old = daily[week_start_prev].get(sym)
        if new and old and old[0]:
            return round((new[0] / old[0] - 1) * 100, 2)
        return None

    def deliv_avg(sym, day_list):
        return avg([daily[d][sym][1] for d in day_list if sym in daily[d]])

    def deliv_qty_avg(sym, day_list):
        return avg([daily[d][sym][4] for d in day_list if sym in daily[d]])

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
            # Newsletter column is delivered QUANTITY week-avg vs month-avg
            # (matches Trendlyne), not delivery-percentage ratio.
            wk, mo = deliv_qty_avg(sym, week_days), deliv_qty_avg(sym, month_days)
            ratio = round(wk / mo, 1) if wk and mo else None
            moves.append({"symbol": sym, "name": name, "weekly_pct": chg,
                          "weekly_pct_fri_to_fri": weekly_change_fri(sym),
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
            # Exclude short-history names (recent listings) whose averages
            # are unstable and which the published screener filters out.
            history = sum(1 for d in six_month_days if sym in daily[d])
            if history < 100:
                continue
            wk, mo = deliv_avg(sym, week_days), deliv_avg(sym, month_days)
            six = deliv_avg(sym, six_month_days) if len(daily) >= 100 else None
            if wk and mo and mo > 0:
                deliv.append({"symbol": sym, "name": name, "week_avg_pct": wk,
                              "month_avg_pct": mo, "six_month_avg_pct": six,
                              "ratio": round(wk / mo, 2)})
        deliv.sort(key=lambda m: m["ratio"], reverse=True)
        report["sections"]["delivery_rising"] = deliv[:5]
        report["sections"]["delivery_falling"] = sorted(deliv[-5:], key=lambda m: m["ratio"])
        if len(daily) < 100:
            report["sections"]["delivery_note"] = (
                f"six_month_avg omitted: only {len(daily)} sessions loaded")
    except Exception as exc:
        report["errors"].append(f"nifty500 delivery: {type(exc).__name__}: {exc}")

    # ---- Official index closes (Nifty 50 / Bank Nifty; Sensex is BSE) ----
    try:
        idx_new = fetch_index_closes(session, last_day, cache_dir)
        idx_old = fetch_index_closes(session, week_start_prev, cache_dir)
        if idx_new and idx_old:
            bench = {}
            for label in ("Nifty 50", "Nifty Bank"):
                if label in idx_new and label in idx_old:
                    bench[label] = {
                        "close": idx_new[label], "close_date": last_day.isoformat(),
                        "weekly_pct": round((idx_new[label] / idx_old[label] - 1) * 100, 2),
                    }
            report["sections"]["benchmark_indices_official"] = bench
        else:
            report["errors"].append(
                f"index closes: ind_close_all unavailable for {last_day} or "
                f"{week_start_prev} (older files may be purged; Yahoo covers this)")
    except Exception as exc:
        report["errors"].append(f"index closes: {type(exc).__name__}: {exc}")

    # ---- 52-week highs/lows in the past week (Nifty 200) ----
    # Published convention: "past week" spans 7 calendar days INCLUDING
    # the previous Friday's session.
    try:
        n200 = fetch_index_members(session, 200)
        week52_days = [d for d in sessions_sorted if d >= prev_friday]
        highs, lows = compute_52wk_lists(daily, sessions_sorted, week52_days, n200)
        report["sections"]["week_52w_highs_nifty200"] = highs
        report["sections"]["week_52w_lows_nifty200"] = lows
        if len(daily) < 240:
            report["sections"]["week_52w_note"] = (
                f"window is {len(daily)} sessions (~{len(daily)//21} months), "
                "not a full 52 weeks — cross-check before publishing")
    except Exception as exc:
        report["errors"].append(f"52wk lists: {type(exc).__name__}: {exc}")

    # ---- FII F&O net (₹ cr) summed over the week ----
    try:
        fno, fno_days = fetch_fii_fno_week(session, week_days)
        report["sections"]["fii_fno_week"] = fno
        report["sections"]["fii_fno_days_covered"] = fno_days
        report["sections"]["fii_fno_note"] = (
            "Net buy-sell per segment from NSE daily fii_stats files. DII F&O and "
            "YTD splits still come from Trendlyne or user upload.")
    except Exception as exc:
        report["errors"].append(f"fii_fno: {type(exc).__name__}: {exc}")

    # ---- Upcoming Nifty 50 results (next week) ----
    try:
        n50 = fetch_index_members(session, 50)
        report["sections"]["upcoming_nifty50_results"] = fetch_upcoming_results(
            session, this_friday, n50)
    except Exception as exc:
        report["errors"].append(f"event_calendar: {type(exc).__name__}: {exc}")

    # ---- FII/DII provisional cash (latest day; persisted for weekly sums) ----
    try:
        resp = session.get(FIIDII_API, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        latest = resp.json()
        report["sections"]["fii_dii_daily_raw"] = latest
        # Persist each day's figures so scheduled runs accumulate the week.
        store = REPO_ROOT / "data" / "fii_dii"
        store.mkdir(parents=True, exist_ok=True)
        for entry in latest:
            d = parse_date_any(entry.get("date"))
            if d:
                path = store / f"{d.isoformat()}.json"
                existing = json.loads(path.read_text()) if path.exists() else []
                existing = [e for e in existing if e.get("category") != entry.get("category")]
                existing.append(entry)
                path.write_text(json.dumps(existing, indent=1), encoding="utf-8")
        # Weekly sums from whatever daily captures exist for this week.
        week_net = {"FII/FPI": 0.0, "DII": 0.0}
        covered = []
        for day in week_days:
            path = store / f"{day.isoformat()}.json"
            if not path.exists():
                continue
            covered.append(day.isoformat())
            for e in json.loads(path.read_text()):
                if e.get("category") in week_net:
                    week_net[e["category"]] += float(e.get("netValue", 0))
        report["sections"]["fii_dii_week_cash"] = {
            "fii_net_cr": round(week_net["FII/FPI"], 2),
            "dii_net_cr": round(week_net["DII"], 2),
            "days_covered": covered,
            "note": "Complete only if all 5 sessions are covered by daily captures",
        }
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
    for key in ("week_52w_highs_nifty200", "week_52w_lows_nifty200"):
        if key in report["sections"]:
            print(f"\n{key}: {', '.join(report['sections'][key]) or '(none)'}")
    if "fii_fno_week" in report["sections"]:
        print(f"\nFII F&O net (₹ cr, {len(report['sections']['fii_fno_days_covered'])} days): "
              f"{report['sections']['fii_fno_week']}")
    if "upcoming_nifty50_results" in report["sections"]:
        print("\nUpcoming Nifty 50 results:")
        for ev in report["sections"]["upcoming_nifty50_results"]:
            print(f"  {ev['date']}  {ev['company']}")
    if "fii_dii_week_cash" in report["sections"]:
        print(f"\nFII/DII week cash: {report['sections']['fii_dii_week_cash']}")
    if report["errors"]:
        print("\nERRORS:")
        for e in report["errors"]:
            print(f"  - {e}")
    print(f"\nSaved {out_dir / 'nse_data.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

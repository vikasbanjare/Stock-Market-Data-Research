# Echo — Data Source Map

Every table in the newsletter, where its numbers come from, and how to
extract them. URLs here are the canonical sources from the editorial
command document.

## Benchmark indices
| Item | Source |
|---|---|
| Nifty 50, Sensex, Bank Nifty — Friday close + weekly % | NSE/BSE closes; cross-check via Trendlyne or reputable news. Weekly % = this Friday close vs previous Friday close. |

Self-check: the printed weekly % must recompute exactly from the two
Friday closes. Published issues are not a calibration source — the
29 Jun–5 Jul 2025 issue printed Sensex −0.41% when its own closes
(84,058.90 → 83,432.89) give −0.74%.

## Market breadth (all stocks)
- Total gainers: https://trendlyne.com/fundamentals/stock-screener/692095/top-gainers-all/
- Total losers: https://trendlyne.com/fundamentals/stock-screener/692099/top-losers-all/
- Use the total result counts, not the row data.
- **Original screeners DEAD as of Jun 2026 (404). REBUILT via the screener
  data API** — `fetch_pages.py` saves `breadth_counts.json`
  (`{"gainers": N, "losers": N}`), from `body.totalCount` of
  `query=week_changeP > 0` / `< 0` over `groupType=all`.
- API quirks (apply to every call below): pagination is `pageNumber`
  (0-indexed) and rows cap at 25/page; `sortBy`+`order` are mandatory
  (omitting them throws a misleading "check query" error); requests must
  send `Accept: application/json` or the DRF endpoint renders HTML
  (curl's default `*/*` is fine).

## Top weekly gainers & losers (Nifty 100) + delivery volume
- Gainers: https://trendlyne.com/fundamentals/stock-screener/677797/top-gainers-stocks-with-delivery-volume/index/NIFTY100/nifty-100/
  - Filter/sort column `week chg %` descending ("9 to 1") → take first 5.
- Losers: https://trendlyne.com/fundamentals/stock-screener/677798/top-losers-stocks-with-delivery-volume/index/NIFTY100/nifty-100/
  - Filter/sort column `week chg %` ascending ("1 to 9") → take first 5.
- Columns published: stock name, % weekly change, delivery volume in past
  week vs prev month (as a multiple, e.g. `1.5X`).

### Extracting screener tables (the pages are JS shells)
The screener `.html` pages contain no table rows — the data loads from
a JSON API that `fetch_pages.py` also saves as `<name>.json`:

    https://trendlyne.com/fundamentals/tl-all-in-one-screener-data-get/
      ?screenpk=<id>&groupType=index&groupName=<NIFTY100|NIFTY200|...>
      &page=1&perPageCount=100&sortBy=week_changeP&order=<DESC|ASC>

Useful response fields: `body.tableHeaders` / `body.tableData`
(`week_changeP`, `delivery_5day_avg_vol`, `delivery_30day_avg_vol`, and
the week-vs-month delivery multiple as the `tlcusparam_*` column) and
`body.totalCount`. The group must be one the screener was built for.

## 52-week high / low in the past week (Nifty 200)
- Highs: https://trendlyne.com/fundamentals/stock-screener/674839/stocks-that-hit-their-52-week-high-in-the-past-week/index/NIFTY200/nifty-200/
- Lows: original screener 674842 **DEAD as of Jun 2026 (404). REBUILT** —
  `fetch_pages.py` saves `n200_52w_highlow.json`: it pulls
  `week_low,year_low,week_high,year_high` for every NIFTY200 stock (via
  `query=week_changeP > 0` then `< 0`) and computes
  `week_low <= year_low` (low) / `week_high >= year_high` (high) locally.
  The computed high list reproduces screener 674839's output exactly
  (validated 11/11 on 2026-06-12) — use the JSON for both lists.
- Publish full name lists; flag lifetime highs separately when known.

## Delivery-volume movers (Nifty 500)
- Original screeners 670507 (rising) and 678211 (falling) **DEAD as of
  Jun 2026 (404). REBUILT** — `fetch_pages.py` saves
  `n500_delivery_movers.json`: it pulls
  `delivery_5day_avg, delivery_30day_avg, delivery_6M_avg` plus the
  volume fields for every NIFTY500 stock (screeners 677797+677798
  regrouped to NIFTY500 jointly cover the index), ranks by
  `delivery_5day_avg_vol / delivery_30day_avg_vol`, and stores
  `rising_top6` / `falling_bottom6`.
- The published table has SIX rows each (29 Jun–5 Jul issue), sorted by
  the week-vs-month delivery-volume multiple, which is not itself a
  printed column.
- Columns printed: avg delivery volume % (week) = `delivery_5day_avg`,
  avg month delivery volume % = `delivery_30day_avg`,
  avg 6-month delivery volume % = `delivery_6M_avg`.

## FIIs vs DIIs (₹ crore)
Last week:
- Cash (provisional): https://trendlyne.com/macro-data/fii-dii/latest/cash-pastmonth/ — sum the past week's daily FII and DII net buy/sell.
- FII index futures & index options: https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-index-pastmonth/
- FII stock futures & stock options: https://trendlyne.com/macro-data/fii-dii/latest/fii-fno-stock-pastmonth/
- DII index futures & index options: https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-index-pastmonth/
- DII stock futures & stock options: https://trendlyne.com/macro-data/fii-dii/latest/mf-fno-stock-pastmonth/

Year-to-date:
- Cash: https://trendlyne.com/macro-data/fii-dii/year/cash-year/
- FII F&O: https://trendlyne.com/macro-data/fii-dii/year/fii-fno-index-year/ and https://trendlyne.com/macro-data/fii-dii/year/fii-fno-stock-year/
- DII F&O: https://trendlyne.com/macro-data/fii-dii/year/mf-fno-index-year/ and https://trendlyne.com/macro-data/fii-dii/year/mf-fno-stock-year/

Always state the data cut-off note (FII F&O vs DII F&O availability dates
usually differ).

Extraction: every FII/DII page embeds all of its tables (daily
past-month, monthly back to 2014, yearly) as `data-jsondata` attributes
in the saved HTML — any one saved page carries the full set. "Last week"
= sum of the Mon–Fri daily rows that exist; YTD = Jan–prior-month
monthly rows + current month's daily rows up to the Friday.

## Commodities
`new` = latest close from the live page. `old` = previous Friday's close
from the historical-data page (8th row when pulled right after Friday's
close; verify by date, not row position). Weekly % = `new/old − 1`.

| Commodity | Live | Historical |
|---|---|---|
| Brent Crude | https://www.investing.com/commodities/brent-oil | https://www.investing.com/commodities/brent-oil-historical-data |
| Gold Futures | https://www.investing.com/commodities/gold | https://www.investing.com/commodities/gold-historical-data |
| Silver Futures | https://www.investing.com/commodities/silver | https://www.investing.com/commodities/silver-historical-data |
| Natural Gas (NYMEX) | https://www.investing.com/commodities/natural-gas | https://www.investing.com/commodities/natural-gas-historical-data |
| Copper Futures | https://www.investing.com/commodities/copper | https://www.investing.com/commodities/copper-historical-data |

## Forex
Same old/new method (historical-data page → previous Friday's row; verify
by date). **Published weekly % is from the rupee's perspective:
positive = rupee strengthened = `old/new − 1` (inverse of the raw pair
move).** Worked example from the 29 Jun–5 Jul issue: USD/INR closed
85.388 vs 85.456 the prior Friday (pair fell −0.08%) and the issue
printed **+0.08%** (rupee strengthened).

| Pair | Live | Historical |
|---|---|---|
| USD/INR | https://www.investing.com/currencies/usd-inr | https://www.investing.com/currencies/usd-inr-historical-data |
| EUR/INR | https://www.investing.com/currencies/eur-inr | https://www.investing.com/currencies/eur-inr-historical-data |
| GBP/INR | https://www.investing.com/currencies/gbp-inr | https://www.investing.com/currencies/gbp-inr-historical-data |

## Upcoming events (next week)
- m.Stock calendar: https://trade.mstock.com/#/index/watchlist/eventCalendar/today (login may be required — ask user if blocked)
- Trendlyne earnings calendar (adjust dates to next Mon–Fri, Nifty 50):
  https://trendlyne.com/equity/calendar/all/all/?start_date=<YYYY-MM-DD>&end_date=<YYYY-MM-DD>&corporate_actions=Results&defaultStockgroup=index%2FNIFTY50%2Fnifty-50%2F
- Macro events: WPI/CPI prints, FX reserves, RBI announcements, insurance
  premium data, MF inflows — cross-check with news calendars.

## User-supplied each run (internal — never fetch, never invent)
- Most traded on m.Stock (Delivery + Pay Later/MTF, most bought/sold)
- Research Calls (new calls + performance of earlier calls)
- YouTube video link(s) for the closing section

## Network allowlist needed for direct fetching
The environment's network policy must allow at least:
`trendlyne.com`, `www.investing.com`, `trade.mstock.com`.
Note: these sites also run bot protection. Trendlyne's WAF flips between
blocking python-requests and curl (the fetch script tries both).
Investing.com's Cloudflare challenge blocks both direct clients — use
the agent's web-fetch tool for those pages, or user uploads per the
runbook.

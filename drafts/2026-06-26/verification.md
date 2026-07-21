# Echo — Verification Log
Issue: 20th June to 26th June 2026 (research window Mon 22 – Thu 25 Jun; Fri 26 Jun = Muharram market holiday, 4 trading sessions)
Run type: TEST RUN — tables from the echo-data-fetch Actions workflow (official NSE + Yahoo Finance), narratives via capped web search. Internal data not uploaded.

Status legend: ✅ confirmed (2+ independent sources) · ⚠️ single source — verify before publishing · ❌ not available → [FILL IN]

| # | Claim | Sources | Status |
|---|---|---|---|
| 1 | Nifty 50 closed the week at 24,056.00 | Yahoo Finance (^NSEI, workflow) = univest.in weekly review (exact match) | ✅ |
| 2 | Sensex closed at 77,100.47; +109.25 pts (+0.14%) on the final session | Yahoo (^BSESN) = univest.in and investmentguruindia (Bajaj Broking commentary) | ✅ |
| 3 | Bank Nifty closed at 58,177.05 | Yahoo (^NSEBANK) = univest.in weekly review | ✅ |
| 4 | Weekly % moves: Nifty +0.18%, Sensex +0.39%, Bank Nifty +0.85% | Computed from Yahoo Friday-to-Friday closes | ⚠️ computed single-path; sanity-consistent with news |
| 5 | Friday 26 Jun was Muharram market holiday; 4-session week | univest.in weekly review | ⚠️ single source (but consistent with all datasets: Yahoo index candles, NSE fii_stats absent for 26th) |
| 6 | India VIX collapsed from 27.32 to ~13.05 during the week | univest.in weekly review | ⚠️ single source |
| 7 | US–Iran ceasefire (signed ~17 Jun) + Strait of Hormuz reopening drove oil collapse | capital.com; cnbc.com (26 Jun); gulfnews.com | ✅ |
| 8 | Brent settled $71.99 Friday, −4.34% that day; cargo ship attacked near Oman same week | cnbc.com = Yahoo (BZ=F) exact match | ✅ |
| 9 | Weekly commodity moves: Brent −9.84%, Gold −3.44%, Silver −10.62%, NatGas −0.06%, Copper −3.66% | Yahoo (workflow); ceasefire-unwind narrative corroborated by cnbc/gulfnews | ✅ prices / ⚠️ weekly % single-path |
| 10 | Market breadth 916 gainers / 1,470 losers (weekly, all NSE EQ) | Computed from NSE official bhavcopies (workflow) | ✅ official data, deterministic |
| 11 | Nifty 100 top gainers: InterGlobe +8.53% (1.2X deliv), Tata Motors +7.41%, Cipla +6.53%, Chola +6.25%, Dr. Reddy's +6.16% | NSE bhavcopies (workflow) | ✅ official data |
| 12 | Nifty 100 top losers: Vedanta −9.09%, HZL −8.07%, IRFC −7.78%, Jindal Steel −6.87%, Hindalco −5.62% | NSE bhavcopies (workflow) | ✅ official data |
| 13 | Vedanta saw heavy selling at many times average volume; metals extended losses through the week | multibagg.ai (18x avg volume, −7.69% day); businesstoday.in (24 Jun metals selloff) | ✅ |
| 14 | 52-week highs list (16 stocks, Nifty 200) | Computed from 250 sessions of NSE bhavcopy highs (workflow) | ✅ official data; method = intraday-high vs prior 245 sessions |
| 15 | 52-week lows: Infosys, TCS, Wipro | Workflow computation = whalesbook/businesstoday/zeebiz reporting IT majors at 52-week lows in this period | ✅ |
| 16 | IT selloff causes: Accenture guidance cut (stock −18%), AI pricing worries, JP Morgan downgrades of HCL Tech & Wipro | gopocket.in; zeebiz.com; whalesbook.com | ✅ |
| 17 | Delivery-mover tables (both, incl. 6-month averages) | NSE bhavcopies, 250 sessions (workflow) | ✅ official data |
| 18 | FII F&O week (₹ cr): IdxFut +426.37, StkFut −1,225.53, IdxOpt +5,629.53, StkOpt +1,698.14 | NSE daily fii_stats files, 4 sessions (workflow) | ✅ official data; covers the week's 4 sessions |
| 19 | FIIs net buyers ~$788mn for 2nd straight week | inthemoneybyzerodha.substack.com (via search summary) | ⚠️ single source; exact ₹ cr cash figure still [FILL IN] |
| 20 | Sector week: Pharma +2.1%, Healthcare +1.9%, Realty +1.8%, Auto top performer, FMCG positive | trueturtles.in weekly wrap; univest.in | ⚠️ two sources via one search; re-verify exact %s if quoted |
| 21 | RBI announced liquidity measures incl. lending against foreign-currency deposits | trueturtles.in / search summary | ⚠️ single source — soften or verify RBI press release |
| 22 | Rupee +16 paise to 94.39 on final session; held below 95; crude collapse supportive | hdfcsky.com = Yahoo USDINR 94.40 (₹0.01 gap = source timing) | ✅ |
| 23 | US week: S&P 500 ~−2%, Nasdaq −4.6%, Dow +0.6%; Micron-led chip selloff | cnbc.com; lpl.com weekly performance | ✅ |
| 24 | KOSPI circuit breaker, >9% plunge; Samsung/SK Hynix hit; Nikkei −6.44%, TOPIX −2.90%; Europe moderately lower (STOXX 600) | troweprice.com; angelone.in (KOSPI) | ✅ |
| 25 | Upcoming: IIP (May) ~29 Jun; auto sales ~1 Jul; HSBC Mfg PMI final ~1 Jul | x.com/marketsday events list; goodreturns.in; whalesbook.com | ⚠️ dates from secondary calendars — confirm against Trendlyne/m.Stock |
| 26 | FII/DII cash table, DII F&O, YTD tables | Trendlyne bot-walls all automated access (HTTP 405 even from GitHub runners) | ❌ [FILL IN] — weekly screenshot |
| 27 | m.Stock most-traded; research calls; video links | Internal | ❌ [FILL IN] by design |

## Notes
- Index/commodity/forex closes cross-validated: workflow numbers matched news-reported closes exactly (Nifty 24,056.00; Brent 71.99; rupee 94.39/94.40).
- FII F&O covers 4 sessions — complete for this holiday-shortened week.
- Weekly-% figures are Friday-to-Friday from Yahoo; the previous Friday (19 Jun) was a normal session, so the base is clean.

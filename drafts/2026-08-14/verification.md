# Echo — Verification Log
Issue: 8th August to 14th August 2026 (research window Mon 10 – Fri 14 Aug, 5 sessions)
Run type: 4:30 same-day edition — flash data (Friday-inclusive prices, shipped 4:28pm) + full NSE data (Thursday-vintage delivery/FII, landed ~4:00pm, patched in by 4:15pm). Trendlyne connector live but its MCP tier has no screener execution (probe confirmed) — NSE-official values used, same vintage as the published product.

Status legend: ✅ confirmed (2+ sources) · ⚠️ single source / flagged · 🕖 evening-refresh cell

| # | Claim | Sources | Status |
|---|---|---|---|
| 1 | Nifty 24,366.00 −0.83%, Sensex 78,009.25 −0.62%, Bank Nifty 57,491.10 −0.44% (Fri–Fri) | Yahoo flash (500/500 quotes) vs stored prev-Friday chain base | ✅ VERIFIED: official ind_close_all Friday file matches shipped closes exactly (Nifty 24,366.00 −0.83%, Bank Nifty 57,491.10 −0.44%) |
| 2 | CPI 4.45% (19-month high) as the week's pivot; Red Sea / Gulf of Oman attacks re-lifting crude | Press corroboration during draft run (capped searches) | ✅ |
| 3 | Gainers: Bosch +9.66 (1.8X), Solar Inds +7.07 (1.3X), Tata Motors +4.68 (1.2X), DMart +4.10 (0.9X), DLF +3.58 (🕖) | Flash prices (Fri-incl.); ratios from full-run NSE Thursday-window deliv-qty week÷month | ✅ complete; DLF 0.5X from Friday-official N100 lookup — narrative corrected to thin-delivery rally; Fri–Fri %s validated (DLF 3.58 exact) |
| 4 | Losers: GCPL −11.02 (12.6X), PFC −10.48 (🕖), REC −8.72 (🕖), HZL −6.82 (🕖), Max Health −5.74 (1.4X) | Flash prices; GCPL/Max ratios from full-run top-5; GCPL CEO-exit narrative press-corroborated | ✅ complete; PFC 2.3X / REC 2.4X / HZL 1.3X from Friday-official window; Fri–Fri %s validated exactly (GCPL −11.02, PFC −10.48, REC −8.72, HZL −6.82, Max −5.74) |
| 5 | Breadth 189 gainers / 311 losers (N500, Fri-incl.) | Flash computation | ✅ |
| 6 | 52-week highs (23) incl. Bosch, Solar, TVS, Titan, Zydus; lows (3): GCPL, HDFC Bank, PI Industries | Full-run computation, 250 sessions official history, 7-day window incl. prev Friday | ✅ method; HDFC Bank low is the flagged headline claim — spot-check vs adjusted chart before publishing (bonus was ~Aug 2025, raw-price low is genuine vs post-bonus history but verify optics) |
| 7 | Delivery movers: Rising — Newgen, FACT, Nuvoco, SBI Cards (62.3% wk avg), Aegis; Falling — Signature Global, Sapphire, BEML, Finolex Cables, Devyani | Full-run NSE bhavcopies, Thursday window — same vintage as published product | ✅ official |
| 8 | FIIs: +₹720.12 cr net cash (4 sessions to Thu), buyers Mon then sellers post-CPI; DIIs +₹8,929.23 cr | NSE official daily captures persisted in data/fii_dii/ | ✅ Friday print added: FII +508.12 / DII +356.40; full week FII +1,228.24 / DII +9,285.63; YTD chained through 14 Aug |
| 9 | FII F&O: IdxFut −3,771.57, StkFut −249.39, IdxOpt −40,378.32, StkOpt −2,956.38 (₹cr) | NSE fii_stats, five sessions to 13 Aug (noted in issue) | ✅ official |
| 10 | Commodities: Brent 87.19 +5.11%, Gold 4,410.00 +0.33%, Silver 64.92 +1.76%, NatGas 2.760 +2.83%, Copper 6.594 −0.18% | Yahoo flash w/ chain base; Brent–WTI spread guard passed | ✅ snapshot; Saturday settle finalizes |
| 11 | USD/INR 95.415 (−0.23% rupee-perspective), EUR/INR −0.05%, GBP/INR −0.40% | Yahoo flash, chain base | ⚠️ single-path; evening/Saturday confirm |
| 12 | Tata Motors PV Q1: revenue ₹95,799 cr, PAT ~₹900 cr, ~6% results-day fall | Press (capped searches during draft) | ✅ |
| 13 | Upcoming events: NSE earnings calendar returned empty (season over) — calendar kept to Independence Day + RBI weekly reserves | NSE corporate calendar API | ✅ official; add macro dates manually if desired |
| 14 | Internal: m.Stock most-traded, research calls, video, IPO splits, DII F&O + YTD F&O | Awaiting upload / Trendlyne screenshot | [FILL IN] |

## Run notes
- Trendlyne MCP probe (this run): natural-language query asking for "Nifty 500 rising delivery, sorted by ratio, top 5" returned ten arbitrary stocks with delivery columns — the tier resolves columns, not screeners. No screener-ID access, no universe/sort/filter execution. Screener pages remain browser-only (CAPTCHA blocks runner browser). DII F&O + YTD splits stay on screenshot/upload until Trendlyne exposes screener or F&O tools.
- Evening refresh (executed ~7:15–7:50pm IST): NSE's Friday files landed after the 18:45 cron ran, so the workflow was re-triggered twice — once on main for the Friday session, once on this branch with an extended fetch script that emits the full Nifty 100 moves list (so ratio cells for flash-table names can always be filled; permanent fix). All *(evening)* cells filled; all shipped Fri–Fri percentages and index closes verified exact against official files. One narrative corrected: DLF's rise came on 0.5X delivery (thin), not accumulation.
- Saturday ~8am settle run finalizes commodities/forex closes.

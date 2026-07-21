# Echo — Verification Log
Issue: 11th July to 17th July 2026 (research window Mon 13 – Fri 17 Jul, 5 sessions)
Run type: MACHINE-GENERATED COMPARISON EDITION — tables from the echo-data-fetch workflow; internal sections taken from the team's manual issue (standing in for the Friday upload); narratives fact-checked below.

Status legend: ✅ confirmed (2+ independent sources) · ⚠️ single source / team-supplied — flagged · 🔧 deliberate deviation from the manual issue, with reason

| # | Claim | Sources | Status |
|---|---|---|---|
| 1 | Index closes: Nifty 24,334.30, Sensex 78,151.45, Bank Nifty 58,521.40 | NSE official index file + Yahoo (workflow) = manual issue (exact) | ✅ |
| 2 | Weekly %: Nifty +0.53%, Sensex +0.75%, Bank Nifty +0.82% | Computed Fri-to-Fri; prior Friday closes verified via business-standard.com (Nifty 24,206.90, Sensex 77,569.39 on 10 Jul) and NSE official index file | ✅ 🔧 deviates from manual issue (+1.28/+1.12/+1.60), whose base (~24,027) is not the prior Friday close |
| 3 | Market breadth 805 / 1,540 (NSE EQ, weekly) | NSE bhavcopies (workflow) | ✅ official 🔧 manual issue used Trendlyne all-exchange universe (2,648/2,829) — convention decision pending |
| 4 | Gainers: ABB +9.80% (2.3X), TCS +9.67% (1.5X), TechM +8.12% (1.2X), Divi's +6.02% (1.7X), Siemens +4.64% (1.1X) | NSE bhavcopies; ratio = delivered-quantity week-avg vs month-avg (fixed convention) | ✅ official; % differ from manual issue due to its week-window (see #2); Vedanta ratio matches manual exactly (0.7X) |
| 5 | Losers: Vedanta −7.15%, Muthoot −4.47%, Siemens Energy −4.01%, HDFC AMC −3.98% (1.6X), HZL −3.46% | NSE bhavcopies | ✅ official; manual issue lists Varun Beverages/Bosch instead of Muthoot/Siemens Energy — window difference |
| 6 | TCS rallied on Q1 FY27 earnings | upstox.com weekly wrap; business-standard.com (10 Jul, results day) | ✅ |
| 7 | Tech Mahindra Q1: net profit ₹1,465 cr (+28.4% YoY), revenue $1.66bn, margin 14.4%, 11th straight quarter of expansion; deals >$1bn; Nomura/Jefferies positive | investing.com company-news; upstox.com; manual issue ($1bn deals) | ✅ |
| 8 | HCL Technologies seven-year contract win; Wipro results disappointed, brokerages cut estimates | Manual issue (team-verified) | ⚠️ team-supplied — spot-check before publishing |
| 9 | Nifty IT +~4.4% for the week | upstox.com ("NIFTY IT jumps over 4%") + manual issue (4.4%) | ✅ |
| 10 | 52-week highs (17, Nifty 200) and lows (7) | Computed from 250 sessions of NSE bhavcopy highs/lows | ✅ official; manual issue adds Grasim & Premier Energies to highs (likely its 7-calendar-day window incl. 10 Jul) — lows match manual 7/7 exactly |
| 11 | SBI Funds Management IPO: 41.73x overall, QIB 140.11x, retail 3.76x, ₹9,813 cr, listing Tuesday | Manual issue | ⚠️ team-supplied |
| 12 | Biocon up on Viatris/Mylan stake-sale removing overhang | Manual issue; consistent with Biocon 52-week high in official data | ⚠️ team-supplied, corroborated indirectly |
| 13 | Sector color: banks pre-results positioning; Maruti/M&M/Eicher up, Ashok Leyland/Motherson/Bharat Forge weak; Vedanta-split companies corrected; Tata Steel weak start; HUL recovery, Nestle/TCP/Dabur pressure | Manual issue (team-verified) + official data corroboration (Vedanta/HZL top losers; ITC 52w low) | ⚠️ team-supplied narrative, data-consistent |
| 14 | Delivery movers tables (both, 3 columns) | NSE bhavcopies, 250 sessions | ✅ official; rankings 2–5 differ from manual issue (Trendlyne averaging windows/sort) — convention decision pending |
| 15 | Signature Global pre-sales +25% QoQ driving delivery rise; LG Electronics weak-Q4 digestion | Manual issue | ⚠️ team-supplied; Signature Global is #1 riser in both datasets |
| 16 | FII cash −6,139.70 cr; DII +10,810.40 cr; all DII F&O cells; both YTD rows | Manual issue (Trendlyne) — treated as the weekly upload | ⚠️ as-uploaded; not independently reproducible (Trendlyne bot-wall) |
| 17 | FII F&O weekly: IdxFut +6,015.33, StkFut −5,850.22, IdxOpt −44,835.08, StkOpt −1,028.93 | NSE official fii_stats, 5 sessions | ✅ official 🔧 deviates from manual issue, whose figures stop at 16 Jul per its own footnote |
| 18 | Commodities: Brent 88.10 +15.91% (intraday >$90), Gold 4,012.70 −2.23%, Silver 56.04 −6.31%, NatGas 2.911 −0.99%, Copper 6.22 −0.22% | Yahoo (workflow); Brent close/weekly % corroborated verbatim by press wrap; US-Iran driver via newkerala/upstox/businesstoday | ✅ 🔧 deviates from manual issue's Friday-evening snapshots (e.g., its Brent 84.84 vs the true close 88.10) |
| 19 | Gold narrative: stronger dollar + elevated yields dulled appeal | Press wrap ("reviving inflation worries and rate-hike bets") | ⚠️ manual issue's "lower US inflation print" framing not adopted — conflicts with press consensus; flagged for editorial decision |
| 20 | Forex closes: USD/INR 96.502 −1.21%, EUR/INR 110.310 −1.36%, GBP/INR 129.787 −1.52% | Manual issue (Investing.com Friday closes) — used because Yahoo's INR pairs carried Thursday-dated bars (96.652/110.187/130.232, 16 Jul); direction and magnitude consistent | ⚠️ team-supplied closes; known Yahoo-lag gap logged for fix (add RBI reference rate) |
| 21 | Rupee drivers: crude surge/import bill, safe-haven dollar demand; weakest vs GBP | Manual issue + businesstoday.in (US-Iran tension backdrop) | ✅ |
| 22 | Global: Asia chip selloff (Taiwan sharp), Nikkei/Hang Seng/China pressure; Europe mixed, FTSE resilient; US all three indices red, Nasdaq worst | Manual issue + upstox weekly wrap (global chip selloff) | ⚠️ largely team-supplied, partially corroborated |
| 23 | Upcoming events table (18–24 Jul earnings incl. ICICI & Kotak on 18th) | NSE official corporate event calendar (workflow) | ✅ official — richer than manual issue's 4-row table and consistent with its banking paragraph |
| 24 | m.Stock most-traded table; research calls (Markets Mojo × Samvardhana Motherson, IPCA); video links & blurbs | Manual issue (internal data) | ⚠️ internal, as-uploaded |

## Deliberate deviations from the manual issue (editorial review needed)
1. Weekly index % — corrected to true Friday-to-Friday (see #2).
2. Commodity closes — true Friday settlements instead of Friday-evening IST snapshots (see #18).
3. FII F&O — full 5-session week from NSE official files (see #17).
4. Market breadth — NSE-only universe pending the team's convention choice (see #3).
5. Gold paragraph reasoning — reworded (see #19).

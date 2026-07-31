---
name: echo
description: Produce the weekly "Echo" stock-market newsletter for Mirae Asset m.Stock. Use when the user says "run Echo", "build the newsletter", or similar on/after Friday market close. Fetches Trendlyne/Investing.com data, writes and fact-checks all narrative sections, merges user-uploaded internal data, and commits a Markdown + Word draft to the repo.
---

# Echo Weekly Newsletter — Production Runbook

You are producing **Echo**, the weekly newsletter for Mirae Asset m.Stock
subscribers. It is run **every Friday after Indian market close** (post
~3:30 PM IST). The output is a complete draft for human review — accuracy
matters more than speed. Every number must come from a source, never from
memory.

## 0. Dates

- **Issue header window:** previous Saturday → this Friday
  (e.g. run on Fri 12 Jun 2026 → header `6th June to 12th June`).
- **Research window:** Monday → Friday of the trading week just ended.
  Use it to scope ALL research, but **never mention these dates inside the
  newsletter text** (the header is the only place dates appear).
- If a weekday was a market holiday, note it in the intro if relevant.

## 1. Inputs to collect from the user at the start of the run

Ask the user to upload (screenshots, Excel, or pasted text):

1. **Most traded on m.Stock** — Delivery (most bought / most sold) and
   Pay Later/MTF (most bought / most sold). Internal platform data.
2. **Research Calls** — this week's partner calls (partner name, date,
   stock, view, entry/target price) AND performance update of earlier
   calls (date, stock, entry/target, % move since call).
3. **YouTube video(s)** for the closing section — URL(s); you write the
   1–2 line blurb from the video title/description.

If any of these are missing, insert a clearly marked
`[FILL IN: <what>]` placeholder and continue — never invent this data.

## 2. Data fetching (token-frugal order — follow strictly)

**HARD DEADLINE: the complete issue ships by 16:30 IST on Friday.**
Market closes 15:30; the flash data lands ~15:40; Trendlyne's engine and
NSE's published files carry data through THURSDAY at this hour — that is
the product's standard vintage. Publish Friday-live prices with
Thursday-vintage delivery/FII data and the standard cutoff note ("data
as of <Thursday's date>"). Never hold the issue for evening data: the
18:45 IST and Saturday runs are silent verification passes only.

**Friday freshness check (mandatory on live runs):** the repo's
`data/raw/<today>/nse_data.json` must have `latest_session` == today's
date. If it doesn't (or the folder is missing), trigger the
`echo-data-fetch.yml` workflow (ref `main`, input date = today) via the
GitHub tools, wait for its commit, and re-check. If still stale, NSE
hasn't published yet — wait 15–20 minutes and re-trigger, up to 3
attempts, before proceeding with a loud warning in the draft and the
run summary.

**Trendlyne MCP (when the `trendlyne` connector is present — check with
ToolSearch):** use it as the PRIMARY source for the Trendlyne-verbatim
tables, since it serves the same values the published screeners show:
- `get_parameter_values_multi_stock` with explicit stock lists (batch
  ~10–20 symbols per call) for: `Week Chg %` (gainers/losers tables),
  `Delivery% Vol. Avg Week/Month/6M` (delivery movers), and
  `Delivery Vol. Avg Week` ÷ `Delivery Vol. Avg Month` (the "X" ratio
  column). Sort locally, take top 5.
- `get_overview_news_corp_events` (news/events) and
  `get_ownership_deals_insider_sast` (`bulblockdeal`) to fact-check WHY
  movers moved — block deals explain delivery spikes.
- NOT in the MCP tier: FII/DII macro tables (weekly/YTD cash & F&O) and
  all-exchange breadth — those stay NSE-official + Trendlyne screenshot.
Keep the NSE pipeline running as the independent verification layer and
flag any material disagreement between the two in verification.md.

Scripts fetch and parse; you read only their compact output. NEVER read
raw downloaded HTML into the conversation, NEVER launch research
subagents, and cap web searches at ~10 for the whole run.

1. `python3 scripts/fetch_market_data.py` — Yahoo Finance JSON: index,
   commodity and forex closes + weekly % (forex already in the published
   rupee-perspective sign convention). Read the printed table /
   `market_data.json` only.
2. `python3 scripts/fetch_nse_data.py` — official NSE data: market
   breadth, Nifty 100 weekly gainers/losers with delivery ratios,
   Nifty 500 delivery movers, FII/DII daily cash. Read the printed
   summary / `nse_data.json` only.
3. Only for what the scripts could not provide (FII/DII F&O + YTD,
   52-week high/low lists, 6-month delivery averages, events calendar):
   `python3 scripts/fetch_pages.py` for the Trendlyne pages — but do NOT
   read the saved HTML directly; extract values with a short Python
   snippet (grep/parse → print just the numbers). If a page is blocked,
   ask the user for a screenshot/export instead.
4. Web search ONLY for the narrative sections (sector stories, global
   signals, reasons behind moves) and to spot-check headline numbers.
   Budget ~8–10 searches total; one search per sector topic, not per
   claim.

If a script fails (bot wall / domain not in the environment's network
allowlist), tell the user exactly which source failed and ask for an
upload or a network-policy fix. Never reconstruct screener tables from
search results — those must come from NSE/Trendlyne data or the user.

## 3. Section-by-section build order

Build sections in this order (data first, narrative last so the intro and
closing reflect the full picture). The exact table layouts are in
`templates/echo_template.md`; the per-section sources, screener filters,
and computation rules are in `reference/data_sources.md`.

1. **Benchmark Index Moves** — Nifty 50, Sensex, Bank Nifty: Friday close
   + % weekly change (vs previous Friday close). 2 decimal places, Indian
   digit grouping (e.g. `25,461.00`).
2. **Market Breadth** — total gainers and total losers from the two
   Trendlyne screeners. One sentence: momentum positive/negative.
3. **Top Weekly Gainers & Losers (Nifty 100)** — top 5 each from the
   Trendlyne screeners (sort week chg % descending for gainers, ascending
   for losers). Include delivery volume multiple (week vs prev month,
   e.g. `1.5X`). Then 1–3 short paragraphs explaining the most notable
   movers (bold the stock names), researched and fact-checked via web
   search. Mention notable IPO listings of the week here if any.
4. **Year high / year low (Nifty 200)** — list all 52-week-high stocks
   and all 52-week-low stocks from the screeners. **Use the full-run
   nse_data.json lists (7-day window including the previous Friday) —
   NEVER the flash lists, whose Mon–Fri window under-counts.** Call out
   lifetime highs and add a short note on the most interesting name(s).
   (Known source gap: Yahoo's Sensex close can differ ~10-15 pts from
   the official BSE close — cross-check the Sensex cell against a
   news-reported official close before publishing.)
5. **Stocks & Sectors in the News** — run the sector rewrite command
   (below, §4a).
6. **Top Delivery-volume Movers (Nifty 500)** — 5 rising and 5 falling
   delivery-volume stocks with the three columns (week avg %, month avg %,
   6-month avg %). Add 1–2 paragraphs explaining the biggest spikes/drops
   (block deals, stake sales, etc.), fact-checked.
7. **Most traded on m.Stock** — format the user-uploaded data into the
   4-column table. Keep the standard disclaimer note.
8. **FIIs vs DIIs** — two tables (last week, year-to-date): cash
   (provisional) + index futures + stock futures + index options + stock
   options, for FIIs and DIIs, in ₹ crore. Add the data-cutoff note
   (e.g. "FII F&O data is up to <date> and DII F&O data till <date>
   only."). Add 1–2 sentences on the week's pattern (story format per
   §4a2). **YTD cash cells: chain the previous issue's YTD base forward
   with the official daily flows in data/fii_dii/ (base + all captured
   sessions since the previous issue's cutoff), and say "as of <date>".
   F&O YTD cells: Trendlyne screenshot only — never chain or estimate.**
9. **Research Calls** — format user-uploaded data into the two tables.
   Keep the `Disclaimer` line.
10. **Commodity Moves** — Brent Crude, Gold, Silver, Natural Gas (NYMEX),
    Copper. `new` = Friday close from the live page; `old` = previous
    Friday close from the historical-data page (8th row when run after
    Friday close); weekly % = `new/old − 1`. Then run the commodities
    rewrite command (§4b).
11. **Forex Moves** — USD/INR, EUR/INR, GBP/INR. Same old/new method
    (historical-data page, previous Friday row). **Sign convention: the
    published "Weekly change %" is from the rupee's perspective —
    positive = rupee strengthened — i.e. `old/new − 1`, the inverse of
    the raw pair move.** Flag this in your verification notes every run.
    Then run the forex rewrite command (§4c).
12. **Global Signals** — run the global markets rewrite command (§4d).
13. **Upcoming Events (next Sat → Fri)** — macro events (inflation prints,
    FX reserves, RBI, etc.) + major Nifty 50 earnings from the Trendlyne
    calendar / m.Stock events page. End with: *"You can explore our Events
    calendar feature on the home page & set alerts on your calendar!"*
14. **Intro narrative** (top of issue) — written last, with a strong
    story hook, as if telling someone the story of this week's market.
    Interesting and attractive first, details after. Be aware the
    market closed at 3:30pm on the issue's Friday. Conversational,
    numbers-anchored (see sample issue for voice).
15. **Closing narrative** — story format: how the current trends stand
    and what can impact the market next week based on them. Then
    *"Moving on to some insightful conversations"* + video URL(s) and
    blurb(s).
16. **Email header & sub-header suggestions** — 5 + 5 per §4a0,
    delivered in the run summary alongside the draft.

Also on request (separate from the Friday issue): mLearn fundamental
video transcripts — adapt YouTube transcripts to crisp British English
(minimal em dashes, "Chapter 3: How Candlesticks Are Formed" as the
format standard) plus social copy (Twitter/Instagram/LinkedIn captions,
video title, thumbnail title, YouTube description), each description
opening in the style: "In Chapter N of the mLearn Edge Fundamental
Explainers series, <presenter> breaks down <topic>." with a short
overview of the sector at the start.

## 4. Rewrite commands (verbatim style prompts)

These are the standing editorial commands. Substitute the research-window
dates; remember the output must NOT mention the dates.

### 4a0. Email header & sub-header (deliver WITH the draft, not inside it)
> You are a content writer at m.Stock writing the weekly newsletter.
> Suggest crisp, clickbait-worthy email headers for this issue — snappy,
> something that makes the reader open it. Give 5 headers, then 5
> sub-headers, grounded in the week's actual story. Grammar-check the
> issue and flag any sentence fragments.

### 4a1. IPO review (one paragraph, placed after the gainers/losers section)
> Give a quick review of IPO activity in the Indian market for the week
> (mainboard only — exclude SME IPOs; do not mention the dates). First
> the IPOs that opened for subscription this week and their response —
> overall subscription and the split by category (RII, NII, QIB) — then
> the IPOs that listed this week and how the listing went (gains or
> discount vs issue price). All in one paragraph.

### 4a. Stocks & Sectors in the News
> You are a content writer writing a newsletter for Mirae Asset m.Stock
> subscribers. Write an overview of 6 different sectors' performance for
> the week <Mon date> to <Fri date>, Indian stock market only. Do not
> mention these dates. For each sector write ONE paragraph (at least 2–3
> lines) containing both positive and negative news: start with the
> positive news / trending stocks, **bold** the share names that were
> trending or in the news, give the reasons behind the moves; then the
> negative news / underperformers with reasons. Name the specific
> best/worst performing stocks of the week, why, and how it impacted the
> sector. Fact-check everything and record sources in the verification
> log (sources are logged, not printed in the newsletter body).

Pick the 6 most newsworthy sectors of the week (e.g. banks, IT, autos,
FMCG, realty, metals, pharma, energy — whichever actually moved).
When covering Automotive, also include auto-components, commercial
vehicle and two-wheeler companies, not just passenger-vehicle makers.

### 4a2. FIIs & DIIs narrative (two paragraphs)
> You are the newsletter writer at m.Stock giving the weekly overview of
> FIIs and DIIs in the Indian stock market. Explain the week's trends in
> 2 separate paragraphs — one for FIIs, one for DIIs — in simple
> language, written in a story format, telling this week's story in an
> interesting way for common investors.

### 4b. Commodity Moves
> You are a content writer for Mirae Asset m.Stock subscribers. Using the
> completed commodity table and this week's trends, write an overview of
> Brent crude & natural gas futures (together, one paragraph), gold
> futures (own paragraph), and copper futures (own paragraph) for the
> week <Mon date> to <Fri date>. Do not mention the dates. Simple
> language for common readers. Mention the last closing numbers, the
> trend, the reasons behind it and what impacted it.

(Silver gets a bullet/mention when it moved notably — see sample issue.)

### 4c. Forex Moves
> You are a content writer for Mirae Asset m.Stock subscribers. Using the
> completed forex table, write an overview of USD/INR, EUR/INR, GBP/INR
> for the week <Mon date> to <Fri date>. Do not mention the dates. Say
> whether the rupee surged or fell against each currency and why
> (negative weekly change = rupee fell). One short paragraph per pair.

### 4d. Global Signals
> You are a content writer for Mirae Asset m.Stock subscribers. Write an
> overview of Asian markets, European markets and US markets for the week
> <Mon date> to <Fri date>. Do not mention the dates. Simple language,
> storytelling tone that keeps it readable for common people; describe
> how the trend developed specifically in this week.

## 5. Fact-checking (mandatory)

- Every narrative claim (why a stock moved, M&A, results, FDA approvals,
  block deals, etc.) must be verified by **web search against at least
  two independent reputable sources** scoped to the research window.
- Every table number must trace to a fetched file in `data/raw/` or a
  user upload.
- Write the verification log to `drafts/<issue-date>/verification.md`:
  one line per claim — claim → sources (URLs) → status (confirmed /
  could not verify). Anything not confirmed gets softened or cut from
  the draft, and flagged to the user.

## 6. Output & delivery

1. Assemble the full issue as `drafts/<YYYY-MM-DD>/echo_draft.md`
   following `templates/echo_template.md` exactly (section order,
   table shapes, standing notes/disclaimers).
2. Generate the Word version:
   `python3 scripts/build_docx.py drafts/<YYYY-MM-DD>/echo_draft.md`
3. Commit `echo_draft.md`, `echo_draft.docx`, and `verification.md` to
   the repo on the designated branch and push. Create/refresh the draft
   PR.
4. Send the .docx to the user in chat and summarize: which sections are
   complete, which have `[FILL IN]` placeholders, and anything that
   failed verification.

## 7. Hard rules

- Never invent or estimate a table number. Missing data → `[FILL IN]`.
- Never mention the research dates in body text.
- Bold stock names in narrative sections.
- Stocks tables: this is information, not advice — keep all standing
  disclaimers from the template.
- Numbers: 2 decimals for % and prices; ₹ crore for FII/DII; Indian
  digit grouping for index levels and crore values.

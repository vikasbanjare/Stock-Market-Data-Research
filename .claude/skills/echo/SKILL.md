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

- **Issue header window:** Sunday before the trading week → Saturday
  after it (e.g. run on Fri 12 Jun 2026 → header `7th June to 13th June`).
  This matches the published 29 Jun–5 Jul 2025 issue (trading week
  Mon 30 Jun – Fri 4 Jul). Note: the editorial command doc's example
  uses Saturday → Friday instead — if the editor corrects the window,
  follow their correction and update this rule.
- **Research window:** Monday → Friday of the trading week just ended.
  Use it to scope ALL research, but **never mention these dates inside the
  newsletter text** (the header is the only place dates appear).
- **Upcoming Events window:** next Sunday → next Saturday (the published
  sample's events header covers 6th July to 12th July).
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

## 2. Data fetching

Run `python3 scripts/fetch_pages.py` first. It downloads every source URL
listed in `reference/data_sources.md` into `data/raw/<YYYY-MM-DD>/` with
browser headers, retries, and a curl fallback (Trendlyne's WAF blocks
one HTTP client while serving the other). Then **read the saved files and
extract the numbers yourself** — do not trust any pre-parsed output
blindly. Where the data actually lives in the saved files:

- Trendlyne **screener pages are JS shells** — the saved `.html` has no
  table rows. The script also saves `<name>.json` from the screener data
  API for each live screener; read those for the table numbers
  (`week_changeP`, delivery columns, and `body.totalCount` for counts).
- Trendlyne **FII/DII pages embed every table** (daily past-month,
  monthly, yearly) as `data-jsondata` attributes in the saved HTML.

If a download is blocked (HTTP 403 / bot wall / domain not in the
environment's network allowlist):
1. Tell the user which source failed.
2. Investing.com sits behind a Cloudflare challenge that blocks direct
   HTTP clients — fetch those pages with the agent's web-fetch tool
   (it gets through), and verify the dates on every row you use.
3. Otherwise ask the user to upload a screenshot/export of that page, or
   fix the network policy, then re-run.
4. As a last resort for index levels and commodity/forex closes only, use
   web search against reputable sources (Reuters, Business Standard,
   Economic Times, Mint) and cross-check two sources. Never reconstruct
   screener tables (delivery %, gainers/losers lists) from search — those
   must come from Trendlyne or the user.

## 3. Section-by-section build order

Build sections in this order (data first, narrative last so the intro and
closing reflect the full picture). The exact table layouts are in
`templates/echo_template.md`; the per-section sources, screener filters,
and computation rules are in `reference/data_sources.md`.

1. **Benchmark Index Moves** — Nifty 50, Sensex, Bank Nifty: Friday close
   + % weekly change (vs previous Friday close). 2 decimal places, Indian
   digit grouping (e.g. `25,461.00`). **Self-check before publishing:**
   recompute each printed % from the two printed closes — they must agree.
   (The 29 Jun–5 Jul 2025 issue printed Sensex −0.41% when its own closes
   give −0.74%; never calibrate against published issues, only against
   source closes.)
2. **Market Breadth** — total gainers and total losers from the two
   Trendlyne screeners. One sentence: momentum positive/negative.
3. **Top Weekly Gainers & Losers (Nifty 100)** — top 5 each from the
   Trendlyne screeners (sort week chg % descending for gainers, ascending
   for losers). Include delivery volume multiple (week vs prev month,
   e.g. `1.5X`). Then 1–3 short paragraphs explaining the most notable
   movers (bold the stock names), researched and fact-checked via web
   search. Mention notable IPO listings of the week here if any.
4. **Year high / year low (Nifty 200)** — list all 52-week-high stocks
   and all 52-week-low stocks from the screeners. Call out lifetime highs
   and add a short note on the most interesting name(s).
5. **Stocks & Sectors in the News** — run the sector rewrite command
   (below, §4a).
6. **Top Delivery-volume Movers (Nifty 500)** — 6 rising and 6 falling
   delivery-volume stocks (the published issue prints six rows each) with
   the three columns (week avg %, month avg %, 6-month avg %). Add 1–2
   paragraphs explaining the biggest spikes/drops (block deals, stake
   sales, etc.), fact-checked.
7. **Most traded on m.Stock** — format the user-uploaded data into the
   2-column table (Delivery | Pay Later (MTF), five stocks each, as
   published). If the upload splits most bought vs most sold, confirm
   with the user which list to print. Keep the standard disclaimer note.
8. **FIIs vs DIIs** — two tables (last week, year-to-date): cash
   (provisional) + index futures + stock futures + index options + stock
   options, for FIIs and DIIs, in ₹ crore. Add the data-cutoff note
   (e.g. "FII F&O data is up to <date> and DII F&O data till <date>
   only."). Add 1–2 sentences on the week's pattern.
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
13. **Upcoming Events (next Sun → Sat)** — macro events (inflation prints,
    FX reserves, RBI, etc.) + major Nifty 50 earnings from the Trendlyne
    calendar / m.Stock events page. End with: *"You can explore our Events
    calendar feature on the home page & set alerts on your calendar!"*
14. **Intro narrative** (top of issue) — 2–4 short paragraphs on the
    week's dominant theme, written last. Conversational, slightly wry,
    numbers-anchored (see sample issue for voice).
15. **Closing narrative** — 2–3 paragraphs: what this week sets up for
    next week. Then *"Moving on to some insightful conversations"* + the
    video URL(s) and blurb(s).

## 4. Rewrite commands (verbatim style prompts)

These are the standing editorial commands. Substitute the research-window
dates; remember the output must NOT mention the dates.

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
- Check every in-body date for weekday/month consistency (the published
  29 Jun–5 Jul issue printed "Friday, 4th June" for Friday 4th July and
  "Q4FY24" for what was Q4FY25 — catch these before they ship).
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

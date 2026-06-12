# Echo — Weekly Newsletter Agent

Production system for **Echo**, the Mirae Asset m.Stock weekly markets
newsletter. Every Friday after market close, an agent session gathers the
week's data, writes and fact-checks every section, and commits a
Markdown + Word draft for human review.

## How to run (every Friday after market close)

1. Start a Claude Code session on this repo.
2. Say **"run Echo"** (the `echo` skill picks it up), and upload:
   - **Most traded on m.Stock** (Delivery + Pay Later/MTF, most bought/sold)
   - **Research Calls** (new calls + performance of earlier calls)
   - **YouTube link(s)** for the closing section
3. The agent fetches all public data, writes the narrative sections with
   web-search fact-checking, assembles the issue, and commits:
   - `drafts/<YYYY-MM-DD>/echo_draft.md` — the issue
   - `drafts/<YYYY-MM-DD>/echo_draft.docx` — Word version
   - `drafts/<YYYY-MM-DD>/verification.md` — fact-check log
4. Review the draft. Anything the agent couldn't fetch or verify is
   marked `[FILL IN: ...]` and listed in the run summary.

## Repo layout

| Path | Purpose |
|---|---|
| `.claude/skills/echo/SKILL.md` | The master runbook the agent follows |
| `templates/echo_template.md` | Exact section order, table shapes, standing notes |
| `reference/data_sources.md` | Every source URL, screener filter, and computation rule |
| `reference/` (other files) | Original command doc + sample issue for voice/format |
| `scripts/fetch_pages.py` | Downloads all source pages to `data/raw/<date>/` |
| `scripts/build_docx.py` | Converts the markdown draft to .docx |
| `drafts/` | One folder per issue |

## Environment requirements

- Python deps: `pip install -r requirements.txt`
- **Network policy:** the environment's allowlist should include
  `*.nseindia.com`, `query1.finance.yahoo.com`, `query2.finance.yahoo.com`
  (these power the low-token data scripts), plus `trendlyne.com`,
  `*.trendlyne.com`, `www.investing.com`, `*.investing.com`,
  `trade.mstock.com` as cross-check/fallback. If a source is blocked,
  the agent asks for screenshots/exports instead — the run still works,
  just with more manual input.

## Token discipline (why runs are cheap)

Scripts fetch and parse all numeric data and emit compact JSON; the
model reads only those summaries, never raw pages. Web searches are
reserved for the narrative sections and capped (~10 per run). Research
subagents are never used.

## Hard rules baked into the runbook

- No table number is ever invented or estimated — missing data becomes a
  marked placeholder.
- Every narrative claim is verified against at least two independent
  sources and logged in `verification.md`.
- Research-window dates are never mentioned in the newsletter body.
- Internal data (m.Stock most-traded, research calls) only comes from
  user uploads.

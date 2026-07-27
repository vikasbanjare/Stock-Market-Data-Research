#!/usr/bin/env python3
"""Fetch Trendlyne pages with a real headless Chromium (Playwright).

Plain HTTP requests get bot-walled (HTTP 405); a real browser with a
normal fingerprint often passes. Public pages only by default. If the
TRENDLYNE_COOKIES env var is set ("name=value; name2=value2" from the
team's own logged-in session, stored as a GitHub Actions secret — never
in chat/code), those cookies are attached so subscriber screeners load.

Usage:
    python3 scripts/fetch_trendlyne_browser.py [--date YYYY-MM-DD]
Writes data/raw/<date>/trendlyne_browser.json with extracted tables.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from fetch_extras import TRENDLYNE_PAGES, extract_tables  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.date.today().isoformat())
    args = parser.parse_args()
    run_date = dt.date.fromisoformat(args.date)
    out_dir = REPO_ROOT / "data" / "raw" / run_date.isoformat()
    out_dir.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    report = {"run_date": run_date.isoformat(), "method": "playwright-chromium",
              "pages": {}, "errors": []}

    cookies = []
    raw = os.environ.get("TRENDLYNE_COOKIES", "").strip()
    for part in raw.split(";"):
        if "=" in part:
            name, _, value = part.strip().partition("=")
            cookies.append({"name": name, "value": value,
                            "domain": ".trendlyne.com", "path": "/"})

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/126.0.0.0 Safari/537.36"),
            viewport={"width": 1440, "height": 900},
            locale="en-IN",
        )
        if cookies:
            context.add_cookies(cookies)
            report["logged_in_cookies"] = len(cookies)
        page = context.new_page()
        for name, url in TRENDLYNE_PAGES.items():
            try:
                page.goto(url, timeout=45000, wait_until="domcontentloaded")
                page.wait_for_timeout(4000)  # let tables render / JS settle
                title = page.title()
                if re.search(r"just a moment|attention required|access denied",
                             title, re.I):
                    report["errors"].append(f"{name}: bot challenge ({title})")
                    continue
                tables = extract_tables(page.content(), max_rows=45, max_tables=4)
                report["pages"][name] = {"title": title,
                                         "tables": tables if tables else "no tables found"}
            except Exception as exc:
                report["errors"].append(f"{name}: {type(exc).__name__}: {exc}")
        browser.close()

    (out_dir / "trendlyne_browser.json").write_text(
        json.dumps(report, indent=1), encoding="utf-8")
    ok = [k for k, v in report["pages"].items()
          if isinstance(v.get("tables"), list)]
    print(f"Pages with extracted tables: {len(ok)}/{len(TRENDLYNE_PAGES)} -> {ok}")
    for e in report["errors"]:
        print(f"  ERROR {e}")
    print(f"Saved {out_dir / 'trendlyne_browser.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Refresh data.js from Yahoo Finance monthly adjusted closes.

Run by GitHub Actions on the 3rd of each month (and manually).
No API key needed: Yahoo's v8 chart endpoint is fetched server-side,
so there is no browser CORS problem.

Rules:
- Monthly bars only. The timestamp Yahoo returns is the 1st of the
  month the bar covers, and its adjusted close is that month's end.
- The current (incomplete) calendar month is always excluded, so a
  mid-month run can never publish a partial month as if it were final.
- A month is only included when ALL 13 ETFs have a value for it.
  That keeps the common start at 2020-10 (QQQM's launch month).
- The whole file is regenerated from the fresh fetch, so a month
  missed by one run is picked up by the next.
"""
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

TICKERS = [
    "VOO", "QQQM", "VTI", "VXUS", "VT", "SCHD",
    "IWM", "XLV", "XLF", "XLE", "BND", "SGOV", "BIL",
]
PERIOD1 = 1601510400  # 2020-10-01 UTC
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data.js"

HEADERS = {"User-Agent": "Mozilla/5.0 (etf-simulator data refresh)"}


def fetch_ticker(ticker):
    period2 = int(time.time())
    url = (
        f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={PERIOD1}&period2={period2}&interval=1mo"
    )
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.load(r)
            result = payload["chart"]["result"][0]
            timestamps = result["timestamp"]
            adj = result["indicators"]["adjclose"][0]["adjclose"]
            series = {}
            for ts, value in zip(timestamps, adj):
                if value is None:
                    continue
                month = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")
                series[month] = round(float(value), 4)
            if not series:
                raise ValueError(f"no data returned for {ticker}")
            return series
        except Exception as e:  # noqa: BLE001 - retry, then fail loudly
            last_err = e
            print(f"{ticker}: attempt {attempt + 1} failed: {e}")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {ticker}: {last_err}")


def main():
    all_series = {}
    for ticker in TICKERS:
        all_series[ticker] = fetch_ticker(ticker)
        print(f"{ticker}: {len(all_series[ticker])} months, "
              f"{min(all_series[ticker])} to {max(all_series[ticker])}")
        time.sleep(1)  # be gentle with Yahoo

    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    common = set(all_series[TICKERS[0]])
    for ticker in TICKERS[1:]:
        common &= set(all_series[ticker])
    dates = sorted(m for m in common if m < current_month)
    if not dates:
        raise RuntimeError("no common months found")

    lines = []
    lines.append("// Monthly adjusted closes, Yahoo Finance v8 chart, interval=1mo.")
    lines.append(f"// {len(dates)} months: {dates[0]} to {dates[-1]}. "
                 f"The {current_month} partial month was excluded.")
    lines.append("// Values rounded to 4 decimals; return math uses these rounded values.")
    lines.append("// Updated automatically by .github/workflows/update-data.yml.")
    lines.append("window.ETF_DATA = {")
    lines.append("  META: {")
    lines.append('    source: "Yahoo Finance v8 chart, adjusted close, interval=1mo",')
    lines.append(f'    asOf: "{dates[-1]}",')
    lines.append('    note: "Month-end adjusted closes, including reinvested dividends."')
    lines.append("  },")
    lines.append("  dates: [" + ",".join(f'"{d}"' for d in dates) + "],")
    lines.append("  series: {")
    for i, ticker in enumerate(TICKERS):
        values = ", ".join(f"{all_series[ticker][d]:.4f}" for d in dates)
        comma = "," if i < len(TICKERS) - 1 else ""
        lines.append(f"    {ticker}: [{values}]{comma}")
    lines.append("  }")
    lines.append("};")
    lines.append("")

    new_text = "\n".join(lines)
    old_text = OUT.read_text() if OUT.exists() else ""
    if new_text == old_text:
        print(f"No change: data already through {dates[-1]}.")
        return
    OUT.write_text(new_text)
    print(f"Wrote {OUT}: {len(dates)} months, through {dates[-1]}.")


if __name__ == "__main__":
    main()

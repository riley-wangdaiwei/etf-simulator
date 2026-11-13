# ETF Portfolio Simulator

A simple interactive ETF portfolio simulator for learning long-term investing and seeing how different asset allocations would have performed historically.

## MVP

- Inputs: initial investment, weights for 13 ETFs (VOO, QQQM, VTI, VXUS, VT, SCHD, IWM, XLV, XLF, XLE, BND, SGOV, BIL), time range (1 year / 3 years / 5 years / all)
- Outputs:
  1. Portfolio value chart, historical cumulative return, annualized return
  2. Drawdown chart: how far the portfolio fell below its previous peak, with the worst episode's peak, trough, and recovery dates and durations
  3. Risk–return scatter plot: annualized volatility (horizontal) vs annualized return (vertical) for your portfolio, preset portfolios, and single ETFs, plus annualized volatility and volatility reduction vs 100% VOO
- Method: monthly rebalancing; each month's portfolio return is the weighted average of the ETFs' monthly returns. Annualized volatility is the sample standard deviation of monthly returns multiplied by √12. Volatility reduction = (σ_VOO − σ_portfolio) / σ_VOO × 100%.

## Design

Black background, white text, left-aligned, following the habit of past pages (Vibe & Verify): simple and light, no colorful decoration.

## Polymarket Outlook

A small panel below the backtest that reads live Polymarket data (public Gamma API, no key, no trading). Each of the 13 ETFs shows its best-matching contract — S&P 500 year-end close bands for VOO/VTI, Nasdaq-100 bands for QQQM, WTI touch thresholds for XLE, and the Fed rate-cut market for BND/SGOV/BIL — or states `No reliable Polymarket proxy found`. Mapping code and notes live in `polymarket.js`; prices are fetched live in the browser on every load and on Refresh — no cache, nothing stored locally. Index markets are shown as a band distribution, not a single YES number. Below the table, the forward-looking portfolio projection reuses the backtest's three chart components (same layout, axes, colors, labels, tooltips in app.js) and projects 12 months ahead. Method, documented in polymarket.js: (1) market-implied anchor — the S&P 500 Dec-2026 close bands give a market-implied distribution over ~2 months (renormalized; band midpoints assumed); (2) monthly market (model) — monthly mean = implied mean / 2, monthly vol = implied vol / sqrt(2); months 1–2 draw one band return split across the two months, months 3–12 draw from a normal with the same monthly mean and vol; the market prices only Dec 31, so the monthly shape and everything past Dec 31 are model assumptions; (3) ETFs (model) — CAPM-style beta from 72 months of returns, no historical alpha, residuals bootstrapped whole months from history so correlations are kept. Growth starts at the actual current portfolio value (the backtest's final value) and shows the median path with a 10th–90th percentile band; drawdown uses the exact historical formula (value / running peak − 1) per path, then the median; the scatter shows projected annualized return vs volatility per ETF and for the portfolio, same design as historical. Labels: VOO Direct; other ETFs Proxy (historical correlation with VOO >= 0.70) or Provisional (< 0.70); SGOV/BIL Rate-based (T-bill yield). QQQM uses the S&P beta proxy because its Nasdaq-100 bands are effectively untraded and their prices are incoherent. Known limits (verified 2026-11-12): Gamma search endpoints ignore the query, so discovery uses `/public-search`; Nasdaq-100 bands are effectively untraded and their prices sum to ~317%, so no live price is shown for QQQM; CLOB /book and /midpoint returned errors for valid tokens, so bid/ask is not shown and prices are Gamma outcomePrices. No correlation is claimed — the contracts are too new for the 60-observation threshold, so proxies are Provisional at most.

## Data note

The common starting point for all ETFs is October 2020 (QQQM launched in October 2020, SGOV in May 2020), so “All” covers about 6 years.
Data is in `data.js`: month-end adjusted closes. Past performance does not predict future results; taxes, trading costs, and inflation are not included.

## Updating the data

`data.js` is refreshed manually via GitHub Actions (`.github/workflows/update-data.yml`): run it from the repo's Actions tab (Run workflow) whenever you want fresh data. It runs `scripts/update_data.py`, which fetches the 13 ETFs' monthly adjusted closes from Yahoo Finance (server-side, no API key, no browser CORS issue), regenerates `data.js`, and commits it if anything changed. There is no scheduled run. The current (incomplete) month is always excluded, and a month is only included when all 13 ETFs have a value for it.

## Open locally

Open `index.html` in a browser. No server needed.

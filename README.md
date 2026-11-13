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

A small panel below the backtest that reads live Polymarket data (public Gamma API, no key, no trading). Each of the 13 ETFs shows its best-matching contract — S&P 500 year-end close bands for VOO/VTI, Nasdaq-100 bands for QQQM, WTI touch thresholds for XLE, and the Fed rate-cut market for BND/SGOV/BIL — or states `No reliable Polymarket proxy found`. Mapping code and notes live in `polymarket.js`; prices are fetched live in the browser on every load and on Refresh — no cache, nothing stored locally. Index markets are shown as a band distribution, not a single YES number. Below the table, prediction charts mirror the backtest's three views: growth (implied probability over time, from CLOB daily price history), drawdown (probability below its peak, in percentage points), and a scatter of each live prediction market (probability volatility vs current probability). Series: S&P 500 closing at $7,000+ (VOO/VTI), WTI hitting $100 high (XLE), Fed cut by the Dec 2026 meeting (BND/SGOV/BIL); QQQM has no chart because its Nasdaq bands have no trading history. Known limits (verified 2026-11-12): Gamma search endpoints ignore the query, so discovery uses `/public-search`; Nasdaq-100 bands are effectively untraded and their prices sum to ~317%, so no live price is shown for QQQM; CLOB /book and /midpoint returned errors for valid tokens, so bid/ask is not shown and prices are Gamma outcomePrices. No correlation is claimed — the contracts are too new for the 60-observation threshold, so proxies are Provisional at most.

## Data note

The common starting point for all ETFs is October 2020 (QQQM launched in October 2020, SGOV in May 2020), so “All” covers about 6 years.
Data is in `data.js`: month-end adjusted closes. Past performance does not predict future results; taxes, trading costs, and inflation are not included.

## Updating the data

`data.js` is refreshed manually via GitHub Actions (`.github/workflows/update-data.yml`): run it from the repo's Actions tab (Run workflow) whenever you want fresh data. It runs `scripts/update_data.py`, which fetches the 13 ETFs' monthly adjusted closes from Yahoo Finance (server-side, no API key, no browser CORS issue), regenerates `data.js`, and commits it if anything changed. There is no scheduled run. The current (incomplete) month is always excluded, and a month is only included when all 13 ETFs have a value for it.

## Open locally

Open `index.html` in a browser. No server needed.

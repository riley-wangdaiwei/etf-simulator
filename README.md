# ETF Portfolio Simulator

A simple interactive ETF portfolio simulator for learning long-term investing and seeing how different asset allocations would have performed historically.

## MVP

- Inputs: initial investment, weights for 13 ETFs (VOO, QQQM, VTI, VXUS, VT, SCHD, IWM, XLV, XLF, XLE, BND, SGOV, BIL), time range (1 year / 3 years / 5 years / all)
- Outputs:
  1. Portfolio value chart, historical cumulative return, annualized return
  2. Drawdown chart: how far the portfolio fell below its previous peak, with the worst episode's peak, trough, and recovery dates and durations
  3. Risk–return scatter plot: annualized volatility (horizontal) vs annualized return (vertical) for your portfolio, preset portfolios, and single ETFs, plus annualized volatility and volatility reduction vs 100% VOO
- Geopolitical Stress Test: seven hypothetical one-period scenarios (Middle East Escalation, Middle East De-escalation, Russia–Ukraine Energy Shock, Taiwan Strait Tensions, US–China Trade Restrictions, US Fiscal Gridlock, Global Geopolitical Crisis), each with assumed ETF returns for VOO, QQQM, VXUS, XLV, BND, XLE, SGOV in `scenarios.js`. Results are calculated live from your current portfolio weights — portfolio scenario return = sum of (weight × assumed return) — with a summary table, seven contribution bar charts (3 per row, the 7th full width), and an editor to change assumptions or reset them. Holdings with no scenario assumption are listed as “Scenario assumption unavailable” and are never counted as zero. The scenarios are synthetic assumptions, not historical data or forecasts; the backtest above still uses only real market data.
- Method: monthly rebalancing; each month's portfolio return is the weighted average of the ETFs' monthly returns. Annualized volatility is the sample standard deviation of monthly returns multiplied by √12. Volatility reduction = (σ_VOO − σ_portfolio) / σ_VOO × 100%.

## Design

Black background, white text, left-aligned, following the habit of past pages (Vibe & Verify): simple and light, no colorful decoration.

## Data note

The common starting point for all ETFs is October 2020 (QQQM launched in October 2020, SGOV in May 2020), so “All” covers about 6 years.
Data is in `data.js`: month-end adjusted closes. Past performance does not predict future results; taxes, trading costs, and inflation are not included.

## Updating the data

`data.js` is refreshed manually via GitHub Actions (`.github/workflows/update-data.yml`): run it from the repo's Actions tab (Run workflow) whenever you want fresh data. It runs `scripts/update_data.py`, which fetches the 13 ETFs' monthly adjusted closes from Yahoo Finance (server-side, no API key, no browser CORS issue), regenerates `data.js`, and commits it if anything changed. There is no scheduled run. The current (incomplete) month is always excluded, and a month is only included when all 13 ETFs have a value for it.

## Open locally

Open `index.html` in a browser. No server needed.

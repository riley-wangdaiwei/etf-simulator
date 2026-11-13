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

## Institutional Forecast Analyzer

Replaced the Polymarket Outlook panel on 2026-11-13. The forward-looking section now runs only on published institutional research supplied as four CSV files (see `institutional_forecast_agent_instructions.md` for the source spec):

- `asset_forecasts.csv` — expected returns, volatility, asset classes, forecast horizons.
- `tactical_views.csv` — short-term views (Overweight / Neutral / Underweight).
- `scenario_assumptions.csv` — macro scenarios and expected market impacts.
- `source_register.csv` — report sources, publication dates, URLs, verification status.

The analyzer (code in `institutional.js`) has three views: (1) Institutional Asset Outlook — a risk–return scatter, one point per institution × asset class × horizon, plotted only when both a return and a volatility are supplied, with a return-only list and a separate qualitative-views table; (2) Portfolio Risk–Return Comparison — expected return for the current weights and each preset, per institution, with covered-weight disclosure and the range across institutions (a range, not a confidence interval); portfolio volatility is “not available” unless a compatible covariance matrix is supplied, with an optional, clearly labelled historical covariance proxy (72 months, 2020-10–2026-10); (3) Scenario Stress Test — a qualitative exposure matrix from published scenario commentary, numeric impact only when the institution publishes one.

Rules enforced in code: blank means “not supplied”, never zero; forecasts are grouped by horizon, currency, return definition, and gross/net before any comparison; incompatible forecasts are never averaged; sector ETFs fall back to broad US equity only as a labelled proxy; the four files are imported one at a time, each previewed (counts, rejections, conflicts, and the exact replace-diff) before import, and importing one file never touches the other three. The site loads the four files from the repo root when present; until they exist it shows an honest empty state and the next documents needed. Uploads in the browser are a preview on that device only.

The old Polymarket code (`polymarket.js`, live Gamma API, 12-month Monte Carlo projection) was removed with the panel; the historical backtest and the Crisis Scenario Analysis backup are untouched. A record of the removed forecast method lives in the local-only `FUTURE_CALCULATIONS.md` (not in the repo).

## Data note

The common starting point for all ETFs is October 2020 (QQQM launched in October 2020, SGOV in May 2020), so “All” covers about 6 years.
Data is in `data.js`: month-end adjusted closes. Past performance does not predict future results; taxes, trading costs, and inflation are not included.

## Updating the data

`data.js` is refreshed manually via GitHub Actions (`.github/workflows/update-data.yml`): run it from the repo's Actions tab (Run workflow) whenever you want fresh data. It runs `scripts/update_data.py`, which fetches the 13 ETFs' monthly adjusted closes from Yahoo Finance (server-side, no API key, no browser CORS issue), regenerates `data.js`, and commits it if anything changed. There is no scheduled run. The current (incomplete) month is always excluded, and a month is only included when all 13 ETFs have a value for it.

## Open locally

Open `index.html` in a browser. No server needed.

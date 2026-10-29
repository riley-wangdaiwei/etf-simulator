# ETF Portfolio Simulator

A simple interactive ETF portfolio simulator for learning long-term investing and seeing how different asset allocations would have performed historically.

## MVP

- Inputs: initial investment, weights for VOO / QQQM / VXUS / BND / SGOV, time range (1 year / 3 years / 5 years / all)
- Outputs: portfolio value chart, historical cumulative return, annualized return, plus each ETF's cumulative return over the same period
- Method: monthly rebalancing; each month's portfolio return is the weighted average of the ETFs' monthly returns

## Design

Black background, white text, left-aligned, following the habit of past pages (Vibe & Verify): simple and light, no colorful decoration.

## Data note

The common starting point for all five ETFs is October 2020 (QQQM launched in October 2020, SGOV in May 2020), so “All” covers about 6 years.
Data is in `data.js`: month-end adjusted closes. Past performance does not predict future results; taxes, trading costs, and inflation are not included.

## Open locally

Open `index.html` in a browser. No server needed.

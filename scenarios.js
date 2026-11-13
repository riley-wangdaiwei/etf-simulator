// Geopolitical Stress Test — synthetic scenario data.
//
// These are manually specified HYPOTHETICAL assumptions, not historical
// returns, not forecasts, and not claims about what any ETF will do.
// Each value is an assumed one-period percentage return for that ETF
// under the scenario. They live here, locally, so the feature works
// with no external API request. The real historical data in data.js
// is untouched and is still what the backtest above uses.
window.SCENARIO_ETFS = ["VOO", "QQQM", "VXUS", "XLV", "BND", "XLE", "SGOV"];

window.SCENARIO_DEFAULTS = [
  {
    id: "middle_east_escalation",
    name: "Middle East Escalation",
    description: "Oil supply disruption, restricted shipping, rising energy prices and inflation pressure.",
    returns: { VOO: -8, QQQM: -12, VXUS: -9, XLV: -3, BND: -5, XLE: 15, SGOV: 0.5 }
  },
  {
    id: "middle_east_deescalation",
    name: "Middle East De-escalation",
    description: "Shipping normalizes, energy supply recovers and oil prices decline.",
    returns: { VOO: 5, QQQM: 8, VXUS: 5, XLV: 3, BND: 3, XLE: -10, SGOV: 0.5 }
  },
  {
    id: "russia_ukraine_energy",
    name: "Russia–Ukraine Energy Shock",
    description: "Energy infrastructure attacks, European energy supply disruption and weaker international market sentiment.",
    returns: { VOO: -6, QQQM: -7, VXUS: -12, XLV: -2, BND: -3, XLE: 12, SGOV: 0.5 }
  },
  {
    id: "taiwan_strait",
    name: "Taiwan Strait Tensions",
    description: "Rising geopolitical risk, shipping uncertainty and semiconductor supply-chain disruption.",
    returns: { VOO: -10, QQQM: -18, VXUS: -9, XLV: -2, BND: 2, XLE: 2, SGOV: 0.5 }
  },
  {
    id: "us_china_trade",
    name: "US–China Trade Restrictions",
    description: "Tariffs, semiconductor export controls and critical-material supply-chain restrictions.",
    returns: { VOO: -7, QQQM: -12, VXUS: -10, XLV: -2, BND: 1, XLE: 3, SGOV: 0.5 }
  },
  {
    id: "us_fiscal_gridlock",
    name: "US Fiscal Gridlock",
    description: "Debt-ceiling uncertainty, political disagreement, Treasury market volatility and changing yields.",
    returns: { VOO: -8, QQQM: -9, VXUS: -5, XLV: -4, BND: -6, XLE: -2, SGOV: 0.2 }
  },
  {
    id: "global_crisis",
    name: "Global Geopolitical Crisis",
    description: "Simultaneous energy disruption, trade restrictions, regional conflicts and global economic slowdown.",
    returns: { VOO: -18, QQQM: -25, VXUS: -20, XLV: -8, BND: -7, XLE: 8, SGOV: 1 }
  }
];

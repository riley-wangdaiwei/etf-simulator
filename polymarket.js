// Polymarket Outlook — live market-implied probabilities from Polymarket.
//
// Reads the public read-only Gamma API directly from the browser
// (Access-Control-Allow-Origin: *, verified 2026-11-12), so no proxy,
// key, or backend is needed. No trading, no wallet, no credentials.
//
// What is shown, and what is not:
// - The table shows live Polymarket prices: market-implied
//   probabilities, NOT objective probabilities and NOT forecasts of
//   ETF returns. The backtest above still uses only real Yahoo market
//   data from data.js.
// - Index-band markets (S&P 500, Nasdaq-100) are shown as a band
//   distribution, not a single YES number, because there is no single
//   YES market for "the index will be up".
// - Mapping labels: Direct / Index reference / Provisional /
//   No reliable proxy found. Nothing is labelled a confirmed
//   correlation: the relevant contracts are weeks old, far below the
//   60-observation threshold in the spec, so every proxy here is
//   Provisional at most.
// - The three charts below the table are a forward-looking portfolio
//   projection to Dec 31, 2026 only — the only horizon Polymarket
//   prices. The S&P 500 band distribution is Direct (market-implied);
//   every ETF is a Proxy (beta-mapped, CAPM-style, no historical
//   alpha; residual correlations kept by bootstrapping whole months).
//   Nothing is projected past Dec 31: no market prices a longer
//   horizon, and inventing one would be fabrication.
//
// Known limits, found while testing 2026-11-12:
// - Gamma /markets?search= and /events?search= ignore the query;
//   discovery uses /public-search, detail uses /events?slug=.
// - Gamma /markets is deprecated (sunset May 2026) but still answers.
// - Bid/ask is not shown: CLOB /book and /midpoint returned
//   {"error":"Invalid token id"} for valid tokens in testing, so
//   prices are Gamma outcomePrices with volume and liquidity shown.
// - Nasdaq-100 Dec bands are effectively untraded (about $0 volume)
//   and their YES prices sum to ~317%, which is incoherent for
//   mutually exclusive bands, so no live price is shown for QQQM,
//   and QQQM's projection uses the S&P beta proxy like the other
//   equities.
(function () {
  'use strict';

  var GAMMA = 'https://gamma-api.polymarket.com';
  // No cache, by her call: every page load and every Refresh fetches
  // live data. Nothing is stored in localStorage.

  // ETF -> Polymarket event mapping, verified by hand 2026-11-12 via
  // Gamma /public-search + /events?slug=. Event slugs are stable
  // identifiers; prices are always fetched live, never hardcoded.
  var MAPPINGS = [
    { etf: 'VOO', kind: 'Index reference', mode: 'bands', slug: 'spx-close-dec-2026',
      note: 'S&P 500 year-end close bands. The index is VOO’s benchmark, not VOO itself.' },
    { etf: 'QQQM', kind: 'Index reference', mode: 'bands', slug: 'ndx-close-dec-2026', provisional: true,
      note: 'Nasdaq-100 year-end close bands. Effectively untraded: about $0 volume and band prices sum to ~317%, so no meaningful live price.' },
    { etf: 'VTI', kind: 'Index reference', mode: 'bands', slug: 'spx-close-dec-2026',
      note: 'S&P 500 bands as a partial reference only: VTI tracks the full US market, and VTI vs VOO monthly-return correlation is 0.995 over 72 months (data.js).' },
    { etf: 'VXUS', kind: 'No reliable proxy found', mode: 'none',
      note: 'No Polymarket contract for total international ex-US equities was found.' },
    { etf: 'VT', kind: 'No reliable proxy found', mode: 'none',
      note: 'No world-index contract was found; VT blends US and international markets.' },
    { etf: 'SCHD', kind: 'No reliable proxy found', mode: 'none',
      note: 'No dividend-equity contract was found.' },
    { etf: 'IWM', kind: 'No reliable proxy found', mode: 'none',
      note: 'Only daily Russell 2000 up/down markets exist — too short a horizon for an outlook.' },
    { etf: 'XLV', kind: 'No reliable proxy found', mode: 'none',
      note: 'No healthcare-sector contract was found.' },
    { etf: 'XLF', kind: 'No reliable proxy found', mode: 'none',
      note: 'No financial-sector contract was found.' },
    { etf: 'XLE', kind: 'Provisional', mode: 'thresholds', slug: 'what-price-will-wti-hit-in-november-2026',
      note: 'WTI crude-oil touch thresholds for November. An oil-price proxy, not an XLE price prediction.' },
    { etf: 'BND', kind: 'Provisional', mode: 'fed', slug: 'fed-rate-cut-by-629',
      note: 'Fed rate-cut market. A rates factor proxy, not a bond-price prediction.' },
    { etf: 'SGOV', kind: 'Provisional', mode: 'fed', slug: 'fed-rate-cut-by-629',
      note: 'Fed rate-cut market. A rates factor proxy for 0–3 month Treasuries, not a price prediction.' },
    { etf: 'BIL', kind: 'Provisional', mode: 'fed', slug: 'fed-rate-cut-by-629',
      note: 'Fed rate-cut market. A rates factor proxy for 1–3 month T-Bills, not a price prediction.' }
  ];

  function yesPrice(market) {
    try {
      var p = JSON.parse(market.outcomePrices || '[]');
      var v = parseFloat(p[0]);
      return isNaN(v) ? null : v;
    } catch (e) { return null; }
  }
  function num(x) { var v = parseFloat(x || 0); return isNaN(v) ? 0 : v; }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function money(x) {
    return '$' + Math.round(x).toLocaleString('en-US');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Bands: mutually exclusive close ranges. Returns null when the
  // prices do not cohere (e.g. Nasdaq bands summing to ~317%).
  function summarizeBands(markets) {
    var bands = markets.map(function (m) {
      var match = (m.question || '').match(/close at (.+?) in December\?/);
      return {
        label: match ? match[1] : (m.question || ''),
        yes: yesPrice(m), volume: num(m.volume), liquidity: num(m.liquidity),
        slug: m.slug, endDate: m.endDate
      };
    }).filter(function (b) { return b.yes !== null; });
    if (!bands.length) return null;
    var sum = bands.reduce(function (a, b) { return a + b.yes; }, 0);
    var totalVol = bands.reduce(function (a, b) { return a + b.volume; }, 0);
    var minLiq = Math.min.apply(null, bands.map(function (b) { return b.liquidity; }));
    var sorted = bands.slice().sort(function (a, b) { return b.yes - a.yes; });
    return {
      bands: sorted, sum: sum, coherent: sum >= 0.8 && sum <= 1.2,
      totalVolume: totalVol, minLiquidity: minLiq,
      modal: sorted[0],
      endDate: bands.map(function (b) { return b.endDate; }).sort().pop()
    };
  }

  // Thresholds (WTI "hit $X high/low"): dedupe by question, keep the
  // highest-volume copy, drop dead markets with no liquidity.
  function summarizeThresholds(markets) {
    var byQ = {};
    markets.forEach(function (m) {
      var yes = yesPrice(m);
      if (yes === null || num(m.liquidity) <= 0) return;
      var key = m.question || '';
      if (!byQ[key] || num(m.volume) > num(byQ[key].volume)) byQ[key] = m;
    });
    var list = Object.keys(byQ).map(function (k) {
      var m = byQ[k];
      var hm = (m.question || '').match(/hit \(HIGH\) \$(\d+)/);
      var lm = (m.question || '').match(/hit \(LOW\) \$(\d+)/);
      return {
        label: hm ? 'WTI hits $' + hm[1] + ' high' : (lm ? 'WTI hits $' + lm[1] + ' low' : (m.question || '')),
        yes: yesPrice(m), volume: num(m.volume), liquidity: num(m.liquidity),
        slug: m.slug, endDate: m.endDate
      };
    });
    if (!list.length) return null;
    // Show the thresholds closest to even odds (nearest the money),
    // not the highest-volume tail bets: volume alone would surface
    // $150/$160 strikes that almost nobody thinks will hit.
    var nearMoney = list.slice().sort(function (a, b) {
      return Math.abs(a.yes - 0.5) - Math.abs(b.yes - 0.5);
    }).slice(0, 3).sort(function (a, b) {
      var pa = parseInt((a.label.match(/\$(\d+)/) || [])[1] || 0, 10);
      var pb = parseInt((b.label.match(/\$(\d+)/) || [])[1] || 0, 10);
      return pa - pb;
    });
    return {
      top: nearMoney, totalVolume: list.reduce(function (a, b) { return a + b.volume; }, 0),
      minLiquidity: Math.min.apply(null, list.map(function (b) { return b.liquidity; })),
      endDate: list.map(function (b) { return b.endDate; }).sort().pop()
    };
  }

  // Fed: nearest future meeting market with trading volume. endDate
  // alone cannot pick it: resolved meetings keep a future endDate
  // (e.g. the October 2026 meeting, YES 0%, endDate 2027-01-29),
  // so the meeting month is parsed from the question instead.
  var MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  function summarizeFed(markets) {
    var now = new Date();
    var live = markets.map(function (m) {
      var match = (m.question || '').match(/by (\w+) (\d{4}) meeting/);
      var when = null;
      if (match && MONTHS[match[1].toLowerCase()] !== undefined) {
        when = new Date(parseInt(match[2], 10), MONTHS[match[1].toLowerCase()], 1);
      }
      return { m: m, yes: yesPrice(m), volume: num(m.volume), liquidity: num(m.liquidity), when: when };
    }).filter(function (x) {
      return x.yes !== null && x.volume > 0 && x.when && x.when >= new Date(now.getFullYear(), now.getMonth(), 1);
    }).sort(function (a, b) { return a.when - b.when; });
    if (!live.length) return null;
    var x = live[0];
    return {
      question: x.m.question, yes: x.yes, volume: x.volume, liquidity: x.liquidity,
      slug: x.m.slug, endDate: x.m.endDate
    };
  }

  function eventUrl(slug) { return 'https://polymarket.com/event/' + slug; }

  function fetchEvent(slug) {
    return fetch(GAMMA + '/events?slug=' + encodeURIComponent(slug))
      .then(function (r) { if (!r.ok) throw new Error('Gamma ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.length || !d[0].markets) throw new Error('event not found: ' + slug);
        return d[0];
      });
  }

  function setStatus(text) {
    var el = document.getElementById('polyStatus');
    if (el) el.textContent = text;
  }

  function render(events, fetchedAt) {
    var tbody = document.querySelector('#polyTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    var updated = new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('polyUpdated').textContent = 'Last updated: ' + updated + '. ';
    MAPPINGS.forEach(function (map) {
      var tr = document.createElement('tr');
      if (map.mode === 'none') {
        tr.innerHTML = '<td><strong>' + map.etf + '</strong></td>' +
          '<td colspan="2"><span class="poly-none">No reliable Polymarket proxy found</span><br>' +
          '<span class="note">' + esc(map.note) + '</span></td>' +
          '<td>—</td><td>' + map.kind + '</td><td>—</td>';
        tbody.appendChild(tr);
        return;
      }
      var ev = events[map.slug];
      if (!ev) {
        tr.innerHTML = '<td><strong>' + map.etf + '</strong></td>' +
          '<td colspan="2">Market data unavailable — the Polymarket request failed or the event was not found.</td>' +
          '<td>—</td><td>' + map.kind + '</td>' +
          '<td><a href="' + eventUrl(map.slug) + '" target="_blank" rel="noopener">Polymarket</a></td>';
        tbody.appendChild(tr);
        return;
      }
      var expiry = (ev.markets || []).map(function (m) { return m.endDate || ''; }).sort().pop() || '';
      expiry = expiry ? expiry.slice(0, 10) : '—';
      var link = '<a href="' + eventUrl(map.slug) + '" target="_blank" rel="noopener">Polymarket</a>';
      var marketCell = '<strong>' + esc(ev.title || '') + '</strong><br><span class="note">' + esc(map.note) + '</span>';
      if (map.mode === 'bands') {
        var s = summarizeBands(ev.markets || []);
        if (!s) {
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td><td>No live price.</td><td>' + expiry + '</td><td>' + map.kind + '</td><td>' + link + '</td>';
        } else if (!s.coherent || s.totalVolume < 1000) {
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td>' +
            '<td><span class="poly-flag">No meaningful live price</span><br><span class="note">Band probabilities sum to ' + pct(s.sum) +
            ' (should be ~100%) with total volume ' + money(s.totalVolume) + ' — effectively no trading, so these prices are stale, not a market view.</span></td>' +
            '<td>' + expiry + '</td><td>' + map.kind + (map.provisional ? ' · Provisional' : '') + '</td><td>' + link + '</td>';
        } else {
          var dist = s.bands.map(function (b) { return b.label + ' ' + pct(b.yes); }).join(' · ');
          var liqFlag = s.minLiquidity < 1000
            ? '<br><span class="poly-flag">Low liquidity — thinnest band ' + money(s.minLiquidity) + '.</span>' : '';
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td>' +
            '<td>Most likely: <strong>' + esc(s.modal.label) + ' · ' + pct(s.modal.yes) + '</strong>' +
            '<br><span class="note">' + esc(dist) + '</span>' + liqFlag + '</td>' +
            '<td>' + expiry + '</td><td>' + map.kind + (map.provisional ? ' · Provisional' : '') + '</td><td>' + link + '</td>';
        }
      } else if (map.mode === 'thresholds') {
        var t = summarizeThresholds(ev.markets || []);
        if (!t) {
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td><td>No live price.</td><td>' + expiry + '</td><td>' + map.kind + '</td><td>' + link + '</td>';
        } else {
          var tops = t.top.map(function (x) { return esc(x.label) + ': <strong>' + pct(x.yes) + '</strong>'; }).join('<br>');
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td><td>' + tops +
            '<br><span class="note">Total volume ' + money(t.totalVolume) + '.</span></td>' +
            '<td>' + expiry + '</td><td>' + map.kind + '</td><td>' + link + '</td>';
        }
      } else if (map.mode === 'fed') {
        var f = summarizeFed(ev.markets || []);
        if (!f) {
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td><td>No live price.</td><td>' + expiry + '</td><td>' + map.kind + '</td><td>' + link + '</td>';
        } else {
          tr.innerHTML = '<td><strong>' + map.etf + '</strong></td><td>' + marketCell + '</td>' +
            '<td>' + esc(f.question) + ': <strong>' + pct(f.yes) + '</strong>' +
            '<br><span class="note">Volume ' + money(f.volume) + ', liquidity ' + money(f.liquidity) + '.</span></td>' +
            '<td>' + (f.endDate || '').slice(0, 10) + '</td><td>' + map.kind + '</td><td>' + link + '</td>';
        }
      }
      tbody.appendChild(tr);
    });
  }

  function refresh() {
    setStatus('Loading live Polymarket data…');
    var slugs = [];
    MAPPINGS.forEach(function (m) { if (m.slug && slugs.indexOf(m.slug) === -1) slugs.push(m.slug); });
    Promise.all(slugs.map(function (slug) {
      return fetchEvent(slug).then(function (ev) { return [slug, ev]; })
        .catch(function () { return [slug, null]; });
    })).then(function (pairs) {
      var events = {};
      pairs.forEach(function (p) { events[p[0]] = p[1]; });
      var ok = pairs.filter(function (p) { return p[1]; }).length;
      render(events, Date.now());
      setStatus(ok === slugs.length
        ? 'Live data from Polymarket Gamma API.'
        : 'Some markets failed to load (' + ok + '/' + slugs.length + ' events). Rows show what is available; try Refresh.');
      buildProjection(events);
    }).catch(function () {
      setStatus('Live request failed. Try Refresh.');
    });
  }
  // ---- Forward-looking portfolio projection: 12 months ----
  //
  // The three charts below the table reuse the historical chart
  // components (drawLineChart / drawScatterChart in app.js): same
  // layout, axes, colors, labels, and tooltips. Only the data and the
  // calculations change — except the growth chart, which adds one
  // element the historical chart does not have: a p10–p90 band.
  //
  // Documented modeling method (also stated on the page):
  //   1. Market-implied anchor (real Polymarket data): the S&P 500
  //      Dec-31, 2026 close bands give a market-implied distribution
  //      for the index over ~2 months (Oct 31 -> Dec 31): mean E and
  //      standard deviation SD. Band probabilities are renormalized;
  //      band midpoints are assumed (open-ended bands $400 wide).
  //      Base S&P level = VOO's Oct-2026 close x 10.909 (SPX/VOO
  //      closes on 2026-10-30). No market prices beyond Dec 31.
  //   2. Monthly market (model): monthly mean mu = E/2 and monthly
  //      vol sigma = SD/sqrt(2). Months 1–2 of each path draw one
  //      band return and split it across the two months (with noise
  //      chosen so each month keeps vol sigma); months 3–12 draw
  //      from a normal with the same monthly mean and vol. The
  //      monthly shape and everything past Dec 31 are MODEL
  //      assumptions, not market data — the market prices only the
  //      2-month distribution, and this extension assumes its mean
  //      and vol persist.
  //   3. ETFs (model): CAPM-style, monthly r_i = r_f + beta_i *
  //      (r_M - r_f) + eps_i, beta_i from 72 months of returns in
  //      data.js, r_f the T-bill rate (SGOV mean monthly return).
  //      No historical alpha is assumed. eps_i is bootstrapped as a
  //      whole historical month's residual vector (demeaned per ETF),
  //      so the correlations between ETFs are kept.
  //   4. Paths: 4,000 simulated 12-month paths, starting at the
  //      actual current portfolio value (the backtest's final value).
  //      Growth shows the median path with a p10–p90 band.
  //      Drawdown uses the exact historical formula,
  //      Value / running peak - 1, computed separately for each
  //      path, then the median across paths. The scatter shows
  //      projected annualized return vs volatility per ETF and for
  //      the portfolio (same axes and point styles as historical).
  //   5. Labels: VOO is Direct (the S&P distribution is its market).
  //      Other ETFs are Proxy when their historical correlation with
  //      VOO is >= 0.70, Provisional below that. SGOV/BIL are
  //      Rate-based: their return comes from the T-bill rate, not
  //      the S&P market. QQQM uses the S&P beta proxy because its
  //      Nasdaq-100 bands are untradable (prices sum to ~317%).
  var SPX_VOO_RATIO = 10.909; // SPX / VOO closes, 2026-10-30
  var BAND_MIDS = { '<$6,000': 5800, '$6,000-$6,500': 6250, '$6,500-$7,000': 6750, '$7,000-$7,500': 7250, '$7,500-$8,000': 7750, '>$8,000': 8250 };
  var N_SIMS = 4000;
  var N_MONTHS = 12;
  var projState = null; // { events, fm, spx } — kept in memory only, no storage
  var lastRes = null;

  function mean(xs) { return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length; }
  function variance(xs) {
    var m = mean(xs);
    return xs.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (xs.length - 1);
  }
  function quantile(sorted, q) {
    var i = (sorted.length - 1) * q;
    var lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  var _randnSpare = null;
  function randn() {
    if (_randnSpare !== null) { var v = _randnSpare; _randnSpare = null; return v; }
    var u = 0, w = 0;
    while (u === 0) u = Math.random();
    while (w === 0) w = Math.random();
    var r = Math.sqrt(-2 * Math.log(u)), t = 2 * Math.PI * w;
    _randnSpare = r * Math.sin(t);
    return r * Math.cos(t);
  }

  function factorModel() {
    var D = window.ETF_DATA;
    var S = D && (D.series || D);
    if (!S || !S.VOO) return null;
    var syms = Object.keys(S).filter(function (k) { return k !== 'META' && k !== 'dates'; });
    var R = {};
    syms.forEach(function (s) {
      var p = S[s];
      R[s] = [];
      for (var i = 1; i < p.length; i++) R[s].push(p[i] / p[i - 1] - 1);
    });
    var rv = R.VOO, mv = mean(rv);
    var den = rv.reduce(function (a, x) { return a + (x - mv) * (x - mv); }, 0);
    var sdV = Math.sqrt(den / (rv.length - 1));
    var beta = {}, resid = {}, residVar = {}, corr = {};
    syms.forEach(function (s) {
      var rk = R[s], mk = mean(rk);
      var b = rk.reduce(function (a, v, i) { return a + (rv[i] - mv) * (v - mk); }, 0) / den;
      beta[s] = b;
      var e = rk.map(function (v, i) { return v - b * rv[i]; });
      var me = mean(e);
      resid[s] = e.map(function (v) { return v - me; });
      residVar[s] = variance(resid[s]);
      var sdS = Math.sqrt(variance(rk));
      corr[s] = rk.reduce(function (a, v, i) { return a + (rv[i] - mv) * (v - mk); }, 0) / ((rk.length - 1) * sdV * sdS);
    });
    return {
      syms: syms, beta: beta, resid: resid, residVar: residVar, corr: corr,
      rfMonthly: mean(R.SGOV), nMonths: rv.length,
      lastVOO: S.VOO[S.VOO.length - 1]
    };
  }

  function impliedSpx(events, fm) {
    var ev = events['spx-close-dec-2026'];
    if (!ev) return null;
    var s = summarizeBands(ev.markets || []);
    if (!s || !s.coherent) return null;
    var bands = s.bands.map(function (b) {
      return { label: b.label, p: b.yes / s.sum, mid: BAND_MIDS[b.label] };
    }).filter(function (b) { return b.mid !== undefined; });
    if (bands.length < 3) return null;
    var base = fm.lastVOO * SPX_VOO_RATIO;
    var rets = bands.map(function (b) { return { label: b.label, p: b.p, mid: b.mid, r: b.mid / base - 1 }; });
    var E = rets.reduce(function (a, b) { return a + b.p * b.r; }, 0);
    var SD = Math.sqrt(rets.reduce(function (a, b) { return a + b.p * (b.r - E) * (b.r - E); }, 0));
    return { bands: rets, E: E, SD: SD, base: base, probSum: s.sum };
  }

  function readWeights() {
    var w = {}, total = 0;
    document.querySelectorAll('#weights input').forEach(function (inp) {
      var v = parseFloat(inp.value) || 0;
      w[inp.dataset.sym] = v / 100;
      total += v;
    });
    if (Math.abs(total - 100) > 0.01) return null;
    return w;
  }
  // The forecast starts where history ends: the backtest's final
  // value, as displayed. It already reflects the current weights,
  // initial amount, and time range.
  function readStartValue() {
    var el = document.getElementById('finalValue');
    if (!el) return null;
    var v = parseFloat(String(el.textContent || '').replace(/[^0-9.]/g, ''));
    return (isNaN(v) || v <= 0) ? null : v;
  }
  function forecastDates() {
    var out = [], y = 2026, m = 10; // data through Oct 2026
    for (var t = 0; t <= N_MONTHS; t++) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  function runForecast() {
    var st = projState;
    if (!st || !st.fm || !st.spx) return null;
    var w = readWeights();
    if (!w) return { weightsOk: false };
    var start = readStartValue();
    if (!start) return { weightsOk: false };
    var fm = st.fm, spx = st.spx;
    var rfM = fm.rfMonthly;
    var muM = spx.E / 2, sdM = spx.SD / Math.sqrt(2);
    var betaP = 0;
    fm.syms.forEach(function (s) { betaP += (w[s] || 0) * fm.beta[s]; });
    var cum = [], acc = 0;
    spx.bands.forEach(function (b) { acc += b.p; cum.push(acc); });
    var med = [], p10 = [], p90 = [], medDd = [];
    var finalRets = [];
    var dates = forecastDates();
    for (var t = 0; t <= N_MONTHS; t++) {
      if (t === 0) { med.push(start); p10.push(start); p90.push(start); medDd.push(0); continue; }
    }
    // Simulate month by month, keeping all paths' values and peaks.
    var vals = [], peaks = [], dds = [];
    for (var n = 0; n < N_SIMS; n++) { vals.push([start]); peaks.push([start]); dds.push([0]); }
    for (var m = 1; m <= N_MONTHS; m++) {
      var mVals = [];
      for (var k = 0; k < N_SIMS; k++) {
        var rM;
        if (m === 1) {
          // Drawn once per path below; placeholder replaced after loop.
          rM = null;
        } else if (m === 2) {
          rM = null;
        } else {
          rM = muM + sdM * randn();
        }
        mVals.push(rM);
      }
      // Months 1-2 share one band draw per path (the market-implied
      // 2-month block), split with noise so each month keeps vol sdM.
      if (m === 1 || m === 2) {
        for (var j = 0; j < N_SIMS; j++) {
          if (m === 1) {
            var u = Math.random(), bi = 0;
            while (bi < cum.length - 1 && u > cum[bi]) bi++;
            var r2 = spx.bands[bi].r;
            var z = randn() * sdM / Math.sqrt(2);
            vals[j]._r2 = r2;
            vals[j]._r1 = r2 / 2 + z;
          }
          mVals[j] = (m === 1) ? vals[j]._r1 : (vals[j]._r2 - vals[j]._r1);
        }
      }
      for (var s = 0; s < N_SIMS; s++) {
        var mi = Math.floor(Math.random() * fm.nMonths);
        var eps = 0;
        fm.syms.forEach(function (sym) { if (w[sym]) eps += w[sym] * fm.resid[sym][mi]; });
        var rp = rfM + betaP * (mVals[s] - rfM) + eps;
        var nv = vals[s][m - 1] * (1 + rp);
        vals[s].push(nv);
        var pk = Math.max(peaks[s][m - 1], nv);
        peaks[s].push(pk);
        dds[s].push(nv / pk - 1);
        if (m === N_MONTHS) finalRets.push(nv / start - 1);
      }
    }
    for (var tt = 1; tt <= N_MONTHS; tt++) {
      var col = vals.map(function (v) { return v[tt]; }).sort(function (a, b) { return a - b; });
      med.push(quantile(col, 0.5)); p10.push(quantile(col, 0.1)); p90.push(quantile(col, 0.9));
      var dcol = dds.map(function (d) { return d[tt]; }).sort(function (a, b) { return a - b; });
      medDd.push(quantile(dcol, 0.5));
    }
    finalRets.sort(function (a, b) { return a - b; });
    var etfStats = fm.syms.map(function (s) {
      var b = fm.beta[s];
      var muIm = rfM + b * (muM - rfM);
      var sigIm = Math.sqrt(b * b * sdM * sdM + fm.residVar[s]);
      var label;
      if (s === 'VOO') label = 'Direct';
      else if (s === 'SGOV' || s === 'BIL') label = 'Rate-based';
      else label = fm.corr[s] >= 0.7 ? 'Proxy' : 'Provisional';
      return {
        sym: s, weight: w[s] || 0,
        annRet: Math.pow(1 + muIm, 12) - 1, annVol: sigIm * Math.sqrt(12),
        corr: fm.corr[s], label: label
      };
    });
    return {
      weightsOk: true, dates: dates, start: start,
      med: med, p10: p10, p90: p90, medDd: medDd,
      portAnnRet: mean(finalRets), portAnnVol: Math.sqrt(variance(finalRets)),
      pLoss: finalRets.filter(function (r) { return r < 0; }).length / N_SIMS,
      etfStats: etfStats
    };
  }

  function buildProjection(events) {
    var note = document.getElementById('polyProjNote');
    var fm = factorModel();
    if (!fm) {
      if (note) note.textContent = 'Projection unavailable: historical price data did not load.';
      return;
    }
    var spx = impliedSpx(events, fm);
    if (!spx) {
      if (note) note.textContent = 'Projection unavailable: the S&P 500 Dec-2026 band prices are incoherent or missing right now. The table above still shows live prices; try Refresh.';
      projState = null;
      drawProjEmpty();
      return;
    }
    projState = { events: events, fm: fm, spx: spx };
    if (note) {
      note.textContent = 'Method. (1) Market-implied: S&P 500 Dec-31, 2026 close bands, probabilities renormalized (sum ' +
        (spx.probSum * 100).toFixed(1) + '%); band midpoints assumed, open-ended bands $400 wide; base S&P level ' +
        Math.round(spx.base).toLocaleString('en-US') + ' from VOO’s Oct-2026 close x 10.909; implied 2-month mean ' +
        (spx.E * 100).toFixed(1) + '%, vol ' + (spx.SD * 100).toFixed(1) + '%. (2) Monthly market (model): monthly mean = implied mean / 2, monthly vol = implied vol / sqrt(2); months 1–2 draw one band return split across the two months, months 3–12 draw from a normal with the same monthly mean and vol. The market prices only Dec 31 — the monthly shape and everything past Dec 31 are model assumptions. (3) ETFs (model): CAPM-style beta from 72 months of returns, no historical alpha; residuals bootstrapped whole months so correlations are kept. Labels: Direct / Proxy (corr with VOO >= 0.70) / Provisional (corr < 0.70) / Rate-based (T-bill yield).';
    }
    drawForecast();
  }

  function drawProjEmpty() {
    ['polyProjGrowth', 'polyProjDrawdown', 'polyProjScatter'].forEach(function (id) {
      var c = document.getElementById(id);
      if (c) { var ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); }
    });
    ['polyProjLine', 'polyProjDrawdownLine'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    var tb = document.querySelector('#polyProjTable tbody');
    if (tb) tb.innerHTML = '';
  }

  function drawProjEmpty() {
    ['polyProjGrowth', 'polyProjDrawdown', 'polyProjScatter'].forEach(function (id) {
      var c = document.getElementById(id);
      if (c) { var ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); }
    });
    ['polyProjLine', 'polyProjDrawdownLine'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    var tb = document.querySelector('#polyProjTable tbody');
    if (tb) tb.innerHTML = '';
  }

  function drawForecast() {
    var res = runForecast();
    lastRes = res;
    if (!res) { drawProjEmpty(); return; }
    if (!res.weightsOk) {
      drawProjEmpty();
      var note = document.getElementById('polyProjNote');
      if (note) note.textContent = 'Weights do not total 100%. Adjust them to 100% to see the projection.';
      return;
    }
    var dates = res.dates;
    var medPts = dates.map(function (d, i) { return { date: d, value: res.med[i] }; });
    var band = dates.map(function (d, i) { return { lo: res.p10[i], hi: res.p90[i] }; });
    drawLineChart(document.getElementById('polyProjGrowth'), medPts, { fmt: fmtMoney, lastDot: true, band: band });
    var ddPts = dates.map(function (d, i) { return { date: d, dd: res.medDd[i] }; });
    drawLineChart(document.getElementById('polyProjDrawdown'), ddPts, { get: function (p) { return p.dd; }, fmt: fmtPctPlain, zeroTop: true });
    var pts = res.etfStats.map(function (e) {
      return { name: e.sym, vol: e.annVol, ann: e.annRet, kind: 'etf', weight: e.weight };
    });
    pts.push({ name: 'Your portfolio', vol: res.portAnnVol, ann: res.portAnnRet, kind: 'current' });
    drawScatterChart(document.getElementById('polyProjScatter'), pts);
    var line = document.getElementById('polyProjLine');
    if (line) line.textContent = 'Starting ' + fmtMoney(res.start) + ' (Oct 2026). Projected value in Oct 2027 — median ' +
      fmtMoney(res.med[N_MONTHS]) + ' (' + fmtPct(res.med[N_MONTHS] / res.start - 1) + '), 10th percentile ' +
      fmtMoney(res.p10[N_MONTHS]) + ', 90th percentile ' + fmtMoney(res.p90[N_MONTHS]) +
      '. Chance of ending below today: ' + (res.pLoss * 100).toFixed(0) + '%.';
    var deepest = Math.min.apply(null, res.medDd);
    var deepMonth = res.dates[res.medDd.indexOf(deepest)];
    var dl = document.getElementById('polyProjDrawdownLine');
    if (dl) dl.textContent = 'Median projected drawdown: deepest ' + fmtPct(deepest) + ' in ' + deepMonth +
      ', ending at ' + fmtPct(res.medDd[N_MONTHS]) + '. Drawdown is value / running peak − 1, computed per path, then the median.';
    fillProjTable(res);
  }

  function fillProjTable(res) {
    var tb = document.querySelector('#polyProjTable tbody');
    if (!tb) return;
    tb.innerHTML = '';
    var rows = res.etfStats.slice().sort(function (a, b) { return b.weight - a.weight; });
    rows.forEach(function (e) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong>' + e.sym + '</strong></td><td>' + (e.weight * 100).toFixed(0) + '%</td>' +
        '<td>' + fmtPct(e.annRet) + '</td><td>' + fmtPctPlain(e.annVol) + '</td>' +
        '<td>' + e.label + (e.label === 'Direct' || e.label === 'Rate-based' ? '' : ' · corr ' + e.corr.toFixed(2)) + '</td>';
      tb.appendChild(tr);
    });
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><strong>Your portfolio</strong></td><td>100%</td>' +
      '<td><strong>' + fmtPct(res.portAnnRet) + '</strong></td><td><strong>' + fmtPctPlain(res.portAnnVol) + '</strong></td>' +
      '<td>Portfolio (correlation-aware)</td>';
    tb.appendChild(tr);
  }

  function projHoverSetup() {
    var g = document.getElementById('polyProjGrowth');
    if (g) g.addEventListener('mousemove', function (e) {
      if (!lastRes || !lastRes.weightsOk) return;
      var rect = e.target.getBoundingClientRect();
      var i = Math.round(((e.clientX - rect.left) / rect.width) * N_MONTHS);
      i = Math.max(0, Math.min(N_MONTHS, i));
      document.getElementById('polyProjGrowthHover').textContent =
        lastRes.dates[i] + ': median ' + fmtMoney(lastRes.med[i]) +
        ' (10th–90th: ' + fmtMoney(lastRes.p10[i]) + ' – ' + fmtMoney(lastRes.p90[i]) + ')';
    });
    var d = document.getElementById('polyProjDrawdown');
    if (d) d.addEventListener('mousemove', function (e) {
      if (!lastRes || !lastRes.weightsOk) return;
      var rect = e.target.getBoundingClientRect();
      var i = Math.round(((e.clientX - rect.left) / rect.width) * N_MONTHS);
      i = Math.max(0, Math.min(N_MONTHS, i));
      document.getElementById('polyProjDrawdownHover').textContent =
        lastRes.dates[i] + ': ' + fmtPct(lastRes.medDd[i]) + ' (median drawdown)';
    });
    var sc = document.getElementById('polyProjScatter');
    if (sc) sc.addEventListener('mousemove', function (e) {
      var pts = sc._scatterPoints || [];
      if (!pts.length) return;
      var rect = e.target.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * e.target.clientWidth;
      var my = (e.clientY - rect.top) / rect.height * e.target.clientHeight;
      var best = null, bestD = 1e9;
      pts.forEach(function (p) {
        if (p.px === undefined) return;
        var dd = (p.px - mx) * (p.px - mx) + (p.py - my) * (p.py - my);
        if (dd < bestD) { bestD = dd; best = p; }
      });
      if (best && bestD < 900) {
        document.getElementById('polyProjScatterHover').textContent =
          best.name + ': projected volatility ' + fmtPctPlain(best.vol) + ', projected annualized return ' + fmtPct(best.ann);
      }
    });
    window.addEventListener('resize', function () { if (projState) drawForecast(); });
  }

  function bindProjInputs() {
    function soon() { setTimeout(function () { if (projState) drawForecast(); }, 0); }
    var w = document.getElementById('weights');
    if (w) w.addEventListener('input', soon);
    var pr = document.getElementById('presetRow');
    if (pr) pr.addEventListener('click', soon);
    var init = document.getElementById('initial');
    if (init) init.addEventListener('input', soon);
    var rr = document.getElementById('rangeRow');
    if (rr) rr.addEventListener('click', soon);
  }

  function init() {
    var btn = document.getElementById('polyRefreshBtn');
    if (btn) btn.addEventListener('click', function () { refresh(); });
    projHoverSetup();
    bindProjInputs();
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

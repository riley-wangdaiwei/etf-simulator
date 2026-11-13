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
  // ---- Forward-looking portfolio projection (market-implied, to Dec 31, 2026) ----
  //
  // Replaces the old per-market history charts. No S&P/WTI/Fed lines,
  // no per-market points: these three charts are the portfolio, seen
  // forward, and they recompute whenever weights change.
  //
  // Method — single-factor model, anchored to the one genuine
  // market-implied distribution Polymarket offers (S&P 500 close
  // bands, Dec 31, 2026):
  //   * Implied S&P distribution: the six close bands, probabilities
  //     renormalized. Band midpoints are assumed (open-ended bands
  //     take a $400-wide outer band: <$6,000 -> 5,800; >$8,000 ->
  //     8,250); the assumption is stated on the page.
  //   * S&P base level: VOO's latest month-end close from data.js
  //     (Oct 2026) x 10.909, the SPX/VOO close ratio on 2026-10-30
  //     (7,580.1 / 694.81). So the horizon is Oct 31 -> Dec 31,
  //     matching the backtest's data vintage.
  //   * Each ETF: CAPM-style, E[r_i] = r_f + beta_i * (E[r_M] - r_f),
  //     with beta_i from 72 months of monthly returns in data.js and
  //     r_f the 2-month T-bill return (SGOV's mean monthly return x 2).
  //     No historical alpha is assumed: expected return comes only
  //     from the market-implied S&P move, via beta.
  //   * Portfolio distribution: 4,000 Monte Carlo paths. Each path
  //     draws one S&P band by its market probability, then adds a
  //     residual vector bootstrapped from a random historical month
  //     (residuals demeaned per ETF, so no historical alpha leaks in;
  //     drawing a whole month's vector keeps the correlations between
  //     ETFs that the user asked to account for).
  //   * Per-ETF vol: sqrt(beta^2 * SD_M^2 + 2 * residual monthly
  //     variance). Portfolio vol comes from the simulated paths.
  //   * Labels: the S&P distribution is Direct (market-implied);
  //     every ETF is a Proxy (beta-mapped to that distribution).
  //     QQQM's own Nasdaq-100 bands exist but are untradable
  //     (prices sum to ~317%, ~$0 volume), so QQQM uses the same
  //     beta proxy as the other equities — stated, not hidden.
  //   * Nothing is projected past Dec 31, 2026: no market prices a
  //     longer horizon, and inventing one would be fabrication.
  var SPX_VOO_RATIO = 10.909; // SPX / VOO closes, 2026-10-30
  var BAND_MIDS = { '<$6,000': 5800, '$6,000-$6,500': 6250, '$6,500-$7,000': 6750, '$7,000-$7,500': 7250, '$7,500-$8,000': 7750, '>$8,000': 8250 };
  var N_SIMS = 4000;
  var projState = null; // { events, fm, spx } — kept in memory only, no storage

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
    var beta = {}, resid = {}, residVar = {};
    syms.forEach(function (s) {
      var rk = R[s], mk = mean(rk);
      var b = rk.reduce(function (a, v, i) { return a + (rv[i] - mv) * (v - mk); }, 0) / den;
      beta[s] = b;
      var e = rk.map(function (v, i) { return v - b * rv[i]; });
      var me = mean(e);
      resid[s] = e.map(function (v) { return v - me; });
      residVar[s] = variance(resid[s]);
    });
    return {
      syms: syms, beta: beta, resid: resid, residVar: residVar,
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
  function readInitial() {
    var v = parseFloat((document.getElementById('initial') || {}).value);
    return (isNaN(v) || v <= 0) ? 10000 : v;
  }

  function runProjection() {
    var st = projState;
    if (!st || !st.fm || !st.spx) return null;
    var w = readWeights();
    if (!w) return { weightsOk: false };
    var fm = st.fm, spx = st.spx;
    var rf = fm.rfMonthly * 2; // two months, Oct 31 -> Dec 31
    var betaP = 0;
    fm.syms.forEach(function (s) { betaP += (w[s] || 0) * fm.beta[s]; });
    var cum = [], acc = 0;
    spx.bands.forEach(function (b) { acc += b.p; cum.push(acc); });
    var sims = [];
    for (var n = 0; n < N_SIMS; n++) {
      var u = Math.random(), bi = 0;
      while (bi < cum.length - 1 && u > cum[bi]) bi++;
      var m = Math.floor(Math.random() * fm.nMonths);
      var eps = 0;
      fm.syms.forEach(function (s) { if (w[s]) eps += w[s] * fm.resid[s][m]; });
      sims.push(rf + betaP * (spx.bands[bi].r - rf) + eps);
    }
    sims.sort(function (a, b) { return a - b; });
    var worst = sims.slice(0, Math.floor(N_SIMS * 0.1));
    var etfStats = fm.syms.map(function (s) {
      var b = fm.beta[s];
      return {
        sym: s, weight: w[s] || 0,
        mean: rf + b * (spx.E - rf),
        vol: Math.sqrt(b * b * spx.SD * spx.SD + 2 * fm.residVar[s])
      };
    });
    return {
      weightsOk: true, sims: sims, initial: readInitial(), betaP: betaP, rf: rf,
      mean: mean(sims), sd: Math.sqrt(variance(sims)),
      p10: quantile(sims, 0.1), p50: quantile(sims, 0.5), p90: quantile(sims, 0.9),
      pLoss: sims.filter(function (r) { return r < 0; }).length / N_SIMS,
      es: mean(worst), etfStats: etfStats
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
      note.textContent = 'Method: S&P 500 Dec-31 close bands, probabilities renormalized (sum ' + (spx.probSum * 100).toFixed(1) +
        '%); band midpoints assumed, open-ended bands $400 wide. Base S&P level ' + Math.round(spx.base).toLocaleString('en-US') +
        ' from VOO’s Oct-2026 close x 10.909. Each ETF is a proxy: CAPM-style, beta from 72 months of returns, no historical alpha; residuals bootstrapped by month so ETF correlations are kept. Nothing is projected past Dec 31, 2026 — no market prices a longer horizon.';
    }
    drawProjection();
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

  function drawProjection() {
    var res = runProjection();
    if (!res) { drawProjEmpty(); return; }
    if (!res.weightsOk) {
      drawProjEmpty();
      var note = document.getElementById('polyProjNote');
      if (note) note.textContent = 'Weights do not total 100%. Adjust them to 100% to see the projection.';
      return;
    }
    drawProjGrowth(res);
    drawProjDrawdown(res);
    drawProjScatter(res);
    fillProjTable(res);
  }

  function projSetupCanvas(c) {
    var ctx = c.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }

  function histogramBins(vals, nBins) {
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 1e-9) { max = min + 1e-9; }
    var width = (max - min) / nBins, bins = [];
    for (var i = 0; i < nBins; i++) bins.push({ lo: min + i * width, hi: min + (i + 1) * width, n: 0 });
    vals.forEach(function (v) {
      var idx = Math.min(nBins - 1, Math.floor((v - min) / width));
      bins[idx].n++;
    });
    return { bins: bins, min: min, max: max, total: vals.length };
  }

  function drawProjGrowth(res) {
    var c = document.getElementById('polyProjGrowth');
    var line = document.getElementById('polyProjLine');
    if (!c) return;
    var vals = res.sims.map(function (r) { return res.initial * (1 + r); });
    var p10v = res.initial * (1 + res.p10), p50v = res.initial * (1 + res.p50), p90v = res.initial * (1 + res.p90);
    if (line) line.textContent = 'Projected value, Dec 31, 2026 — median $' + Math.round(p50v).toLocaleString('en-US') +
      ' (' + (res.p50 * 100).toFixed(1) + '%), 10th percentile $' + Math.round(p10v).toLocaleString('en-US') +
      ' (' + (res.p10 * 100).toFixed(1) + '%), 90th percentile $' + Math.round(p90v).toLocaleString('en-US') +
      ' (' + (res.p90 * 100).toFixed(1) + '%). Chance of a loss: ' + (res.pLoss * 100).toFixed(0) + '%.';
    var setup = projSetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    var hist = histogramBins(vals, 36);
    var maxN = Math.max.apply(null, hist.bins.map(function (b) { return b.n; }));
    var padL = 8, padR = 8, padT = 14, padB = 26;
    var bw = (W - padL - padR) / hist.bins.length;
    var y = function (n) { return padT + (1 - n / (maxN || 1)) * (H - padT - padB); };
    var xv = function (v) { return padL + ((v - hist.min) / (hist.max - hist.min || 1)) * (W - padL - padR); };
    ctx.fillStyle = '#fff';
    hist.bins.forEach(function (b, i) {
      if (!b.n) return;
      ctx.fillRect(padL + i * bw + 1, y(b.n), bw - 2, H - padB - y(b.n));
    });
    ctx.strokeStyle = '#888'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    [hist.min, (hist.min + hist.max) / 2, hist.max].forEach(function (v) {
      ctx.fillText('$' + Math.round(v).toLocaleString('en-US'), Math.min(xv(v), W - 70), H - 8);
    });
    // Today, p10, median, p90.
    var marks = [
      { v: res.initial, label: 'today', color: '#888' },
      { v: p10v, label: 'p10', color: '#fff' },
      { v: p50v, label: 'median', color: '#fff' },
      { v: p90v, label: 'p90', color: '#fff' }
    ];
    marks.forEach(function (mk) {
      ctx.strokeStyle = mk.color; ctx.lineWidth = mk.color === '#fff' ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(xv(mk.v), padT); ctx.lineTo(xv(mk.v), H - padB); ctx.stroke();
      ctx.fillStyle = mk.color;
      ctx.fillText(mk.label, Math.min(xv(mk.v) + 3, W - 50), padT + 10);
    });
    ctx.lineWidth = 1;
    c._hist = { bins: hist.bins, total: hist.total, fmt: function (b) { return '$' + Math.round((b.lo + b.hi) / 2).toLocaleString('en-US'); } };
  }

  function drawProjDrawdown(res) {
    var c = document.getElementById('polyProjDrawdown');
    var line = document.getElementById('polyProjDrawdownLine');
    if (!c) return;
    if (line) line.textContent = 'Chance of a loss by Dec 31: ' + (res.pLoss * 100).toFixed(0) + '%. 10th percentile return: ' +
      (res.p10 * 100).toFixed(1) + '%. Average of the worst 10% of outcomes: ' + (res.es * 100).toFixed(1) + '%.';
    var setup = projSetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    var vals = res.sims.map(function (r) { return r * 100; });
    var hist = histogramBins(vals, 36);
    var maxN = Math.max.apply(null, hist.bins.map(function (b) { return b.n; }));
    var padL = 8, padR = 8, padT = 14, padB = 26;
    var bw = (W - padL - padR) / hist.bins.length;
    var y = function (n) { return padT + (1 - n / (maxN || 1)) * (H - padT - padB); };
    var xv = function (v) { return padL + ((v - hist.min) / (hist.max - hist.min || 1)) * (W - padL - padR); };
    // Shade the loss region.
    if (hist.min < 0) {
      ctx.fillStyle = '#222';
      ctx.fillRect(padL, padT, Math.max(0, xv(0) - padL), H - padT - padB);
    }
    ctx.fillStyle = '#fff';
    hist.bins.forEach(function (b, i) {
      if (!b.n) return;
      ctx.fillRect(padL + i * bw + 1, y(b.n), bw - 2, H - padB - y(b.n));
    });
    ctx.strokeStyle = '#888'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    [hist.min, 0, hist.max].forEach(function (v) {
      ctx.fillText(v.toFixed(1) + '%', Math.min(Math.max(xv(v), padL), W - 52), H - 8);
    });
    [{ v: res.p10 * 100, label: 'p10' }, { v: res.p50 * 100, label: 'median' }].forEach(function (mk) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xv(mk.v), padT); ctx.lineTo(xv(mk.v), H - padB); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(mk.label, Math.min(xv(mk.v) + 3, W - 50), padT + 10);
    });
    ctx.lineWidth = 1;
    c._hist = { bins: hist.bins, total: hist.total, fmt: function (b) { return ((b.lo + b.hi) / 2).toFixed(1) + '%'; } };
  }

  function drawProjScatter(res) {
    var c = document.getElementById('polyProjScatter');
    if (!c) return;
    var setup = projSetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    var pts = res.etfStats.map(function (e) {
      return { name: e.sym, x: e.vol * 100, y: e.mean * 100, w: e.weight, kind: 'etf' };
    });
    pts.push({ name: 'Your portfolio', x: res.sd * 100, y: res.mean * 100, w: 1, kind: 'current' });
    var padL = 56, padR = 14, padT = 14, padB = 30;
    var xMax = Math.max.apply(null, pts.map(function (p) { return p.x; })) * 1.15 || 1;
    var yMin = Math.min.apply(null, pts.map(function (p) { return p.y; }));
    var yMax = Math.max.apply(null, pts.map(function (p) { return p.y; }));
    var pad = (yMax - yMin) * 0.2 || 1;
    yMin -= pad; yMax += pad;
    var x = function (v) { return padL + (v / xMax) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB); };
    ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    for (var i = 0; i <= 5; i++) {
      var xv = xMax * i / 5;
      ctx.beginPath(); ctx.moveTo(x(xv), padT); ctx.lineTo(x(xv), H - padB); ctx.stroke();
      ctx.fillText(xv.toFixed(1) + '%', x(xv) - 14, H - 10);
    }
    for (var j = 0; j <= 4; j++) {
      var yv = yMin + (yMax - yMin) * j / 4;
      ctx.beginPath(); ctx.moveTo(padL, y(yv)); ctx.lineTo(W - padR, y(yv)); ctx.stroke();
      ctx.fillText(yv.toFixed(1) + '%', 4, y(yv) + 4);
    }
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = '#555'; ctx.beginPath(); ctx.moveTo(padL, y(0)); ctx.lineTo(W - padR, y(0)); ctx.stroke();
    }
    ctx.fillStyle = '#888';
    ctx.fillText('Projected volatility (Dec 31) →', W - 210, H - 10);
    pts.forEach(function (p) { p.px = x(p.x); p.py = y(p.y); });
    pts.forEach(function (p) {
      if (p.kind === 'current') {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.px, p.py, 8, 0, Math.PI * 2); ctx.fill();
      } else {
        var r = 3 + 9 * Math.sqrt(p.w);
        ctx.fillStyle = '#fff'; ctx.fillRect(p.px - r / 2, p.py - r / 2, r, r);
      }
    });
    ctx.fillStyle = '#eee'; ctx.font = '11px sans-serif';
    pts.forEach(function (p) {
      ctx.fillText(p.name, Math.min(p.px + 10, W - 90), p.py - 8);
    });
    c._polyScatterPoints = pts;
  }

  function fillProjTable(res) {
    var tb = document.querySelector('#polyProjTable tbody');
    if (!tb) return;
    tb.innerHTML = '';
    var rows = res.etfStats.slice().sort(function (a, b) { return b.weight - a.weight; });
    rows.forEach(function (e) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><strong>' + e.sym + '</strong></td><td>' + (e.weight * 100).toFixed(0) + '%</td>' +
        '<td>' + (e.mean * 100).toFixed(1) + '%</td><td>' + (e.vol * 100).toFixed(1) + '%</td>' +
        '<td>Proxy (beta-mapped)</td>';
      tb.appendChild(tr);
    });
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><strong>Your portfolio</strong></td><td>100%</td>' +
      '<td><strong>' + (res.mean * 100).toFixed(1) + '%</strong></td><td><strong>' + (res.sd * 100).toFixed(1) + '%</strong></td>' +
      '<td>Portfolio (correlation-aware)</td>';
    tb.appendChild(tr);
  }

  function projHoverSetup() {
    function histHover(canvasId, hoverId) {
      var cv = document.getElementById(canvasId);
      if (!cv) return;
      cv.addEventListener('mousemove', function (e) {
        var h = cv._hist;
        if (!h) return;
        var rect = e.target.getBoundingClientRect();
        var idx = Math.floor(((e.clientX - rect.left) / rect.width) * h.bins.length);
        var b = h.bins[Math.max(0, Math.min(h.bins.length - 1, idx))];
        document.getElementById(hoverId).textContent =
          h.fmt(b) + ': ' + b.n + ' of ' + h.total + ' paths (' + (b.n / h.total * 100).toFixed(1) + '%).';
      });
    }
    histHover('polyProjGrowth', 'polyProjGrowthHover');
    histHover('polyProjDrawdown', 'polyProjDrawdownHover');
    var sc = document.getElementById('polyProjScatter');
    if (sc) sc.addEventListener('mousemove', function (e) {
      var pts = sc._polyScatterPoints || [];
      if (!pts.length) return;
      var rect = e.target.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * e.target.clientWidth;
      var my = (e.clientY - rect.top) / rect.height * e.target.clientHeight;
      var best = null, bestD = 1e9;
      pts.forEach(function (p) {
        var d = (p.px - mx) * (p.px - mx) + (p.py - my) * (p.py - my);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (best && bestD < 900) {
        document.getElementById('polyProjScatterHover').textContent =
          best.name + ': projected return ' + best.y.toFixed(1) + '%, volatility ' + best.x.toFixed(1) + '%' +
          (best.kind === 'etf' ? ', weight ' + (best.w * 100).toFixed(0) + '%' : '');
      }
    });
    window.addEventListener('resize', drawProjection);
  }

  function bindProjInputs() {
    var w = document.getElementById('weights');
    if (w) w.addEventListener('input', function () { if (projState) drawProjection(); });
    var pr = document.getElementById('presetRow');
    if (pr) pr.addEventListener('click', function () {
      setTimeout(function () { if (projState) drawProjection(); }, 0);
    });
    var init = document.getElementById('initial');
    if (init) init.addEventListener('input', function () { if (projState) drawProjection(); });
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

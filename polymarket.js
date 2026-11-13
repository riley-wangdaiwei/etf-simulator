// Polymarket Outlook — live market-implied probabilities from Polymarket.
//
// Reads the public read-only Gamma API directly from the browser (both
// Gamma and CLOB send Access-Control-Allow-Origin: *, verified
// 2026-11-12, so no proxy, key, or backend is needed). No trading,
// no wallet, no credentials.
//
// What is shown, and what is not:
// - Prices are market-implied probabilities from live Polymarket
//   contracts. They are NOT objective probabilities, NOT forecasts
//   of ETF returns, and NOT historical data. The backtest above still
//   uses only real Yahoo market data from data.js.
// - Index-band markets (S&P 500, Nasdaq-100) are shown as a band
//   distribution, not a single YES number, because there is no single
//   YES market for "the index will be up".
// - Mapping labels: Direct / Index reference / Provisional /
//   No reliable proxy found. Nothing is labelled a confirmed
//   correlation: the relevant contracts are weeks old, far below the
//   60-observation threshold in the spec, so every proxy here is
//   Provisional at most. Correlation checks are a follow-up step,
//   not claimed here.
//
// Known limits, found while testing 2026-11-12:
// - Gamma /markets?search= and /events?search= ignore the query;
//   discovery uses /public-search, detail uses /events?slug=.
// - Gamma /markets is deprecated (sunset May 2026) but still answers.
// - CLOB /book and /midpoint returned {"error":"Invalid token id"}
//   for valid tokens in testing, and CLOB blocks non-browser
//   user-agents (403), so bid/ask is not shown in v1; prices below
//   are Gamma outcomePrices (the exchange's live YES price), with
//   volume and liquidity shown so thin markets are visible.
// - Nasdaq-100 Dec bands are effectively untraded (about $0 volume)
//   and their YES prices sum to ~317%, which is incoherent for
//   mutually exclusive bands, so no live price is shown for QQQM.
(function () {
  'use strict';

  var GAMMA = 'https://gamma-api.polymarket.com';
  var CLOB = 'https://clob.polymarket.com';
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
      loadChartHistory(events);
    }).catch(function () {
      setStatus('Live request failed. Try Refresh.');
    });
  }

  // ---- Prediction charts: growth, drawdown, scatter ----
  // One probability series per distinct live market that has
  // tradable history (CLOB /prices-history, 1d). QQQM's Nasdaq
  // bands are excluded: about $0 volume means no price history.
  //   S&P 500: P(close >= $7,000 in Dec) = sum of the YES prices of
  //     the three bands at/above $7,000. One band alone is not the
  //     story; the chance of a strong close is.
  //   WTI: YES price of the $100-high touch market (highest-volume
  //     live threshold).
  //   Fed: YES price of the Dec 2026 meeting cut market.
  // Growth = implied probability over time. Drawdown = how far the
  // probability has fallen from its running peak, in percentage
  // points (pp), not percent — a probability is already a percent.
  // Scatter: each market as one point, x = probability volatility
  // (sample std of daily changes, pp), y = current probability.
  var chartSeries = [];
  var selectedSeries = 0;

  function tokenIds(market) {
    try { return JSON.parse(market.clobTokenIds || '[]'); } catch (e) { return []; }
  }
  // interval=max returns the full trade history (verified 2026-11-12:
  // the SPX band token goes back to 2026-10-13, ~4,000 points), while
  // interval=1d only covers the last ~24h at tick level. Bucket to
  // one point per day (last price of the day) so growth/drawdown/
  // scatter all read as daily series.
  function fetchHistory(token) {
    return fetch(CLOB + '/prices-history?market=' + encodeURIComponent(token) + '&interval=max')
      .then(function (r) { if (!r.ok) throw new Error('CLOB ' + r.status); return r.json(); })
      .then(function (d) {
        var byDay = {};
        (d.history || []).forEach(function (pt) {
          if (typeof pt.p !== 'number') return;
          byDay[new Date(pt.t * 1000).toISOString().slice(0, 10)] = pt.p;
        });
        var h = Object.keys(byDay).sort().map(function (date) { return { date: date, p: byDay[date] }; });
        return h.length >= 2 ? h : null;
      })
      .catch(function () { return null; });
  }
  function bandLowerBound(label) {
    if (!label) return null;
    var m = label.match(/^\$([\d,]+)/);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
    if (label.charAt(0) === '>') {
      var n = label.match(/>\$([\d,]+)/);
      return n ? parseInt(n[1].replace(/,/g, ''), 10) : null;
    }
    return null;
  }
  function bandLabel(market) {
    var match = (market.question || '').match(/close at (.+?) in December\?/);
    return match ? match[1] : (market.question || '');
  }
  // Align several token histories on shared dates, carrying each
  // token's last known price forward; sum them per date. A date
  // enters the series only once every token has a price.
  function sumHistories(histories) {
    var dates = {};
    histories.forEach(function (h) { h.forEach(function (pt) { dates[pt.date] = true; }); });
    var all = Object.keys(dates).sort();
    var idx = histories.map(function () { return 0; });
    var last = histories.map(function () { return null; });
    var out = [];
    all.forEach(function (d) {
      histories.forEach(function (h, k) {
        while (idx[k] < h.length && h[idx[k]].date <= d) { last[k] = h[idx[k]].p; idx[k]++; }
      });
      if (last.every(function (v) { return v !== null; })) {
        out.push({ date: d, p: last.reduce(function (a, b) { return a + b; }, 0) });
      }
    });
    return out.length >= 2 ? out : null;
  }
  function stddev(xs) {
    if (xs.length < 2) return 0;
    var m = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var v = xs.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  function buildChartSeries(events) {
    var defs = [];
    var spx = events['spx-close-dec-2026'];
    if (spx) {
      var highBands = (spx.markets || []).filter(function (m) {
        var lb = bandLowerBound(bandLabel(m));
        return lb !== null && lb >= 7000;
      });
      if (highBands.length) {
        defs.push({ id: 'spx', label: 'S&P 500 closes at $7,000 or above (Dec 2026)', etfs: 'VOO · VTI',
          tokens: highBands.map(function (m) { return tokenIds(m)[0]; }).filter(Boolean),
          combine: 'sum' });
      }
    }
    var wti = events['what-price-will-wti-hit-in-november-2026'];
    if (wti) {
      var live = (wti.markets || []).map(function (m) { return { m: m, yes: yesPrice(m), vol: num(m.volume), liq: num(m.liquidity) }; })
        .filter(function (x) { return x.yes !== null && x.liq > 0 && /hit \(HIGH\) \$100/.test(x.m.question || ''); })
        .sort(function (a, b) { return b.vol - a.vol; });
      if (live.length) {
        defs.push({ id: 'wti', label: 'WTI hits $100 high (Nov 2026)', etfs: 'XLE',
          tokens: [tokenIds(live[0].m)[0]].filter(Boolean), combine: 'single' });
      }
    }
    var fed = events['fed-rate-cut-by-629'];
    if (fed) {
      var f = summarizeFed(fed.markets || []);
      if (f) {
        var fm = (fed.markets || []).filter(function (m) { return m.slug === f.slug; })[0];
        if (fm) {
          defs.push({ id: 'fed', label: 'Fed cut by Dec 2026 meeting', etfs: 'BND · SGOV · BIL',
            tokens: [tokenIds(fm)[0]].filter(Boolean), combine: 'single' });
        }
      }
    }
    return defs;
  }

  function loadChartHistory(events) {
    var defs = buildChartSeries(events);
    var note = document.getElementById('polyHistoryNote');
    if (!defs.length) {
      if (note) note.textContent = 'No prediction history available right now.';
      return;
    }
    if (note) note.textContent = 'Loading prediction history…';
    Promise.all(defs.map(function (def) {
      return Promise.all(def.tokens.map(fetchHistory)).then(function (hs) {
        hs = hs.filter(Boolean);
        if (!hs.length) return null;
        var points = def.combine === 'sum' ? sumHistories(hs) : hs[0];
        if (!points || points.length < 2) return null;
        var changes = [];
        for (var i = 1; i < points.length; i++) changes.push((points[i].p - points[i - 1].p) * 100);
        return {
          id: def.id, label: def.label, etfs: def.etfs, points: points,
          current: points[points.length - 1].p * 100,
          first: points[0].p * 100,
          vol: stddev(changes)
        };
      });
    })).then(function (results) {
      chartSeries = results.filter(Boolean);
      selectedSeries = 0;
      buildSeriesButtons();
      drawPolyCharts();
      if (note) {
        note.textContent = chartSeries.length
          ? 'History is daily YES prices from CLOB (last price each day, full history from each market’s first trade). Nasdaq-100 bands have no history (about $0 volume), so QQQM has no chart.'
          : 'No prediction history could be loaded — CLOB price history was empty or unreachable. The table above still shows live prices; try Refresh.';
      }
    });
  }

  function buildSeriesButtons() {
    var row = document.getElementById('polySeriesRow');
    if (!row) return;
    row.innerHTML = '';
    chartSeries.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.label;
      if (i === selectedSeries) b.classList.add('on');
      b.addEventListener('click', function () { selectedSeries = i; buildSeriesButtons(); drawPolyCharts(); });
      row.appendChild(b);
    });
  }

  function polySetupCanvas(c) {
    var ctx = c.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    return { ctx: ctx, W: W, H: H };
  }
  function polyDateLabels(ctx, points, x, W, H, seen) {
    points.forEach(function (p, i) {
      var key = p.date.slice(0, 7);
      if ((p.date.slice(5, 7) === '01' || i === 0 || i === points.length - 1) && !seen.has(key)) {
        seen.add(key);
        ctx.fillText(key, Math.min(x(i), W - 58), H - 8);
      }
    });
  }

  function drawPolyCharts() {
    drawPolyGrowth();
    drawPolyDrawdown();
    drawPolyScatter();
  }

  function drawPolyGrowth() {
    var c = document.getElementById('polyGrowthChart');
    var line = document.getElementById('polyGrowthLine');
    if (!c) return;
    var s = chartSeries[selectedSeries];
    if (!s) { if (line) line.textContent = '—'; return; }
    var points = s.points;
    var chg = s.current - s.first;
    if (line) line.textContent = s.label + ' — now ' + s.current.toFixed(1) + '%, ' +
      (chg >= 0 ? '+' : '') + chg.toFixed(1) + 'pp since ' + points[0].date + ' (' + points.length + ' days).';
    var setup = polySetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    if (points.length < 2) return;
    var vals = points.map(function (p) { return p.p * 100; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var padL = 8, padR = 8, padT = 14, padB = 26;
    var x = function (i) { return padL + (i / (points.length - 1)) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB); };
    ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    [min, (min + max) / 2, max].forEach(function (v) {
      ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
      ctx.fillText(v.toFixed(1) + '%', padL + 2, y(v) - 4);
    });
    polyDateLabels(ctx, points, x, W, H, new Set());
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach(function (p, i) { i === 0 ? ctx.moveTo(x(i), y(p.p * 100)) : ctx.lineTo(x(i), y(p.p * 100)); });
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.arc(x(points.length - 1), y(points[points.length - 1].p * 100), 4, 0, Math.PI * 2); ctx.fill();
  }

  function drawPolyDrawdown() {
    var c = document.getElementById('polyDrawdownChart');
    var line = document.getElementById('polyDrawdownLine');
    if (!c) return;
    var s = chartSeries[selectedSeries];
    if (!s) { if (line) line.textContent = '—'; return; }
    var points = s.points;
    var peak = -Infinity, dds = [], maxDd = 0;
    points.forEach(function (p) {
      var v = p.p * 100;
      if (v > peak) peak = v;
      var dd = v - peak;
      dds.push({ date: p.date, dd: dd });
      if (dd < maxDd) maxDd = dd;
    });
    if (line) line.textContent = 'Max drawdown: ' + maxDd.toFixed(1) + 'pp below the peak probability.';
    var setup = polySetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    if (dds.length < 2) return;
    var min = Math.min.apply(null, dds.map(function (p) { return p.dd; }).concat([0]));
    var padL = 8, padR = 8, padT = 14, padB = 26;
    var x = function (i) { return padL + (i / (dds.length - 1)) * (W - padL - padR); };
    var y2 = function (v) { return padT + (0 - v) / (0 - min || 1) * (H - padT - padB); };
    ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    [0, min / 2, min].forEach(function (v) {
      ctx.beginPath(); ctx.moveTo(padL, y2(v)); ctx.lineTo(W - padR, y2(v)); ctx.stroke();
      ctx.fillText(v.toFixed(1) + 'pp', padL + 2, y2(v) - 4);
    });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
    dds.forEach(function (p, i) { i === 0 ? ctx.moveTo(x(i), y2(p.dd)) : ctx.lineTo(x(i), y2(p.dd)); });
    ctx.stroke();
    polyDateLabels(ctx, dds, x, W, H, new Set());
  }

  function drawPolyScatter() {
    var c = document.getElementById('polyScatterChart');
    if (!c) return;
    var setup = polySetupCanvas(c), ctx = setup.ctx, W = setup.W, H = setup.H;
    var pts = chartSeries.filter(function (s) { return s.points.length >= 5; }).map(function (s) {
      return { name: s.label + ' (' + s.etfs + ')', x: s.vol, y: s.current };
    });
    if (!pts.length) return;
    var padL = 56, padR = 14, padT = 14, padB = 30;
    var xMax = Math.max.apply(null, pts.map(function (p) { return p.x; })) * 1.15 || 1;
    var yMin = Math.min.apply(null, pts.map(function (p) { return p.y; }));
    var yMax = Math.max.apply(null, pts.map(function (p) { return p.y; }));
    var pad = (yMax - yMin) * 0.2 || 5;
    yMin -= pad; yMax += pad;
    var x = function (v) { return padL + (v / xMax) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB); };
    ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    for (var i = 0; i <= 5; i++) {
      var xv = xMax * i / 5;
      ctx.beginPath(); ctx.moveTo(x(xv), padT); ctx.lineTo(x(xv), H - padB); ctx.stroke();
      ctx.fillText(xv.toFixed(1) + 'pp', x(xv) - 14, H - 10);
    }
    for (var j = 0; j <= 4; j++) {
      var yv = yMin + (yMax - yMin) * j / 4;
      ctx.beginPath(); ctx.moveTo(padL, y(yv)); ctx.lineTo(W - padR, y(yv)); ctx.stroke();
      ctx.fillText(yv.toFixed(0) + '%', 4, y(yv) + 4);
    }
    ctx.fillStyle = '#888';
    ctx.fillText('Probability volatility (pp) →', W - 190, H - 10);
    pts.forEach(function (p) { p.px = x(p.x); p.py = y(p.y); });
    pts.forEach(function (p) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.px, p.py, 7, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#eee'; ctx.font = '11px sans-serif';
    pts.forEach(function (p) {
      ctx.fillText(p.name, Math.min(p.px + 9, W - 260), p.py - 8);
    });
    c._polyScatterPoints = pts;
  }

  function polyHoverSetup() {
    var g = document.getElementById('polyGrowthChart');
    if (g) g.addEventListener('mousemove', function (e) {
      var s = chartSeries[selectedSeries];
      if (!s) return;
      var rect = e.target.getBoundingClientRect();
      var i = Math.round(((e.clientX - rect.left) / rect.width) * (s.points.length - 1));
      var p = s.points[Math.max(0, Math.min(s.points.length - 1, i))];
      document.getElementById('polyGrowthHover').textContent = p.date + ': ' + (p.p * 100).toFixed(1) + '%';
    });
    var d = document.getElementById('polyDrawdownChart');
    if (d) d.addEventListener('mousemove', function (e) {
      var s = chartSeries[selectedSeries];
      if (!s) return;
      var rect = e.target.getBoundingClientRect();
      var i = Math.round(((e.clientX - rect.left) / rect.width) * (s.points.length - 1));
      var p = s.points[Math.max(0, Math.min(s.points.length - 1, i))];
      var peak = -Infinity, dd = 0;
      for (var k = 0; k <= i; k++) {
        var v = s.points[k].p * 100;
        if (v > peak) peak = v;
        dd = v - peak;
      }
      document.getElementById('polyDrawdownHover').textContent = p.date + ': ' + dd.toFixed(1) + 'pp below peak';
    });
    var sc = document.getElementById('polyScatterChart');
    if (sc) sc.addEventListener('mousemove', function (e) {
      var pts = sc._polyScatterPoints || [];
      if (!pts.length) return;
      var rect = e.target.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * e.target.clientWidth;
      var my = (e.clientY - rect.top) / rect.height * e.target.clientHeight;
      var best = null, bestD = 1e9;
      pts.forEach(function (p) {
        var dd2 = (p.px - mx) * (p.px - mx) + (p.py - my) * (p.py - my);
        if (dd2 < bestD) { bestD = dd2; best = p; }
      });
      if (best && bestD < 900) {
        document.getElementById('polyScatterHover').textContent =
          best.name + ': probability ' + best.y.toFixed(1) + '%, volatility ' + best.x.toFixed(2) + 'pp';
      }
    });
    window.addEventListener('resize', drawPolyCharts);
  }

  function init() {
    var btn = document.getElementById('polyRefreshBtn');
    if (btn) btn.addEventListener('click', function () { refresh(); });
    polyHoverSetup();
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

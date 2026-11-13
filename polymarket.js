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
  var CACHE_KEY = 'poly-outlook-v1';
  var CACHE_MS = 15 * 60 * 1000;

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

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.fetchedAt && (Date.now() - c.fetchedAt) < CACHE_MS) return c;
    } catch (e) {}
    return null;
  }
  function saveCache(events) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), events: events })); } catch (e) {}
  }

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

  function render(events, fetchedAt, fromCache) {
    var tbody = document.querySelector('#polyTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    var updated = new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('polyUpdated').textContent =
      'Last updated: ' + updated + (fromCache ? ' (cached)' : '') + '. ';
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

  function refresh(force) {
    var cached = loadCache();
    if (cached && !force) {
      render(cached.events, cached.fetchedAt, true);
      setStatus('Showing cached data. Use Refresh for the latest prices.');
      return;
    }
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
      saveCache(events);
      render(events, Date.now(), false);
      setStatus(ok === slugs.length
        ? 'Live data from Polymarket Gamma API.'
        : 'Some markets failed to load (' + ok + '/' + slugs.length + ' events). Rows show what is available; try Refresh.');
    }).catch(function () {
      if (cached) { render(cached.events, cached.fetchedAt, true); setStatus('Live request failed — showing cached data.'); }
      else setStatus('Live request failed and no cached data is available. Try Refresh.');
    });
  }

  function init() {
    var btn = document.getElementById('polyRefreshBtn');
    if (btn) btn.addEventListener('click', function () { refresh(true); });
    refresh(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

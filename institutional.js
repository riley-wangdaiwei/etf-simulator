// Institutional Forecast Analyzer.
//
// Replaces the Polymarket-based forward-looking section. Data comes ONLY
// from published institutional research supplied as a CSV
// (institutional_data.csv in the repo, or a user-uploaded CSV previewed
// in-session). Nothing here is a forecast computed from history, and
// nothing is invented: a blank numeric cell means "not supplied", never
// zero, and a missing value is shown as missing, never filled in.
//
// The historical backtest (app.js) is untouched. Historical prices are
// used only for one clearly labelled thing: an optional historical
// covariance proxy for portfolio volatility, with its sample window.
//
// CSV contract (one row per observation):
//   record_type: 'return_forecast' | 'qualitative_view'
//   institution, report_title, publication_date, data_as_of_date
//   horizon_years, horizon_label
//   asset_class, benchmark_index
//   expected_return_pct, expected_return_low_pct, expected_return_high_pct
//   volatility_pct, correlation_group
//   view_rating, view_direction, scenario
//   return_basis, currency, gross_net
//   source_url, source_notes, data_quality, verified_on
// Percent columns hold percentage points: 5.2 means 5.2%, not 0.052.
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // CSV parsing (no dependencies; handles quoted fields, commas in
  // quotes, CRLF). Returns { headers, rows } where rows are arrays of
  // raw strings. A malformed quote is a parse error, not a guess.
  // ------------------------------------------------------------------
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
      field += c; i++;
    }
    if (inQuotes) return { error: 'Unclosed quote in CSV.' };
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Drop trailing empty rows.
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0].trim() === '') rows.pop();
    if (!rows.length) return { error: 'CSV is empty.' };
    var headers = rows[0].map(function (h) { return h.trim(); });
    return { headers: headers, rows: rows.slice(1) };
  }

  var EXPECTED_COLUMNS = [
    'institution', 'report_title', 'publication_date', 'data_as_of_date',
    'horizon_years', 'horizon_label', 'asset_class', 'benchmark_index',
    'expected_return_pct', 'expected_return_low_pct', 'expected_return_high_pct',
    'volatility_pct', 'correlation_group', 'view_rating', 'view_direction',
    'scenario', 'return_basis', 'currency', 'gross_net', 'source_url',
    'source_notes', 'data_quality', 'verified_on'
  ];
  // Four files, one vocabulary: the instructions define a single set of
  // column names; the four CSVs are partitions of it by purpose
  // (asset_forecasts = numeric forecasts, tactical_views = directional
  // views, scenario_assumptions = scenario rows, source_register =
  // source metadata). A file is recognised by filename AND by which
  // known columns it carries; record_type may be omitted and is then
  // inferred from the file. Columns outside the documented vocabulary
  // are never silently renamed — they are reported in the preview.
  //
  // 2026-11-13 update: the real files the generating AI produced use
  // DIFFERENT column names (forecast_horizon, expected_volatility_pct,
  // return_type, gross_or_net, verification_status, scenario_name,
  // affected_asset_class, numeric_return_impact_pct, original_source_url,
  // ...). The alias table below maps the real schema onto the canonical
  // names above, so both schemas ingest. KNOWN_IGNORED lists columns
  // that are recognised but deliberately never used for a return
  // (index target levels, scenario levels) — no return is derived
  // from them.
  var HEADER_ALIASES = {
    'forecast_horizon': 'horizon_label',
    'expected_volatility_pct': 'volatility_pct',
    'return_type': 'return_basis',
    'gross_or_net': 'gross_net',
    'source_page': 'source_page',
    'source_quote_or_table_reference': 'source_ref',
    'verification_status': 'verification_status',
    'confidence_or_percentile': 'confidence',
    'scenario_name': 'scenario',
    'scenario_description': 'scenario_description',
    'affected_asset_class': 'asset_class',
    'affected_risk_factor': 'risk_factor',
    'expected_direction': 'view_direction',
    'numeric_return_impact_pct': 'impact_return_pct',
    'numeric_volatility_impact_pct': 'impact_vol_pct',
    'numeric_rate_change_bps': 'impact_rate_bps',
    'numeric_inflation_change_pct': 'impact_inflation_pct',
    'original_source_url': 'source_url',
    'investment_thesis': 'thesis',
    'positive_factors': 'factors_pos',
    'negative_factors': 'factors_neg',
    'key_risks': 'key_risks',
    'notes': 'source_notes',
    'report_type': 'report_type',
    'forecast_horizons_covered': 'horizons_covered',
    'pdf_url': 'pdf_url',
    'date_accessed': 'date_accessed',
    'relevant_pages_or_tables': 'relevant_pages',
    'data_extracted': 'data_extracted',
    'limitations': 'limitations'
  };
  var KNOWN_IGNORED = ['record_id', 'target_level', 'target_date',
    'scenario_level_value', 'baseline_level_value', 'value_unit'];
  var KNOWN_COLUMNS = EXPECTED_COLUMNS.concat(['record_type'],
    Object.keys(HEADER_ALIASES), KNOWN_IGNORED);
  var REQUIRED_COLUMNS = ['institution'];

  // Free-text fields in the real files need grouping before they can
  // be used as cohort keys — otherwise every spelling is its own
  // cohort. The raw text is kept on the record for display; only the
  // normalized token groups rows. Nothing is averaged across groups.
  function normReturnBasis(raw) {
    var s = (raw || '').toLowerCase();
    if (/arithmetic/.test(s)) return 'arithmetic';
    if (/price return/.test(s)) return 'price return (excl. dividends)';
    if (/index level/.test(s)) return 'index level (no % return)';
    if (/currency change/.test(s)) return 'currency change';
    if (/geometric/.test(s)) return 'geometric';
    return (raw || '').trim().slice(0, 60);
  }
  function normCurrency(raw) {
    var s = (raw || '').trim();
    if (/^local/i.test(s)) return 'Local';
    if (/^usd/i.test(s)) return 'USD';
    return s;
  }
  function normGrossNet(raw) {
    var s = (raw || '').toLowerCase();
    if (/gross|no fees/.test(s)) return 'gross';
    if (/n\/a/.test(s)) return 'n/a';
    return (raw || '').trim();
  }
  // Horizon years arrive as ranges ('10-15', '3-5', '10+', '~1') or
  // blank (UNRESOLVED). Parse leniently: the leading number groups
  // the row, the raw string is kept for display. Never rejects a row.
  function parseHorizonYears(raw) {
    var s = (raw || '').trim();
    if (!s) return { years: null, raw: '' };
    var m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return { years: null, raw: s };
    return { years: parseFloat(m[1]), raw: s };
  }
  function horizonKey(r) {
    if (r.horizon_years_raw) return r.horizon_years_raw === '10+' ? '10' : r.horizon_years_raw;
    return r.horizon_label || 'unspecified horizon';
  }
  function horizonLabel(r) {
    var raw = r.horizon_years_raw;
    if (raw) {
      var num = parseHorizonYears(raw).years;
      return raw.replace('-', '–') + (num === 1 ? ' year' : ' years');
    }
    return r.horizon_label || 'Unspecified horizon';
  }
  function isPriceTarget(r) {
    return /price return|index level/.test(r.return_basis || '');
  }
  function isVerified(r) {
    return (r.verification_status || '') === 'VERIFIED_PRIMARY';
  }

  function toNum(raw) {
    if (raw === undefined || raw === null) return null;
    var s = String(raw).trim();
    if (s === '') return null; // blank = not supplied, never zero
    var n = Number(s.replace(/%/g, ''));
    return isNaN(n) ? NaN : n;
  }
  function toPct(raw) { // percentage points -> decimal, e.g. 5.2 -> 0.052
    var n = toNum(raw);
    if (n === null || isNaN(n)) return n;
    return n / 100;
  }
  function clean(s) { return (s === undefined || s === null) ? '' : String(s).trim(); }

  // ------------------------------------------------------------------
  // Validation + ingestion. Returns a report object; never throws on
  // bad rows — bad rows are listed as rejected with a reason.
  // ------------------------------------------------------------------
  // opts: { inferType: 'return_forecast' | 'qualitative_view',
  //         fileLabel: string shown in reports, fileKind: one of the
  //         four file keys }. record_type is inferred from the file
  //         when the column is absent; it is never guessed from data.
  function ingestCSV(text, sourceLabel, opts) {
    opts = opts || {};
    var rep = {
      source: sourceLabel, fileKind: opts.fileKind || null, imported: 0, rejected: 0, skipped: 0,
      duplicates: [], conflicts: [], rejectedRows: [], records: [],
      warnings: [], error: null, unrecognizedColumns: []
    };
    var parsed = parseCSV(text);
    if (parsed.error) { rep.error = parsed.error; return rep; }
    var headers = parsed.headers;
    rep.unrecognizedColumns = headers.filter(function (h) { return KNOWN_COLUMNS.indexOf(h) < 0; });
    if (rep.unrecognizedColumns.length) {
      rep.warnings.push('Unrecognized column(s) — not in the instructions: ' + rep.unrecognizedColumns.join(', ') + '. They are ignored for calculations, not renamed.');
    }
    var missing = REQUIRED_COLUMNS.filter(function (c) { return headers.indexOf(c) < 0; });
    if (missing.length) {
      rep.error = 'Missing required column(s): ' + missing.join(', ') + '.';
      return rep;
    }
    var idx = {};
    headers.forEach(function (h, i) {
      var canonical = HEADER_ALIASES[h] || h;
      if (idx[canonical] === undefined) idx[canonical] = i;
    });
    function col(r, name) { return idx[name] === undefined ? '' : r[idx[name]]; }
    var seen = {};
    parsed.rows.forEach(function (r, ri) {
      var lineNo = ri + 2; // +1 header, +1 for 1-based lines
      if (!r.length || r.every(function (c) { return String(c).trim() === ''; })) { rep.skipped++; return; }
      var rec = {
        institution: clean(col(r, 'institution')),
        report_title: clean(col(r, 'report_title')),
        publication_date: clean(col(r, 'publication_date')),
        data_as_of_date: clean(col(r, 'data_as_of_date')),
        horizon_years: null, // parsed leniently below (ranges like '10-15')
        horizon_label: clean(col(r, 'horizon_label')),
        asset_class: clean(col(r, 'asset_class')),
        benchmark_index: clean(col(r, 'benchmark_index')),
        record_type: clean(col(r, 'record_type')),
        expected_return: toPct(col(r, 'expected_return_pct')),
        expected_low: toPct(col(r, 'expected_return_low_pct')),
        expected_high: toPct(col(r, 'expected_return_high_pct')),
        volatility: toPct(col(r, 'volatility_pct')),
        correlation_group: clean(col(r, 'correlation_group')),
        view_rating: clean(col(r, 'view_rating')),
        view_direction: clean(col(r, 'view_direction')).toLowerCase(),
        scenario: clean(col(r, 'scenario')),
        return_basis: clean(col(r, 'return_basis')),
        currency: clean(col(r, 'currency')),
        gross_net: clean(col(r, 'gross_net')),
        source_url: clean(col(r, 'source_url')),
        source_notes: clean(col(r, 'source_notes')),
        data_quality: clean(col(r, 'data_quality')),
        verified_on: clean(col(r, 'verified_on')),
        verification_status: clean(col(r, 'verification_status')),
        source_page: clean(col(r, 'source_page')),
        source_ref: clean(col(r, 'source_ref')),
        confidence: clean(col(r, 'confidence')),
        scenario_description: clean(col(r, 'scenario_description')),
        risk_factor: clean(col(r, 'risk_factor')),
        impact_return_pct: toPct(col(r, 'impact_return_pct')),
        impact_vol_pct: toPct(col(r, 'impact_vol_pct')),
        impact_rate_bps: toNum(col(r, 'impact_rate_bps')),
        impact_inflation_pct: toPct(col(r, 'impact_inflation_pct')),
        thesis: clean(col(r, 'thesis')),
        factors_pos: clean(col(r, 'factors_pos')),
        factors_neg: clean(col(r, 'factors_neg')),
        key_risks: clean(col(r, 'key_risks')),
        target_level: toNum(col(r, 'target_level')),
        target_date: clean(col(r, 'target_date')),
        _line: lineNo,
        _sourceFile: opts.fileLabel || sourceLabel
      };
      // Normalize grouping fields (raw text kept for display).
      var hy = parseHorizonYears(col(r, 'horizon_years'));
      rec.horizon_years = hy.years;
      rec.horizon_years_raw = hy.raw;
      rec.return_basis_raw = rec.return_basis;
      rec.return_basis = normReturnBasis(rec.return_basis);
      rec.currency_raw = rec.currency;
      rec.currency = normCurrency(rec.currency);
      rec.gross_net_raw = rec.gross_net;
      rec.gross_net = normGrossNet(rec.gross_net);
      // A scenario row's published numeric impact is its return figure.
      if (rec.expected_return === null && rec.impact_return_pct !== null) {
        rec.expected_return = rec.impact_return_pct;
      }
      // --- validation ---
      if (!rec.institution) { rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: 'institution is blank' }); return; }
      if (rec.record_type !== 'return_forecast' && rec.record_type !== 'qualitative_view') {
        if (!rec.record_type && opts.inferType) rec.record_type = opts.inferType;
        else { rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: 'record_type must be return_forecast or qualitative_view, got "' + rec.record_type + '"' }); return; }
      }
      if (!rec.asset_class) {
        // A scenario row may be asset-class-agnostic (a broad macro
        // view). It is kept, shown as broad, and never forced into a
        // class. Every other row needs an asset class to be usable.
        if (rec.record_type === 'qualitative_view' && rec.scenario) {
          rep.warnings.push('Line ' + lineNo + ': scenario view with no asset_class — shown as a broad scenario, not mapped to an asset class.');
        } else { rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: 'asset_class is blank' }); return; }
      }
      var badNum = null;
      ['expected_return', 'expected_low', 'expected_high', 'volatility', 'impact_return_pct', 'target_level'].forEach(function (k) {
        if (typeof rec[k] === 'number' && isNaN(rec[k])) badNum = k;
      });
      if (badNum) { rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: badNum + ' is not a number' }); return; }
      [rec.expected_return, rec.expected_low, rec.expected_high, rec.volatility].forEach(function (v) {
        if (typeof v === 'number' && Math.abs(v) > 0.5) {
          rep.warnings.push('Line ' + lineNo + ': a percentage above 50% — check the value (' + (v * 100).toFixed(1) + '%) before trusting it.');
        }
      });
      if (rec.record_type === 'return_forecast' && rec.expected_return === null && rec.expected_low === null && rec.expected_high === null) {
        rep.warnings.push('Line ' + lineNo + ': return_forecast with no expected return or range — it cannot be plotted.');
      }
      // Range midpoint, flagged, when the point estimate is missing.
      rec.returnMid = null;
      if (rec.expected_return !== null) rec.returnMid = rec.expected_return;
      else if (rec.expected_low !== null && rec.expected_high !== null) {
        rec.returnMid = (rec.expected_low + rec.expected_high) / 2;
        rec.fromRange = true;
      }
      rec.asset_norm = normalizeAssetClass(rec.asset_class);
      rec.benchmark_norm = normalizeAssetClass(rec.benchmark_index);
      // --- duplicates / conflicts (published identity, not the
      // normalized bucket — see recordKey) ---
      var key = recordKey(rec);
      if (seen[key]) {
        var prev = seen[key];
        var same = prev.expected_return === rec.expected_return && prev.volatility === rec.volatility &&
          prev.view_direction === rec.view_direction && prev.view_rating === rec.view_rating &&
          prev.expected_low === rec.expected_low && prev.expected_high === rec.expected_high;
        if (same) { rep.skipped++; rep.duplicates.push({ line: lineNo, key: key }); }
        else { rep.rejected++; rep.conflicts.push({ line: lineNo, key: key, keptLine: prev._line }); }
        return;
      }
      seen[key] = rec;
      rep.records.push(rec);
      rep.imported++;
    });
    return rep;
  }

  // ------------------------------------------------------------------
  // Asset-class normalization. Matching is by these keys, so different
  // spellings of the same class land together. Unknown classes keep
  // their own lowercased text — they are shown as unmapped, not forced
  // into a bucket.
  // ------------------------------------------------------------------
  // Order matters: specific patterns first, generic ones last, so
  // 'Global ex-U.S. equities' does not collapse into 'Global equities'
  // and 'Global aggregate bonds' does not collapse into 'U.S. aggregate
  // bonds'. Unknown classes keep their own lowercased text — they are
  // shown as unmapped, not forced into a bucket.
  var ASSET_ALIASES = [
    [/s&p\s*500|u\.?s\.? large[- ]cap( equity)?/i, 'us large-cap equity'],
    [/nasdaq[- ]?100/i, 'us large-cap growth / technology-heavy equity'],
    [/global growth equity/i, 'global growth equity'],
    [/u\.?s\.? growth equity/i, 'us large-cap growth / technology-heavy equity'],
    [/u\.?s\.? value equity/i, 'us value equity'],
    [/total (us )?stock|us total market/i, 'us total market equity'],
    [/global ex-?u\.?s\.?/i, 'ex-us equity'],
    [/developed.*ex-?u\.?s\.?/i, 'developed ex-us equity'],
    [/emerging-market debt/i, 'emerging-market debt'],
    [/emerging markets? equities?/i, 'emerging markets equity'],
    [/ex-?u\.?s\.? equities?|international equities? ex|non-?u\.?s\.? equity/i, 'ex-us equity'],
    [/international equities?|ex-?u\.?s\.?/i, 'ex-us equity'],
    [/all country|global.*equit|world equity/i, 'global equity'],
    [/u\.?s\.? small[- ]cap|russell ?2000/i, 'us small-cap equity'],
    [/u\.?s\.? mid[- ]cap/i, 'us mid-cap equity'],
    [/dividend/i, 'us dividend equity'],
    [/health ?care/i, 'us healthcare sector'],
    [/financials?/i, 'us financials sector'],
    [/energy/i, 'us energy sector'],
    [/global ex.*aggregate/i, 'global ex-us aggregate bonds'],
    [/global aggregate bonds/i, 'global aggregate bonds'],
    [/global government bonds/i, 'global government bonds'],
    [/global corporate bonds/i, 'global corporate bonds'],
    [/aggregate|us core bond|us investment grade bond/i, 'us aggregate bonds'],
    [/long[- ]term.*treasur/i, 'long-term us treasuries'],
    [/short[- ]term.*treasur/i, 'short-term us treasuries'],
    [/intermediate.*treasur/i, 'intermediate us treasuries'],
    [/u\.?s\.? cash|t[- ]?bill|treasury bill/i, 'cash / very short-term treasuries'],
    [/treasur/i, 'us government bonds'],
    [/u\.?s\.? (investment[- ]grade )?corporate bonds?|u\.?s\.? credit/i, 'us investment-grade corporate bonds'],
    [/high[- ]yield/i, 'us high-yield bonds'],
    [/u\.?s\.? equities/i, 'us large-cap equity'],
    [/global reit/i, 'global reits'],
    [/u\.?s\.? reit/i, 'us reits'],
    [/commodit/i, 'commodities'],
    [/\bgold\b/i, 'gold'],
    [/tips/i, 'us tips'],
    [/mbs|mortgage-backed/i, 'us mortgage-backed securities'],
    [/europe|european equities/i, 'european equities'],
    [/japan/i, 'japanese equities'],
    [/china equities/i, 'china equities'],
    [/uk equities|u\.?k\.? gilts/i, 'uk equities'],
    [/u\.?s\.? dollar/i, 'us dollar']
  ];
  function normalizeAssetClass(raw) {
    var s = clean(raw).toLowerCase();
    if (!s) return '';
    for (var i = 0; i < ASSET_ALIASES.length; i++) {
      if (ASSET_ALIASES[i][0].test(s)) return ASSET_ALIASES[i][1];
    }
    return s;
  }

  // ETF -> benchmark exposure. `fallback` is used ONLY when no
  // forecast exists for the ETF's own asset class, and is always
  // labelled `proxy` wherever it appears. A sector ETF is never
  // silently treated as broad equity.
  var ETF_MAP = {
    VOO:  { asset: 'us large-cap equity', benchmark: 'S&P 500', fallback: null },
    QQQM: { asset: 'us large-cap growth / technology-heavy equity', benchmark: 'Nasdaq-100', fallback: 'us large-cap equity' },
    VTI:  { asset: 'us total market equity', benchmark: 'CRSP US Total Market', fallback: 'us large-cap equity' },
    VXUS: { asset: 'ex-us equity', benchmark: 'FTSE Global All Cap ex US', fallback: null },
    VT:   { asset: 'global equity', benchmark: 'FTSE Global All Cap', fallback: null },
    SCHD: { asset: 'us dividend equity', benchmark: 'Dow Jones U.S. Dividend 100', fallback: 'us large-cap equity' },
    IWM:  { asset: 'us small-cap equity', benchmark: 'Russell 2000', fallback: 'us large-cap equity' },
    XLV:  { asset: 'us healthcare sector', benchmark: 'S&P 500 Health Care Select Sector', fallback: 'us large-cap equity' },
    XLF:  { asset: 'us financials sector', benchmark: 'S&P 500 Financials Select Sector', fallback: 'us large-cap equity' },
    XLE:  { asset: 'us energy sector', benchmark: 'S&P 500 Energy Select Sector', fallback: 'us large-cap equity' },
    BND:  { asset: 'us aggregate bonds', benchmark: 'Bloomberg U.S. Aggregate', fallback: null },
    SGOV: { asset: 'cash / very short-term treasuries', benchmark: 'ICE 0-3 Month Treasury', fallback: null },
    BIL:  { asset: 'cash / very short-term treasuries', benchmark: 'Bloomberg 1-3 Month T-Bill', fallback: null }
  };

  // ------------------------------------------------------------------
  // Cohorts: group first by horizon, currency, return definition and
  // gross/net. Forecasts from different cohorts are never averaged
  // together.
  // ------------------------------------------------------------------
  function cohortKey(r) {
    return [horizonKey(r),
      r.currency || 'unspecified currency', r.return_basis || 'unspecified basis',
      r.gross_net || 'unspecified gross/net'].join(' | ');
  }
  function cohortLabel(r) {
    return horizonLabel(r) +
      ' · ' + (r.currency || '?') + ' · ' + (r.return_basis || '?') + ' · ' + (r.gross_net || '?');
  }
  function buildCohorts(records) {
    var map = {};
    records.forEach(function (r) {
      var k = cohortKey(r);
      if (!map[k]) map[k] = { key: k, label: cohortLabel(r), records: [], forecasts: [], qualitative: [] };
      map[k].records.push(r);
      if (r.record_type === 'return_forecast') map[k].forecasts.push(r);
      else map[k].qualitative.push(r);
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    // Longest horizon first is not meaningful; sort by label for stability.
    list.sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    return list;
  }

  // Find the forecast for one ETF inside one cohort. Returns
  // { recs, via: 'direct' | 'proxy', directInstitutions, proxyNote }
  // or null. Sector ETFs fall back to broad US equity only as an
  // explicit, labelled proxy. Directness can be per-institution
  // (etf_mapping.csv: only State Street rows are direct for VOO,
  // only Vanguard rows for VXUS) — portfolioExpectedReturn applies
  // that rule per institution.
  function forecastForETF(cohort, sym) {
    var m = liveETFMap()[sym];
    if (!m) return null;
    function matchRecs(assetNorm) {
      return cohort.forecasts.filter(function (r) {
        return r.returnMid !== null && (r.asset_norm === assetNorm || r.benchmark_norm === assetNorm);
      });
    }
    var direct = m.asset ? matchRecs(m.asset) : [];
    if (direct.length) return { recs: direct, via: m.via || 'direct', directInstitutions: m.directInstitutions || null, proxyNote: m.mappingNote || null };
    if (m.fallback) {
      var prox = matchRecs(m.fallback);
      if (prox.length) return { recs: prox, via: 'proxy', directInstitutions: null, proxyNote: m.mappingNote || ('No ' + m.asset + ' forecast in this cohort; using ' + m.fallback + ' as a proxy.') };
    }
    return null;
  }

  // Portfolio expected return for one institution inside one cohort.
  // Only ETFs with an eligible forecast count; covered weight is
  // reported beside the number and uncovered ETFs are listed, never
  // silently rescaled.
  function portfolioExpectedReturn(cohort, institution, weights) {
    var total = 0, covered = 0, used = 0, uncovered = [], proxyUsed = [];
    Object.keys(weights).forEach(function (sym) {
      var w = weights[sym];
      if (!w) return;
      var found = forecastForETF(cohort, sym);
      if (!found) { uncovered.push(sym); return; }
      var recs = found.recs.filter(function (r) { return r.institution === institution; });
      if (!recs.length) { uncovered.push(sym); return; }
      // One institution can publish several rows for one class (e.g.
      // a range split); average them only inside the same institution
      // and cohort — never across institutions.
      var avg = recs.reduce(function (a, r) { return a + r.returnMid; }, 0) / recs.length;
      total += w * avg;
      covered += w;
      used++;
      var viaInst = found.via;
      if (viaInst === 'direct' && found.directInstitutions && found.directInstitutions.indexOf(institution) < 0) viaInst = 'proxy';
      if (viaInst === 'proxy') proxyUsed.push(sym);
    });
    // sleeveReturn = the covered holdings' own expected return
    // (weights renormalized within the covered sleeve, disclosed);
    // contribution = what the covered holdings add to the whole
    // portfolio. The uncovered part is never silently filled in.
    return { sleeveReturn: covered > 0 ? total / covered : null,
      contribution: covered > 0 ? total : null, coveredWeight: covered, usedETFs: used,
      uncovered: uncovered, proxyUsed: proxyUsed };
  }

  // ------------------------------------------------------------------
  // Scenario categories (from the instructions). A scenario row is
  // matched by keywords in its `scenario` field; unmatched rows are
  // listed separately as "other published scenarios", not forced in.
  // ------------------------------------------------------------------
  var SCENARIOS = [
    { id: 'ai-boom', label: 'AI / technology investment boom', test: /ai.*(boom|investment|buildout|capex)|technology investment boom/i },
    { id: 'ai-disappointment', label: 'AI valuation or earnings disappointment', test: /ai.*(disappoint|valuation|earnings|correction|bubble)/i },
    { id: 'higher-for-longer', label: 'Higher-for-longer interest rates', test: /higher[- ]for[- ]longer|rates? (stay|remain|higher)|rate.*elevated/i },
    { id: 'risk-premium', label: 'Higher U.S. risk premium', test: /risk premium/i },
    { id: 'recession', label: 'Recession / earnings contraction', test: /recession|earnings contraction|growth slowdown|hard landing/i },
    { id: 'energy-inflation', label: 'Energy supply shock / renewed inflation', test: /energy.*(supply|shock)|renewed inflation|oil (shock|spike)|inflation (shock|resurgence)/i },
    { id: 'usd', label: 'U.S. dollar appreciation or depreciation', test: /dollar|usd|fx| currency/i }
  ];
  function matchScenario(text) {
    var s = clean(text);
    if (!s) return null;
    for (var i = 0; i < SCENARIOS.length; i++) {
      if (SCENARIOS[i].test.test(s)) return SCENARIOS[i];
    }
    return { id: 'other', label: 'Other: ' + s };
  }
  var DIRECTION_LABEL = { positive: 'Positive', negative: 'Negative', mixed: 'Mixed', neutral: 'Neutral', unknown: 'Unknown' };
  var DIRECTION_MARK = { positive: '▲', negative: '▼', mixed: '◆', neutral: '–', unknown: '?' };
  function directionOf(rec) {
    var d = (rec.view_direction || '').toLowerCase();
    if (DIRECTION_LABEL[d]) return d;
    var v = (rec.view_rating || '').toLowerCase();
    if (/overweight|positive|bullish/.test(v)) return 'positive';
    if (/underweight|negative|bearish/.test(v)) return 'negative';
    if (/mixed/.test(v)) return 'mixed';
    if (/neutral|equal/.test(v)) return 'neutral';
    return 'unknown';
  }

  // ------------------------------------------------------------------
  // Four files. Recognition: filename first, header signature second.
  // If the two disagree, the file still goes in its filename slot but
  // the mismatch is reported in the preview — never silently re-filed.
  // ------------------------------------------------------------------
  var FILE_DEFS = {
    asset_forecasts: {
      label: 'asset_forecasts.csv', inferType: 'return_forecast',
      hint: 'Institutional expected returns, volatility, asset classes, forecast horizons.',
      needs: ['expected_return_pct', 'volatility_pct']
    },
    tactical_views: {
      label: 'tactical_views.csv', inferType: 'qualitative_view',
      hint: 'Short-term institutional views: Overweight / Neutral / Underweight.',
      needs: ['view_rating', 'view_direction']
    },
    scenario_assumptions: {
      label: 'scenario_assumptions.csv', inferType: 'qualitative_view',
      hint: 'Institutional macroeconomic scenarios and expected market impacts.',
      needs: ['scenario']
    },
    source_register: {
      label: 'source_register.csv', inferType: null, isRegister: true,
      hint: 'Report sources: publication dates, URLs, page references, verification status.',
      needs: ['source_url']
    },
    etf_mapping: {
      label: 'etf_mapping.csv', inferType: null, isMapping: true,
      hint: 'ETF to forecast asset class: mapping type and confidence.',
      needs: ['recommended_forecast_asset_class', 'mapping_type']
    }
  };
  var FILE_ORDER = ['asset_forecasts', 'tactical_views', 'scenario_assumptions', 'source_register', 'etf_mapping'];

  function detectFileKind(filename, headers) {
    var name = (filename || '').toLowerCase();
    var has = function (c) { return headers.indexOf(c) >= 0; };
    var byName = null;
    if (/asset[-_ ]?forecast/.test(name)) byName = 'asset_forecasts';
    else if (/tactical/.test(name)) byName = 'tactical_views';
    else if (/scenario/.test(name)) byName = 'scenario_assumptions';
    else if (/etf[-_ ]?mapping/.test(name)) byName = 'etf_mapping';
    else if (/source[-_ ]?register|sources/.test(name)) byName = 'source_register';
    var byHeaders = null;
    if (has('recommended_forecast_asset_class')) byHeaders = 'etf_mapping';
    else if (has('scenario_name') || has('scenario')) byHeaders = 'scenario_assumptions';
    else if (has('view_rating') || has('view_direction')) byHeaders = 'tactical_views';
    else if (has('expected_return_pct') || has('volatility_pct') || has('expected_volatility_pct')) byHeaders = 'asset_forecasts';
    else if ((has('source_url') || has('original_source_url')) && !has('asset_class') && !has('expected_return_pct')) byHeaders = 'source_register';
    return { kind: byName || byHeaders, byName: byName, byHeaders: byHeaders };
  }

  // ------------------------------------------------------------------
  // Source register: report-level metadata, not observations. A
  // register entry is keyed by institution + report_title. Extra
  // columns (e.g. page references, if the generating AI adds them)
  // are kept on the entry as `extra` and shown — never dropped.
  // ------------------------------------------------------------------
  function ingestSourceRegister(text, sourceLabel) {
    var rep = {
      source: sourceLabel, fileKind: 'source_register', imported: 0, rejected: 0, skipped: 0,
      duplicates: [], conflicts: [], rejectedRows: [], entries: [],
      warnings: [], error: null, unrecognizedColumns: []
    };
    var parsed = parseCSV(text);
    if (parsed.error) { rep.error = parsed.error; return rep; }
    var headers = parsed.headers;
    var known = ['institution', 'report_title', 'publication_date', 'data_as_of_date',
      'source_url', 'source_notes', 'data_quality', 'verified_on', 'verification_status',
      'report_type', 'horizons_covered', 'pdf_url', 'date_accessed',
      'relevant_pages', 'data_extracted', 'limitations'];
    rep.unrecognizedColumns = headers.filter(function (h) {
      return known.indexOf(h) < 0 && known.indexOf(HEADER_ALIASES[h] || h) < 0;
    });
    if (headers.indexOf('institution') < 0 || headers.indexOf('report_title') < 0) {
      rep.error = 'source_register.csv needs institution and report_title columns.';
      return rep;
    }
    var idx = {};
    headers.forEach(function (h, i) {
      var canonical = HEADER_ALIASES[h] || h;
      if (idx[canonical] === undefined) idx[canonical] = i;
    });
    function col(r, name) { return idx[name] === undefined ? '' : r[idx[name]]; }
    var seen = {};
    parsed.rows.forEach(function (r, ri) {
      var lineNo = ri + 2;
      if (!r.length || r.every(function (c) { return String(c).trim() === ''; })) { rep.skipped++; return; }
      var extra = {};
      headers.forEach(function (h, i) { if (known.indexOf(h) < 0 && known.indexOf(HEADER_ALIASES[h] || h) < 0) extra[h] = clean(r[i]); });
      var e = {
        institution: clean(col(r, 'institution')),
        report_title: clean(col(r, 'report_title')),
        publication_date: clean(col(r, 'publication_date')),
        data_as_of_date: clean(col(r, 'data_as_of_date')),
        source_url: clean(col(r, 'source_url')),
        source_notes: clean(col(r, 'source_notes')),
        data_quality: clean(col(r, 'data_quality')),
        verified_on: clean(col(r, 'verified_on')),
        verification_status: clean(col(r, 'verification_status')),
        report_type: clean(col(r, 'report_type')),
        horizons_covered: clean(col(r, 'horizons_covered')),
        pdf_url: clean(col(r, 'pdf_url')),
        date_accessed: clean(col(r, 'date_accessed')),
        relevant_pages: clean(col(r, 'relevant_pages')),
        data_extracted: clean(col(r, 'data_extracted')),
        limitations: clean(col(r, 'limitations')),
        extra: extra, _line: lineNo
      };
      if (!e.institution || !e.report_title) {
        rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: 'institution or report_title is blank' }); return;
      }
      var key = e.institution + '|' + e.report_title;
      if (seen[key]) {
        var prev = seen[key];
        if (prev.source_url === e.source_url && prev.publication_date === e.publication_date) {
          rep.skipped++; rep.duplicates.push({ line: lineNo, key: key });
        } else { rep.rejected++; rep.conflicts.push({ line: lineNo, key: key, keptLine: prev._line }); }
        return;
      }
      seen[key] = e;
      rep.entries.push(e);
      rep.imported++;
    });
    return rep;
  }

  function ingestFile(text, filename) {
    var parsed = parseCSV(text);
    if (parsed.error) return { error: parsed.error, fileKind: null, filename: filename };
    var det = detectFileKind(filename, parsed.headers);
    if (!det.kind) {
      return { error: 'Cannot recognize this file: its name and columns match none of the four files (asset_forecasts, tactical_views, scenario_assumptions, source_register).', fileKind: null, filename: filename };
    }
    var def = FILE_DEFS[det.kind];
    var rep;
    if (def.isRegister) rep = ingestSourceRegister(text, filename);
    else if (def.isMapping) rep = ingestETFMapping(text, filename);
    else rep = ingestCSV(text, filename, { inferType: def.inferType, fileLabel: filename, fileKind: det.kind });
    rep.detected = det;
    if (det.byName && det.byHeaders && det.byName !== det.byHeaders) {
      rep.warnings.unshift('Filename says ' + det.byName + ' but the columns look like ' + det.byHeaders + '. Filed under the filename — check the file if that is wrong.');
    }
    var missingNeeds = def.needs.filter(function (c) { return parsed.headers.indexOf(c) < 0; });
    if (missingNeeds.length) {
      rep.warnings.unshift('Expected column(s) missing for ' + det.kind + ': ' + missingNeeds.join(', ') + '. Rows that need them were rejected or flagged.');
    }
    return rep;
  }

  // ------------------------------------------------------------------
  // ETF mapping file: the documented ETF -> forecast asset class map,
  // with mapping type and confidence. The analyzer's ETF map is built
  // from this file when present; the hardcoded ETF_MAP below is only
  // the fallback for when the file is absent.
  // ------------------------------------------------------------------
  function ingestETFMapping(text, sourceLabel) {
    var rep = {
      source: sourceLabel, fileKind: 'etf_mapping', imported: 0, rejected: 0, skipped: 0,
      duplicates: [], conflicts: [], rejectedRows: [], entries: [],
      warnings: [], error: null, unrecognizedColumns: []
    };
    var parsed = parseCSV(text);
    if (parsed.error) { rep.error = parsed.error; return rep; }
    var headers = parsed.headers;
    var known = ['etf', 'fund_name', 'official_benchmark', 'primary_exposure',
      'recommended_forecast_asset_class', 'mapping_type', 'mapping_confidence',
      'fund_doc_source', 'verification_status', 'notes'];
    rep.unrecognizedColumns = headers.filter(function (h) { return known.indexOf(h) < 0; });
    if (headers.indexOf('etf') < 0 || headers.indexOf('recommended_forecast_asset_class') < 0 ||
      headers.indexOf('mapping_type') < 0) {
      rep.error = 'etf_mapping.csv needs etf, recommended_forecast_asset_class and mapping_type columns.';
      return rep;
    }
    var idx = {};
    headers.forEach(function (h, i) { idx[h] = i; });
    function col(r, name) { return idx[name] === undefined ? '' : r[idx[name]]; }
    var seen = {};
    parsed.rows.forEach(function (r, ri) {
      var lineNo = ri + 2;
      if (!r.length || r.every(function (c) { return String(c).trim() === ''; })) { rep.skipped++; return; }
      var rawType = clean(col(r, 'mapping_type'));
      var type = /NONE/i.test(rawType) ? 'none' : /^direct/i.test(rawType) ? 'direct' : /proxy/i.test(rawType) ? 'proxy' : 'other';
      var fc = clean(col(r, 'recommended_forecast_asset_class'));
      var e = {
        etf: clean(col(r, 'etf')).toUpperCase(),
        fund_name: clean(col(r, 'fund_name')),
        benchmark: clean(col(r, 'official_benchmark')),
        exposure: clean(col(r, 'primary_exposure')),
        forecast_class: fc,
        forecast_class_norm: /NONE/i.test(fc) ? '' : normalizeAssetClass(fc),
        mapping_type_raw: rawType,
        mapping_type: type,
        confidence: clean(col(r, 'mapping_confidence')),
        fund_doc_source: clean(col(r, 'fund_doc_source')),
        verification_status: clean(col(r, 'verification_status')),
        notes: clean(col(r, 'notes')),
        _line: lineNo
      };
      if (!e.etf || !fc) {
        rep.rejected++; rep.rejectedRows.push({ line: lineNo, reason: 'etf or recommended_forecast_asset_class is blank' }); return;
      }
      if (seen[e.etf]) {
        var prev = seen[e.etf];
        if (prev.forecast_class === e.forecast_class && prev.mapping_type === e.mapping_type) {
          rep.skipped++; rep.duplicates.push({ line: lineNo, key: e.etf });
        } else { rep.rejected++; rep.conflicts.push({ line: lineNo, key: e.etf, keptLine: prev._line }); }
        return;
      }
      seen[e.etf] = e;
      rep.entries.push(e);
      rep.imported++;
    });
    return rep;
  }

  // Documented per-institution rules from etf_mapping.csv notes:
  // VOO — State Street S&P 500 rows are direct; Vanguard 'U.S.
  // large-cap' (Russell-1000) and JPM rows are proxies. VXUS —
  // Vanguard Global ex-U.S. is direct; other institutions' ex-U.S.
  // rows are proxies.
  var MAPPING_DIRECT_ONLY = {
    VOO: ['State Street Investment Management'],
    VXUS: ['Vanguard']
  };
  function buildETFMap() {
    var map = {};
    Object.keys(ETF_MAP).forEach(function (s) { map[s] = Object.assign({}, ETF_MAP[s]); });
    var f = state.files.etf_mapping;
    if (!f || !f.report || !f.report.entries) return map;
    f.report.entries.forEach(function (e) {
      var sym = e.etf;
      if (!map[sym]) map[sym] = { asset: '', benchmark: e.benchmark || '', fallback: 'us large-cap equity' };
      map[sym].benchmark = e.benchmark || map[sym].benchmark;
      map[sym].confidence = e.confidence;
      map[sym].mappingNote = e.notes;
      map[sym].mappingType = e.mapping_type;
      if (e.mapping_type === 'none') {
        map[sym].asset = '';
        map[sym].via = 'none';
      } else {
        map[sym].asset = e.forecast_class_norm || '';
        map[sym].via = e.mapping_type;
      }
      if (MAPPING_DIRECT_ONLY[sym]) map[sym].directInstitutions = MAPPING_DIRECT_ONLY[sym];
      if (e.mapping_type === 'proxy' || e.mapping_type === 'none') map[sym].fallback = 'us large-cap equity';
    });
    return map;
  }
  // Rebuilt on every use (7 rows — negligible cost), so a re-imported
  // mapping file takes effect immediately with no cache to clear.
  function liveETFMap() { return buildETFMap(); }

  // ------------------------------------------------------------------
  // State: one slot per file. Re-uploading a file replaces ONLY that
  // file's records, and only after the preview shows the diff.
  // ------------------------------------------------------------------
  var state = { files: {}, sources: [], prevSummary: null };
  // Dedup identity is the PUBLISHED identity (raw asset class +
  // benchmark + horizon years), not the normalized bucket: two rows
  // the institution published separately — e.g. Vanguard 'U.S.
  // equities' (Russell 1000) vs 'U.S. equities (broad market)'
  // (MSCI), or State Street 'Global equities (ACWI)' vs '(World)' —
  // are two forecasts, not a conflict, even though they normalize to
  // the same class.
  var recordKey = function (r) {
    return [r.institution, r.report_title, r.asset_class, r.benchmark_index, horizonKey(r), r.horizon_years_raw || '', r.record_type, r.scenario].join('|');
  };
  function diffRecords(oldRecs, newRecs) {
    var oldMap = {}, newMap = {};
    oldRecs.forEach(function (r) { oldMap[recordKey(r)] = r; });
    newRecs.forEach(function (r) { newMap[recordKey(r)] = r; });
    var added = [], removed = [], changed = [], unchanged = 0;
    Object.keys(newMap).forEach(function (k) {
      if (!oldMap[k]) added.push(newMap[k]);
      else {
        var a = oldMap[k], b = newMap[k];
        if (a.expected_return === b.expected_return && a.expected_low === b.expected_low &&
          a.expected_high === b.expected_high && a.volatility === b.volatility &&
          a.view_direction === b.view_direction && a.view_rating === b.view_rating) unchanged++;
        else changed.push({ from: a, to: b });
      }
    });
    Object.keys(oldMap).forEach(function (k) { if (!newMap[k]) removed.push(oldMap[k]); });
    return { added: added, removed: removed, changed: changed, unchanged: unchanged };
  }
  function allRecords() {
    var out = [];
    FILE_ORDER.forEach(function (k) {
      var f = state.files[k];
      if (f && f.report && f.report.records) out = out.concat(f.report.records);
    });
    return out;
  }
  function allSources() { return state.sources; }
  // Source lookup: exact (institution + report_title) first. The
  // register's titles are often shorter forms of the titles used in
  // the data files, so a second pass matches within the same
  // institution on normalized titles (parentheticals stripped) when
  // one contains the other. Anything still unmatched is listed in
  // the ingestion report — never silently linked to the wrong report.
  function normTitle(s) {
    return (s || '').toLowerCase().replace(/\([^)]*\)/g, '')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Institution names keep their parentheticals: the data files
  // sometimes name the reproducing unit in parens, and that is
  // exactly what identifies the firm ('... (reproduced by Goldman
  // Sachs Asset Management)').
  function normInst(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function sourceLookup() {
    var exact = {}, byInst = {};
    state.sources.forEach(function (e) {
      exact[e.institution + '|' + e.report_title] = { entry: e, method: 'exact' };
      (byInst[e.institution] = byInst[e.institution] || []).push(e);
    });
    return {
      find: function (institution, reportTitle) {
        var k = institution + '|' + reportTitle;
        if (exact[k]) return exact[k];
        var cands = byInst[institution] || [];
        if (!cands.length) {
          // The data files sometimes name a longer institution form
          // (e.g. 'Goldman Sachs Global Investment Research
          // (reproduced by Goldman Sachs Asset Management)') than
          // the register ('Goldman Sachs Asset Management'). Accept
          // a containing institution within the same firm family.
          var ni = normInst(institution);
          Object.keys(byInst).forEach(function (inst) {
            var nj = normInst(inst);
            if (ni && nj && (ni.indexOf(nj) >= 0 || nj.indexOf(ni) >= 0)) cands = cands.concat(byInst[inst]);
          });
        }
        var nt = normTitle(reportTitle);
        if (!nt) return null;
        for (var i = 0; i < cands.length; i++) {
          var nr = normTitle(cands[i].report_title);
          if (!nr) continue;
          if (nt.indexOf(nr) >= 0 || nr.indexOf(nt) >= 0) return { entry: cands[i], method: 'title match' };
        }
        return null;
      }
    };
  }
  function summarizeState() {
    var recs = allRecords();
    var insts = {}, assets = {}, horizons = {};
    recs.forEach(function (r) {
      insts[r.institution] = true; assets[r.asset_norm || '(no asset class)'] = true;
      horizons[r.horizon_label || 'unspecified'] = true;
    });
    return { records: recs.length, institutions: Object.keys(insts).length,
      assetClasses: Object.keys(assets).length, horizons: Object.keys(horizons).length,
      sources: state.sources.length };
  }

  // ------------------------------------------------------------------
  // Small helpers.
  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pctFmt(x) {
    if (typeof fmtPct === 'function') return fmtPct(x);
    return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  }
  function pctPlain(x) {
    if (typeof fmtPctPlain === 'function') return fmtPctPlain(x);
    return (x * 100).toFixed(1) + '%';
  }
  function shortAsset(assetNorm) {
    var m = {
      'us large-cap equity': 'US large-cap', 'us large-cap growth / technology-heavy equity': 'Nasdaq-100 / growth',
      'us total market equity': 'US total market', 'global equity': 'Global equity',
      'ex-us equity': 'Ex-US equity', 'us small-cap equity': 'US small-cap',
      'us dividend equity': 'US dividend', 'us healthcare sector': 'Healthcare',
      'us financials sector': 'Financials', 'us energy sector': 'Energy',
      'us aggregate bonds': 'US agg bonds', 'cash / very short-term treasuries': 'Cash / T-bills'
    };
    return m[assetNorm] || assetNorm || '(no asset class)';
  }
  function shortInst(name) {
    var m = { 'J.P. Morgan': 'JPM', 'JPMorgan': 'JPM', 'BlackRock': 'BLK', 'Vanguard': 'VAN', 'PGIM': 'PGIM', 'State Street': 'SST', 'Goldman Sachs': 'GS', 'Morgan Stanley': 'MS' };
    return m[name] || name;
  }

  // ------------------------------------------------------------------
  // Rendering. All three charts read only imported institutional data
  // (plus, for chart 2's optional proxy column, historical prices —
  // labelled as such). Nothing is plotted from a missing value.
  // ------------------------------------------------------------------
  var selectedCohort = null;
  var showProxy = false;
  var outlookPoints = [];
  var portBarData = null;

  function currentCohorts() { return buildCohorts(allRecords()); }
  function currentCohort() {
    var cohorts = currentCohorts();
    if (!cohorts.length) return null;
    var found = null;
    cohorts.forEach(function (c) { if (c.key === selectedCohort) found = c; });
    if (found) return found;
    // Default: the cohort with the most numeric forecasts.
    var best = cohorts[0];
    cohorts.forEach(function (c) { if (c.forecasts.length > best.forecasts.length) best = c; });
    selectedCohort = best.key;
    return best;
  }
  function setHTML(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }

  function renderStatus() {
    var lines = FILE_ORDER.map(function (k) {
      var f = state.files[k];
      if (!f) return '<tr><td>' + FILE_DEFS[k].label + '</td><td>Not loaded</td><td>—</td></tr>';
      var r = f.report;
      var count = r.fileKind === 'source_register' ? (r.entries ? r.entries.length : 0) + ' sources'
        : r.fileKind === 'etf_mapping' ? (r.entries ? r.entries.length : 0) + ' ETF mappings'
        : r.imported + ' records';
      var extra = r.error ? ' — error: ' + esc(r.error) : '';
      return '<tr><td>' + FILE_DEFS[k].label + '</td><td>' + count + '</td><td>' + esc(f.loadedAt || '') + extra + '</td></tr>';
    }).join('');
    setHTML('instStatusBody', lines);
    var s = summarizeState();
    var lookup = sourceLookup();
    var unregistered = 0, titleMatch = 0;
    allRecords().forEach(function (r) {
      var hit = lookup.find(r.institution, r.report_title);
      if (!hit) unregistered++;
      else if (hit.method === 'title match') titleMatch++;
    });
    var mapCount = (state.files.etf_mapping && state.files.etf_mapping.report && state.files.etf_mapping.report.entries)
      ? state.files.etf_mapping.report.entries.length : 0;
    setText('instSummary', s.records + ' institutional records · ' + s.institutions + ' institutions · ' +
      s.assetClasses + ' asset classes · ' + s.horizons + ' horizons · ' + s.sources + ' sources in register' +
      (mapCount ? ' · ' + mapCount + ' ETF mappings' : '') +
      (titleMatch ? ' · ' + titleMatch + ' record(s) linked to the register by title match' : '') +
      (unregistered ? ' · ' + unregistered + ' record(s) cite a report not in the source register' : ''));
  }

  function renderCohortButtons() {
    var cohorts = currentCohorts();
    var wrap = $('instCohortRow');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!cohorts.length) {
      wrap.innerHTML = '<span class="note">No cohorts yet — load the CSV files first.</span>';
      return;
    }
    cohorts.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label + ' (' + c.forecasts.length + ' forecasts)';
      if (currentCohort() && c.key === currentCohort().key) b.className = 'on';
      b.addEventListener('click', function () { selectedCohort = c.key; renderAll(); });
      wrap.appendChild(b);
    });
  }

  // --- Chart 1: Institutional Asset Outlook -------------------------
  function renderOutlook() {
    var cohort = currentCohort();
    var canvas = $('instOutlook');
    outlookPoints = [];
    if (!cohort) {
      setText('instOutlookNote', 'No institutional data loaded yet. The outlook appears once asset_forecasts.csv is imported.');
      setHTML('instReturnOnlyBody', ''); setHTML('instViewsBody', '');
      setHTML('instUnverifiedBody', ''); setHTML('instPriceTargetBody', '');
      if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    // Charts show VERIFIED_PRIMARY total-return forecasts only.
    // NEEDS_VERIFICATION rows and index price targets (price return
    // only, dividends excluded) are listed separately, never plotted.
    var plottable = [], returnOnly = [], unverified = [], priceTargets = [];
    cohort.forecasts.forEach(function (r) {
      if (isPriceTarget(r)) { priceTargets.push(r); return; }
      if (!isVerified(r)) { unverified.push(r); return; }
      if (r.returnMid === null) return;
      if (r.volatility !== null) plottable.push(r);
      else returnOnly.push(r);
    });
    outlookPoints = plottable.map(function (r) {
      return { name: shortInst(r.institution) + ' · ' + shortAsset(r.asset_norm),
        kind: 'etf', vol: r.volatility, ann: r.returnMid, rec: r };
    });
    if (typeof drawScatterChart === 'function' && canvas) drawScatterChart(canvas, outlookPoints);
    setText('instOutlookNote', cohort.label + ' — ' + plottable.length + ' verified forecast(s) with both return and volatility plotted. ' +
      returnOnly.length + ' verified forecast(s) have a return but no volatility and are listed below, not plotted. ' +
      (unverified.length ? unverified.length + ' forecast(s) are awaiting verification and are not plotted. ' : '') +
      (priceTargets.length ? priceTargets.length + ' index price target(s) are not total returns and are not plotted. ' : '') +
      'Returns are ' + (cohort.records[0] && cohort.records[0].return_basis ? cohort.records[0].return_basis : 'as published') +
      ' over the stated horizon — a 10-year assumption is not a 12-month forecast.');
    setHTML('instReturnOnlyBody', returnOnly.map(function (r) {
      var ret = r.fromRange
        ? pctPlain(r.expected_low) + ' – ' + pctPlain(r.expected_high) + ' (range midpoint ' + pctFmt(r.returnMid) + ')'
        : pctFmt(r.returnMid);
      return '<tr><td>' + esc(r.institution) + '</td><td>' + esc(shortAsset(r.asset_norm)) + '</td><td>' + ret +
        '</td><td>Volatility not supplied</td><td>' + esc(r.report_title) + ' · ' + esc(r.publication_date) + '</td></tr>';
    }).join('') || '<tr><td colspan="5">None — every verified forecast in this cohort supplies volatility.</td></tr>');
    setHTML('instViewsBody', cohort.qualitative.map(function (r) {
      return '<tr><td>' + esc(r.institution) + '</td><td>' + esc(shortAsset(r.asset_norm)) + '</td><td>' +
        esc(r.view_rating || DIRECTION_LABEL[directionOf(r)]) + ' (' + DIRECTION_LABEL[directionOf(r)] + ')' +
        '</td><td>' + esc(r.report_title) + ' · ' + esc(r.publication_date) + '</td></tr>';
    }).join('') || '<tr><td colspan="4">No qualitative views in this cohort.</td></tr>');
    setHTML('instUnverifiedBody', unverified.map(function (r) {
      var ret = r.returnMid !== null ? pctFmt(r.returnMid) : '—';
      return '<tr><td>' + esc(r.institution) + '</td><td>' + esc(shortAsset(r.asset_norm)) + '</td><td>' + ret +
        '</td><td>' + esc(r.verification_status || 'unverified') + '</td><td>' + esc(r.report_title) + ' · ' + esc(r.publication_date) + '</td></tr>';
    }).join('') || '<tr><td colspan="5">None in this cohort.</td></tr>');
    setHTML('instPriceTargetBody', priceTargets.map(function (r) {
      var lvl = r.target_level !== null ? r.target_level.toLocaleString() : '—';
      return '<tr><td>' + esc(r.institution) + '</td><td>' + esc(shortAsset(r.asset_norm)) + '</td><td>' + lvl +
        '</td><td>' + esc(r.target_date || '') + '</td><td>' + esc(r.report_title) + '</td></tr>';
    }).join('') || '<tr><td colspan="5">None in this cohort.</td></tr>');
  }

  function outlookHoverText(rec) {
    var lines = [
      rec.institution + ' · ' + shortAsset(rec.asset_norm),
      'Expected return: ' + pctFmt(rec.returnMid) + (rec.fromRange ? ' (range midpoint)' : '') +
        (rec.expected_low !== null && rec.expected_high !== null ? ' · range ' + pctPlain(rec.expected_low) + ' – ' + pctPlain(rec.expected_high) : ''),
      'Expected volatility: ' + pctPlain(rec.volatility),
      'Horizon: ' + (rec.horizon_label || rec.horizon_years + ' years') + ' · ' + (rec.currency || '') + ' · ' + (rec.return_basis || '') + ' · ' + (rec.gross_net || ''),
      'Report: ' + rec.report_title + ' · published ' + rec.publication_date + ' · data as of ' + rec.data_as_of_date
    ];
    if (rec.source_url) lines.push('Source: ' + rec.source_url);
    return lines.join(' — ');
  }

  // --- Chart 2: Portfolio Risk–Return Comparison --------------------
  function portfolioList() {
    var list = [];
    if (typeof getWeights === 'function') {
      var gw = getWeights();
      if (gw.sum === 100) list.push({ key: 'current', label: 'Your portfolio (current weights)', w: gw.w });
    }
    if (typeof PRESETS !== 'undefined' && typeof PRESET_ORDER !== 'undefined') {
      PRESET_ORDER.forEach(function (k) {
        var w = {};
        Object.keys(ETF_MAP).forEach(function (s) { w[s] = (PRESETS[k][s] || 0) / 100; });
        list.push({ key: k, label: PRESETS[k].label, w: w });
      });
    }
    return list;
  }
  function proxyVol(weights) {
    // Historical covariance proxy ONLY: realized portfolio volatility
    // from the 72 months in data.js. Labelled everywhere it appears.
    try {
      if (typeof monthlyReturns !== 'function' || typeof statsFromReturns !== 'function' || !window.ETF_DATA) return null;
      var dates = ETF_DATA.dates;
      var rs = monthlyReturns(weights, 0, dates.length - 1);
      if (!rs) return null;
      return statsFromReturns(rs, dates.length - 1).vol;
    } catch (e) { return null; }
  }
  function renderPortfolio() {
    var cohort = currentCohort();
    var canvas = $('instPortBars');
    portBarData = null;
    if (!cohort) {
      setText('instPortNote', 'No institutional data loaded yet.');
      setHTML('instPortBody', '');
      if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    var insts = [];
    cohort.forecasts.forEach(function (r) {
      if (r.returnMid !== null && insts.indexOf(r.institution) < 0) insts.push(r.institution);
    });
    insts.sort();
    var portfolios = portfolioList();
    var rows = [];
    portfolios.forEach(function (p) {
      var perInst = {};
      insts.forEach(function (inst) { perInst[inst] = portfolioExpectedReturn(cohort, inst, p.w); });
      rows.push({ portfolio: p, perInst: perInst });
    });
    portBarData = { rows: rows, insts: insts };
    drawInstBars(canvas, rows, insts);
    // Table: one row per portfolio x institution.
    var html = '';
    rows.forEach(function (row) {
      insts.forEach(function (inst) {
        var r = row.perInst[inst];
        var ret = r.sleeveReturn === null ? 'No usable forecast' : pctFmt(r.sleeveReturn);
        var cov = r.sleeveReturn === null ? '—' : Math.round(r.coveredWeight * 100) + '% covered' +
          (r.uncovered.length ? ' · uncovered: ' + r.uncovered.join(', ') : '') +
          (r.proxyUsed.length ? ' · proxy: ' + r.proxyUsed.join(', ') : '');
        var volCell = 'Not available';
        if (showProxy) {
          var pv = proxyVol(row.portfolio.w);
          volCell = pv === null ? 'Proxy unavailable' : pctPlain(pv) + ' (historical proxy)';
        }
        html += '<tr><td>' + esc(row.portfolio.label) + '</td><td>' + esc(inst) + '</td><td>' + ret +
          '</td><td>' + esc(cov) + '</td><td>' + volCell + '</td><td>' + r.usedETFs + ' ETF(s)</td></tr>';
      });
      // Range across institutions — a range, not a confidence interval.
      var vals = insts.map(function (i) { return row.perInst[i].sleeveReturn; }).filter(function (v) { return v !== null; });
      if (vals.length) {
        html += '<tr><td>' + esc(row.portfolio.label) + '</td><td><strong>Range across institutions</strong></td><td><strong>' +
          pctFmt(Math.min.apply(null, vals)) + ' to ' + pctFmt(Math.max.apply(null, vals)) + '</strong></td><td>' +
          vals.length + ' usable institutional input(s) — range, not a confidence interval</td><td>Not available</td><td>—</td></tr>';
      }
    });
    setHTML('instPortBody', html || '<tr><td colspan="6">No usable institutional forecasts in this cohort.</td></tr>');
    setText('instPortNote', cohort.label + ' — expected returns are the covered holdings’ own annualized return for that horizon. ' +
      'Portfolio volatility is “not available”: no compatible covariance matrix was supplied. ' +
      (showProxy ? 'The proxy column is realized historical volatility (72 months, 2020-10–2026-10), shown separately and labelled as a proxy — it is not a forecast.' :
        'Tick “Show historical covariance proxy” to see realized historical volatility alongside, clearly labelled as a proxy.'));
  }

  // Grouped horizontal bars, black/white like the rest of the site.
  // rows: [{ portfolio, perInst: { inst: { sleeveReturn } } }], insts: [names]
  function drawInstBars(canvas, rows, insts) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (!rows.length || !insts.length) return;
    var shades = ['#fff', '#bbb', '#888', '#666', '#999', '#777'];
    var vals = [];
    rows.forEach(function (row) { insts.forEach(function (i) { var v = row.perInst[i].sleeveReturn; if (v !== null) vals.push(v); }); });
    if (!vals.length) {
      ctx.fillStyle = '#888'; ctx.font = '13px sans-serif';
      ctx.fillText('No usable institutional forecasts in this cohort.', 10, 30);
      return;
    }
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    var pad = (hi - lo) * 0.15 || 0.02; lo -= pad; hi += pad;
    var padL = 170, padR = 70, padT = 12, padB = 22;
    var x = function (v) { return padL + ((v - lo) / (hi - lo)) * (W - padL - padR); };
    var rowH = (H - padT - padB) / rows.length;
    ctx.font = '11px sans-serif';
    ctx.strokeStyle = '#222';
    [lo, 0, hi].forEach(function (v) {
      ctx.beginPath(); ctx.moveTo(x(v), padT); ctx.lineTo(x(v), H - padB); ctx.stroke();
      ctx.fillStyle = '#888'; ctx.fillText(pctPlain(v), x(v) - 14, H - 6);
    });
    rows.forEach(function (row, ri) {
      var y0 = padT + ri * rowH;
      ctx.fillStyle = '#eee';
      ctx.fillText(row.portfolio.label, 8, y0 + rowH / 2 + 4);
      var barH = Math.min(14, (rowH - 8) / Math.max(1, insts.length));
      insts.forEach(function (inst, ii) {
        var v = row.perInst[inst].sleeveReturn;
        var y = y0 + 4 + ii * barH;
        if (v === null) {
          ctx.fillStyle = '#555';
          ctx.fillText('no data', x(0) + 4, y + barH - 3);
          return;
        }
        ctx.fillStyle = shades[ii % shades.length];
        var x0 = Math.min(x(0), x(v)), w = Math.abs(x(v) - x(0));
        ctx.fillRect(x0, y, Math.max(1, w), barH - 2);
        ctx.fillStyle = '#eee';
        ctx.fillText(pctFmt(v), (v >= 0 ? x(v) + 4 : x(v) - 44), y + barH - 3);
      });
    });
    ctx.fillStyle = '#888';
    ctx.fillText('Expected annualized return (' + (currentCohort() ? currentCohort().label.split('·')[0].trim() : '') + ') →', padL, H - 6);
  }

  // --- Chart 3: Scenario Stress Test --------------------------------
  function renderScenarios() {
    var recs = allRecords().filter(function (r) { return r.scenario && r.record_type === 'qualitative_view'; });
    // Columns: asset classes the scenario rows actually cover (plus
    // Broad for asset-less rows). When there are no rows yet, show the
    // seven core classes from the ETF mapping so the shape is visible.
    var assetCols = [];
    recs.forEach(function (r) {
      if (r.asset_norm && assetCols.indexOf(r.asset_norm) < 0) assetCols.push(r.asset_norm);
    });
    if (!assetCols.length) {
      assetCols = ['us large-cap equity', 'us large-cap growth / technology-heavy equity',
        'ex-us equity', 'us aggregate bonds', 'us healthcare sector',
        'us energy sector', 'cash / very short-term treasuries'];
    }
    var head = '<tr><th>Scenario</th>' + assetCols.map(function (a) { return '<th>' + esc(shortAsset(a)) + '</th>'; }).join('') + '<th>Broad / all classes</th></tr>';
    var body = '';
    if (!recs.length) {
      body = '<tr><td colspan="' + (assetCols.length + 2) + '">No institutional scenario commentary imported yet. ' +
        'The seed dataset is expected to add scenario rows in scenario_assumptions.csv — until then, no scenario view is shown rather than an invented one.</td></tr>';
    } else {
      var cats = SCENARIOS.concat([{ id: 'other', label: 'Other published scenarios' }]);
      cats.forEach(function (cat) {
        var cells = assetCols.map(function (a) { return scenarioCell(recs, cat, a); });
        var broad = scenarioCell(recs, cat, '');
        body += '<tr><td>' + esc(cat.label) + '</td>' + cells.join('') + broad + '</tr>';
      });
    }
    setHTML('instScenarioHead', head);
    setHTML('instScenarioBody', body);
    setText('instScenarioNote', 'Qualitative exposure matrix from published institutional scenario commentary. ' +
      'A numeric impact is shown only when the institution explicitly publishes one; otherwise the cell shows direction only. ' +
      'Anything labelled “user-defined illustrative stress assumption” would be the app’s own design, not an institutional forecast — none is used here.');
  }
  function scenarioCell(recs, cat, assetNorm) {
    var matches = recs.filter(function (r) {
      var m = matchScenario(r.scenario);
      if (!m || m.id !== cat.id) return false;
      if (assetNorm === '') return !r.asset_norm;
      return r.asset_norm === assetNorm;
    });
    if (!matches.length) return '<td class="inst-none">No published view</td>';
    var dirs = {};
    matches.forEach(function (r) { dirs[directionOf(r)] = (dirs[directionOf(r)] || 0) + 1; });
    var keys = Object.keys(dirs);
    var dir = keys.length === 1 ? keys[0] : 'mixed';
    var insts = matches.map(function (r) { return shortInst(r.institution); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
    // Numeric impacts are shown only where the institution published
    // one AND the row is VERIFIED_PRIMARY — otherwise direction only.
    var num = '';
    matches.forEach(function (r) {
      if (!isVerified(r)) return;
      if (r.expected_low !== null && r.expected_high !== null) num = ' ' + pctPlain(r.expected_low) + ' to ' + pctPlain(r.expected_high);
      else if (r.returnMid !== null) num = ' ' + pctFmt(r.returnMid);
    });
    var title = matches.map(function (r) { return r.institution + ' — ' + r.report_title + ' (' + r.publication_date + ')'; }).join('; ');
    // Free-text directions ('Higher yields', 'Negative for duration
    // ...') are shown as published, not forced into ▲/▼.
    var dirText = dir === 'unknown'
      ? matches.map(function (r) { return r.view_direction || r.view_rating || ''; }).filter(function (v) { return v; })[0] || 'Direction not stated'
      : DIRECTION_MARK[dir] + ' ' + DIRECTION_LABEL[dir];
    return '<td title="' + esc(title) + '">' + esc(dirText) + ' · ' + esc(insts) + esc(num) + '</td>';
  }

  // --- Ingestion report ----------------------------------------------
  function renderReport(whatChanged) {
    var parts = [];
    FILE_ORDER.forEach(function (k) {
      var f = state.files[k];
      if (!f) { parts.push('<p><strong>' + FILE_DEFS[k].label + ':</strong> not loaded.</p>'); return; }
      var r = f.report;
      if (r.error) { parts.push('<p><strong>' + FILE_DEFS[k].label + ':</strong> error — ' + esc(r.error) + '</p>'); return; }
      var n = r.fileKind === 'source_register' ? (r.entries || []).length + ' sources'
        : r.fileKind === 'etf_mapping' ? (r.entries || []).length + ' ETF mappings'
        : r.imported + ' imported';
      parts.push('<p><strong>' + FILE_DEFS[k].label + ':</strong> ' + n +
        ' · ' + r.rejected + ' rejected · ' + r.skipped + ' skipped (duplicates) · ' + r.conflicts.length + ' conflict(s)' +
        (r.unrecognizedColumns && r.unrecognizedColumns.length ? ' · unrecognized columns: ' + esc(r.unrecognizedColumns.join(', ')) : '') + '</p>');
      r.rejectedRows.slice(0, 5).forEach(function (x) { parts.push('<p class="note">Rejected line ' + x.line + ': ' + esc(x.reason) + '</p>'); });
      r.conflicts.slice(0, 5).forEach(function (x) { parts.push('<p class="note">Conflict line ' + x.line + ' (kept line ' + x.keptLine + '): ' + esc(x.key) + '</p>'); });
      r.warnings.slice(0, 5).forEach(function (w) { parts.push('<p class="note">Warning: ' + esc(w) + '</p>'); });
    });
    // Coverage + gaps.
    var recs = allRecords();
    if (recs.length) {
      var cov = {};
      recs.forEach(function (r) {
        var k = r.institution + ' · ' + horizonLabel(r);
        cov[k] = (cov[k] || 0) + 1;
      });
      parts.push('<p>Coverage: ' + Object.keys(cov).map(function (k) { return esc(k) + ' (' + cov[k] + ')'; }).join('; ') + '</p>');
      var fc = recs.filter(function (r) { return r.record_type === 'return_forecast'; });
      if (fc.length) {
        var verified = fc.filter(isVerified).length;
        var priceTargets = fc.filter(isPriceTarget).length;
        parts.push('<p>Verification: ' + verified + ' of ' + fc.length + ' forecast rows are VERIFIED_PRIMARY; ' +
          (fc.length - verified) + ' are awaiting verification; ' + priceTargets + ' index price target(s) (not total returns).</p>');
      }
      var lookup = sourceLookup();
      var unlinked = {};
      recs.forEach(function (r) { if (!lookup.find(r.institution, r.report_title)) unlinked[r.institution + ' — ' + r.report_title] = true; });
      var unlinkedKeys = Object.keys(unlinked);
      if (unlinkedKeys.length) parts.push('<p>Reports cited by records but not in the source register (' + unlinkedKeys.length + '): ' +
        esc(unlinkedKeys.slice(0, 5).join('; ')) + (unlinkedKeys.length > 5 ? '; …' : '') + '</p>');
      var cohort = currentCohort();
      if (cohort) {
        var gaps = Object.keys(liveETFMap()).filter(function (s) { return !forecastForETF(cohort, s); });
        var noVol = cohort.forecasts.filter(function (r) { return r.returnMid !== null && r.volatility === null; }).length;
        parts.push('<p>Mapping gaps in the selected cohort (' + esc(cohort.label) + '): ' +
          (gaps.length ? 'no forecast for ' + gaps.join(', ') : 'every ETF has a forecast or a labelled proxy') +
          ' · ' + noVol + ' forecast(s) missing volatility · no correlation matrix supplied.</p>');
      }
    } else {
      parts.push('<p>No institutional records yet. Next documents needed (from the agent instructions): the seed CSVs — ' +
        '10-year / 10–15-year numeric assumptions from PGIM, Vanguard and J.P. Morgan (asset_forecasts.csv), ' +
        'November 2026 BlackRock qualitative tactical views (tactical_views.csv), scenario rows (scenario_assumptions.csv), ' +
        'the source register (source_register.csv), and the ETF mapping (etf_mapping.csv). Nothing is shown until those files arrive.</p>');
    }
    if (whatChanged) parts.push('<p><strong>What changed:</strong> ' + esc(whatChanged) + '</p>');
    setHTML('instReport', parts.join(''));
  }

  function renderMapping() {
    var map = liveETFMap();
    var fromFile = state.files.etf_mapping && state.files.etf_mapping.report && state.files.etf_mapping.report.entries;
    var rows;
    if (fromFile && fromFile.length) {
      // Show exactly what etf_mapping.csv says — no hardcoded rows.
      rows = fromFile.map(function (e) {
        var m = map[e.etf] || {};
        var fc = e.forecast_class_norm ? shortAsset(e.forecast_class_norm) : 'No sector forecast';
        var note = e.notes ? ' title="' + esc(e.notes) + '"' : '';
        return '<tr' + note + '><td>' + esc(e.etf) + '</td><td>' + esc(e.benchmark || '—') + '</td><td>' + esc(fc) +
          '</td><td>' + esc(e.mapping_type) + '</td><td>' + esc(e.confidence || '—') + '</td></tr>';
      }).join('');
    } else {
      rows = Object.keys(map).filter(function (s) { return ETFS[s]; }).map(function (sym) {
        var m = map[sym];
        var fc = m.asset ? shortAsset(m.asset) : 'No sector forecast';
        var type = m.mappingType || (m.asset ? 'direct' : 'proxy');
        var conf = m.confidence || '—';
        var note = m.mappingNote ? ' title="' + esc(m.mappingNote) + '"' : '';
        return '<tr' + note + '><td>' + esc(sym) + '</td><td>' + esc(m.benchmark || '—') + '</td><td>' + esc(fc) +
          '</td><td>' + esc(type) + '</td><td>' + esc(conf) + '</td></tr>';
      }).join('');
    }
    setHTML('instMappingBody', rows || '<tr><td colspan="5">No ETF mapping loaded.</td></tr>');
  }

  function renderSources() {
    var rows = state.sources.map(function (e) {
      var link = e.source_url ? '<a href="' + esc(e.source_url) + '" target="_blank" rel="noopener">source</a>' : '—';
      return '<tr><td>' + esc(e.institution) + '</td><td>' + esc(e.report_title) + '</td><td>' +
        esc(e.publication_date || '—') + '</td><td>' + esc(e.verification_status || '—') + '</td><td>' + link + '</td></tr>';
    }).join('');
    setHTML('instSourcesBody', rows || '<tr><td colspan="5">No sources in the register yet.</td></tr>');
  }

  function renderAll(whatChanged) {
    renderStatus();
    renderMapping();
    renderSources();
    renderCohortButtons();
    renderOutlook();
    renderPortfolio();
    renderScenarios();
    renderReport(whatChanged);
  }

  // ------------------------------------------------------------------
  // Upload: preview first, import second. A preview never changes
  // state. Importing a file replaces ONLY that file's records, and the
  // preview shows the exact diff before the button is pressed — no
  // silent overwrites.
  // ------------------------------------------------------------------
  var pending = {};

  function previewHTML(kind, report) {
    if (report.error) return '<p class="error">Cannot import: ' + esc(report.error) + '</p>';
    var n = report.fileKind === 'source_register'
      ? (report.entries || []).length + ' source(s)'
      : report.fileKind === 'etf_mapping'
        ? (report.entries || []).length + ' ETF mapping(s)'
        : report.imported + ' record(s)';
    var html = '<p>Preview: ' + n + ' · ' + report.rejected + ' rejected · ' + report.skipped + ' skipped · ' +
      report.conflicts.length + ' conflict(s).</p>';
    if (report.rejectedRows.length) {
      html += report.rejectedRows.slice(0, 3).map(function (x) {
        return '<p class="note">Rejected line ' + x.line + ': ' + esc(x.reason) + '</p>';
      }).join('');
    }
    if (report.warnings.length) {
      html += report.warnings.slice(0, 3).map(function (w) { return '<p class="note">Warning: ' + esc(w) + '</p>'; }).join('');
    }
    var existing = state.files[kind];
    if (existing && existing.report && !existing.report.error) {
      var d = report.fileKind === 'source_register'
        ? diffRegister(existing.report.entries || [], report.entries || [])
        : report.fileKind === 'etf_mapping'
          ? diffMapping(existing.report.entries || [], report.entries || [])
          : diffRecords(existing.report.records || [], report.records || []);
      html += '<p>Replacing ' + esc(existing.label || FILE_DEFS[kind].label) + ' would: add ' + d.added.length +
        ', remove ' + d.removed.length + ', change ' + d.changed.length + ', keep ' + d.unchanged + '.</p>';
    } else {
      html += '<p>No existing ' + FILE_DEFS[kind].label + ' on the site — this will be the first import.</p>';
    }
    html += '<p class="note">Preview only — nothing has changed yet. Import applies this file alone; the other files are untouched. ' +
      'To make it the site’s saved data, send the CSV to Cléo for the repo.</p>';
    return html;
  }

  function diffMapping(oldEntries, newEntries) {
    var oldMap = {}, newMap = {};
    oldEntries.forEach(function (e) { oldMap[e.etf] = e; });
    newEntries.forEach(function (e) { newMap[e.etf] = e; });
    var added = [], removed = [], changed = [], unchanged = 0;
    Object.keys(newMap).forEach(function (k) {
      if (!oldMap[k]) added.push(newMap[k]);
      else if (oldMap[k].forecast_class === newMap[k].forecast_class && oldMap[k].mapping_type === newMap[k].mapping_type) unchanged++;
      else changed.push({ from: oldMap[k], to: newMap[k] });
    });
    Object.keys(oldMap).forEach(function (k) { if (!newMap[k]) removed.push(oldMap[k]); });
    return { added: added, removed: removed, changed: changed, unchanged: unchanged };
  }
  function diffRegister(oldEntries, newEntries) {
    var key = function (e) { return e.institution + '|' + e.report_title; };
    var oldMap = {}, newMap = {};
    oldEntries.forEach(function (e) { oldMap[key(e)] = e; });
    newEntries.forEach(function (e) { newMap[key(e)] = e; });
    var added = [], removed = [], changed = [], unchanged = 0;
    Object.keys(newMap).forEach(function (k) {
      if (!oldMap[k]) added.push(newMap[k]);
      else if (oldMap[k].source_url === newMap[k].source_url && oldMap[k].publication_date === newMap[k].publication_date) unchanged++;
      else changed.push({ from: oldMap[k], to: newMap[k] });
    });
    Object.keys(oldMap).forEach(function (k) { if (!newMap[k]) removed.push(oldMap[k]); });
    return { added: added, removed: removed, changed: changed, unchanged: unchanged };
  }

  function wireUpload(kind) {
    var input = $('instFile-' + kind);
    var preview = $('instPreview-' + kind);
    var btn = $('instImport-' + kind);
    if (!input || !preview || !btn) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var report = ingestFile(String(reader.result || ''), file.name);
        pending[kind] = { report: report, filename: file.name };
        // The preview must match the file slot: a file whose content
        // is a different kind goes in its own slot, and the user is told.
        var actualKind = report.fileKind || kind;
        if (actualKind !== kind) {
          preview.innerHTML = '<p class="note">This file looks like ' + FILE_DEFS[actualKind].label +
            ', not ' + FILE_DEFS[kind].label + '. Use that file’s import box instead — nothing was imported.</p>' +
            previewHTML(actualKind, report);
          btn.disabled = true;
          pending[kind] = null;
          return;
        }
        preview.innerHTML = previewHTML(kind, report);
        btn.disabled = !!report.error;
        btn.textContent = state.files[kind] ? 'Replace ' + FILE_DEFS[kind].label : 'Import ' + FILE_DEFS[kind].label;
      };
      reader.readAsText(file);
    });
    btn.addEventListener('click', function () {
      var p = pending[kind];
      if (!p || !p.report || p.report.error) return;
      var before = summarizeState();
      var oldLabel = state.files[kind] ? state.files[kind].label : null;
      var d = null;
      if (state.files[kind] && state.files[kind].report && !state.files[kind].report.error) {
        d = p.report.fileKind === 'source_register'
          ? diffRegister(state.files[kind].report.entries || [], p.report.entries || [])
          : p.report.fileKind === 'etf_mapping'
            ? diffMapping(state.files[kind].report.entries || [], p.report.entries || [])
            : diffRecords(state.files[kind].report.records || [], p.report.records || []);
      }
      state.files[kind] = { report: p.report, label: p.filename, loadedAt: new Date().toISOString().slice(0, 10) + ' (uploaded preview)' };
      if (kind === 'source_register') state.sources = p.report.entries || [];
      var after = summarizeState();
      var change = p.filename + ': ' +
        (d ? ('added ' + d.added.length + ', removed ' + d.removed.length + ', changed ' + d.changed.length + ', kept ' + d.unchanged) : 'first import') +
        (oldLabel ? ' (replaced ' + oldLabel + ')' : '') +
        '. Site now holds ' + after.records + ' records from ' + after.institutions + ' institution(s).';
      state.prevSummary = before;
      pending[kind] = null;
      preview.innerHTML = '<p>Imported. ' + esc(change) + '</p>';
      btn.disabled = true;
      btn.textContent = 'Import ' + FILE_DEFS[kind].label;
      input.value = '';
      renderAll(change);
    });
  }

  // ------------------------------------------------------------------
  // Init: try the four repo files first (the durable data), then wire
  // the upload boxes. A missing repo file is an empty slot, not an
  // error — the status panel says which files are missing.
  // ------------------------------------------------------------------
  function loadRepoFiles() {
    if (typeof fetch !== 'function') { renderAll('Could not fetch repo files in this browser.'); return; }
    var jobs = FILE_ORDER.map(function (kind) {
      return fetch(FILE_DEFS[kind].label).then(function (resp) {
        if (!resp.ok) return { kind: kind, missing: true };
        return resp.text().then(function (text) { return { kind: kind, text: text }; });
      }).catch(function () { return { kind: kind, missing: true }; });
    });
    Promise.all(jobs).then(function (results) {
      var loaded = [];
      results.forEach(function (r) {
        if (r.missing) return;
        var report = ingestFile(r.text, FILE_DEFS[r.kind].label);
        if (report.error) {
          state.files[r.kind] = { report: report, label: FILE_DEFS[r.kind].label + ' (repo, failed to parse)', loadedAt: '' };
          return;
        }
        state.files[r.kind] = { report: report, label: FILE_DEFS[r.kind].label + ' (repo)', loadedAt: 'repo file' };
        if (r.kind === 'source_register') state.sources = report.entries || [];
        loaded.push(FILE_DEFS[r.kind].label);
      });
      renderAll(loaded.length ? 'Loaded from repo: ' + loaded.join(', ') + '.' : 'No repo data files found yet — upload the five CSVs below, or send them to Cléo for the repo.');
    });
  }

  function init() {
    FILE_ORDER.forEach(wireUpload);
    var proxy = $('instProxy');
    if (proxy) proxy.addEventListener('change', function () { showProxy = proxy.checked; renderPortfolio(); });
    var weights = $('weights');
    if (weights) weights.addEventListener('input', function () { renderPortfolio(); });
    var presets = $('presetRow');
    if (presets) presets.addEventListener('click', function () { setTimeout(renderPortfolio, 0); });
    var outlook = $('instOutlook');
    if (outlook) outlook.addEventListener('mousemove', function (e) {
      if (!outlookPoints.length) return;
      var rect = e.target.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * e.target.clientWidth;
      var my = (e.clientY - rect.top) / rect.height * e.target.clientHeight;
      var best = null, bestD = 1e9;
      outlookPoints.forEach(function (p) {
        if (p.px === undefined) return;
        var d = (p.px - mx) * (p.px - mx) + (p.py - my) * (p.py - my);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (best && bestD < 900) {
        setText('instOutlookHover', best.name + ': volatility ' + pctPlain(best.vol) + ', expected return ' + pctFmt(best.ann));
        var rec = best.rec;
        var link = rec.source_url ? ' · <a href="' + esc(rec.source_url) + '" target="_blank" rel="noopener">source</a>' : '';
        setHTML('instOutlookDetail', esc(outlookHoverText(rec)) + link);
      }
    });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderOutlook(); renderPortfolio(); }, 150);
    });
    renderAll('Loading repo data files…');
    loadRepoFiles();
  }

  if (typeof document !== 'undefined' && document.getElementById('institutionalForecast')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  // Test seam (node): the pure logic is exported; DOM wiring only runs
  // in a browser with the section present.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseCSV: parseCSV, ingestCSV: ingestCSV, ingestSourceRegister: ingestSourceRegister,
      ingestETFMapping: ingestETFMapping, ingestFile: ingestFile, detectFileKind: detectFileKind,
      buildCohorts: buildCohorts, buildETFMap: buildETFMap, liveETFMap: liveETFMap,
      forecastForETF: forecastForETF, portfolioExpectedReturn: portfolioExpectedReturn,
      normalizeAssetClass: normalizeAssetClass, matchScenario: matchScenario,
      directionOf: directionOf, diffRecords: diffRecords, diffRegister: diffRegister,
      diffMapping: diffMapping, isVerified: isVerified, isPriceTarget: isPriceTarget,
      horizonKey: horizonKey, horizonLabel: horizonLabel, normReturnBasis: normReturnBasis,
      normCurrency: normCurrency, normGrossNet: normGrossNet, parseHorizonYears: parseHorizonYears,
      sourceLookup: sourceLookup, state: state,
      FILE_DEFS: FILE_DEFS, ETF_MAP: ETF_MAP, SCENARIOS: SCENARIOS
    };
  }
})();

// ETF portfolio simulator, monthly rebalancing.
// DATA comes from data.js: { dates: [...], series: {VOO:[...], ...}, META:{...} }
const ETFS = [
  { sym: 'VOO', desc: 'Vanguard S&P 500 ETF' },
  { sym: 'QQQM', desc: 'Invesco NASDAQ 100 ETF' },
  { sym: 'VTI', desc: 'Vanguard Total Stock Market ETF' },
  { sym: 'VXUS', desc: 'Vanguard Total International Stock Index Fund ETF Shares' },
  { sym: 'VT', desc: 'Vanguard Total World Stock Index Fund ETF Shares' },
  { sym: 'SCHD', desc: 'Schwab U.S. Dividend Equity ETF' },
  { sym: 'IWM', desc: 'iShares Russell 2000 ETF' },
  { sym: 'XLV', desc: 'State Street Health Care Select Sector SPDR ETF' },
  { sym: 'XLF', desc: 'State Street Financial Select Sector SPDR ETF' },
  { sym: 'XLE', desc: 'State Street Energy Select Sector SPDR ETF' },
  { sym: 'BND', desc: 'Vanguard Total Bond Market Index Fund ETF Shares' },
  { sym: 'SGOV', desc: 'iShares 0-3 Month Treasury Bond ETF' },
  { sym: 'BIL', desc: 'State Street SPDR Bloomberg 1-3 Month T-Bill ETF' },
];
const PRESETS = {
  voo100: { label: '100% VOO', VOO: 100 },
  'us-intl': { label: 'US + international', VOO: 60, QQQM: 20, VXUS: 20 },
  '6040': { label: '60 / 40 stocks / bonds', VOO: 40, VXUS: 20, BND: 40 },
  tech: { label: 'Tech-heavy', VOO: 30, QQQM: 50, VXUS: 20 },
  conservative: { label: 'Conservative', VOO: 20, VXUS: 10, BND: 40, SGOV: 30 },
};
const PRESET_ORDER = ['voo100', 'us-intl', '6040', 'tech', 'conservative'];
let rangeMonths = 'all';
let chartPoints = [];
let drawdownPoints = [];
let scatterPoints = [];
let lastCompute = null;

function fmtMoney(x) {
  return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(x) {
  const s = (x * 100).toFixed(1);
  return (x >= 0 ? '+' : '') + s + '%';
}
function fmtPctPlain(x) {
  return (x * 100).toFixed(1) + '%';
}

function buildWeights() {
  const wrap = document.getElementById('weights');
  wrap.innerHTML = '';
  const def = { VOO: 40, QQQM: 20, VXUS: 20, BND: 10, SGOV: 10 };
  ETFS.forEach(e => {
    const row = document.createElement('div');
    row.className = 'weight-row';
    row.innerHTML = `<span class="name">${e.sym}</span><span class="desc">${e.desc}</span>` +
      `<input type="number" min="0" max="100" step="1" data-sym="${e.sym}" value="${def[e.sym] || 0}"> %`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input').forEach(inp => inp.addEventListener('input', update));
}

function getWeights() {
  const w = {};
  let sum = 0;
  document.querySelectorAll('#weights input').forEach(inp => {
    const v = parseFloat(inp.value) || 0;
    w[inp.dataset.sym] = v / 100;
    sum += v;
  });
  return { w, sum };
}

function hasSeries(sym, n) {
  const s = window.ETF_DATA && ETF_DATA.series && ETF_DATA.series[sym];
  return !!(s && s.length === n);
}

// Monthly returns for a weight map over dates[start..end]. Returns null if a weighted ETF lacks data.
function monthlyReturns(w, start, end) {
  const dates = ETF_DATA.dates;
  for (const e of ETFS) {
    if (w[e.sym] > 0 && !hasSeries(e.sym, dates.length)) return null;
  }
  const rs = [];
  for (let i = start + 1; i <= end; i++) {
    let r = 0;
    ETFS.forEach(e => {
      if (!w[e.sym]) return;
      const s = ETF_DATA.series[e.sym];
      r += w[e.sym] * (s[i] / s[i - 1] - 1);
    });
    rs.push(r);
  }
  return rs;
}

function statsFromReturns(rs, months) {
  const cum = rs.reduce((a, r) => a * (1 + r), 1) - 1;
  const ann = Math.pow(1 + cum, 12 / months) - 1;
  const mean = rs.reduce((a, r) => a + r, 0) / rs.length;
  const variance = rs.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (rs.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(12);
  return { cum, ann, vol };
}

function compute() {
  const { w, sum } = getWeights();
  const initial = parseFloat(document.getElementById('initial').value) || 0;
  const err = document.getElementById('error');
  const results = document.getElementById('results');
  const sumLine = document.getElementById('sumLine');
  sumLine.textContent = `Total: ${sum}%`;
  sumLine.className = sum === 100 ? '' : 'bad';
  if (sum !== 100 || initial <= 0 || !window.ETF_DATA || !ETF_DATA.dates.length) {
    err.hidden = !(sum !== 100);
    return null;
  }
  const dates = ETF_DATA.dates;
  const end = dates.length - 1;
  const months = rangeMonths === 'all' ? end : Math.min(rangeMonths, end);
  const start = end - months;
  const rs = monthlyReturns(w, start, end);
  if (!rs) {
    err.hidden = false;
    err.textContent = 'Data is missing for one of the ETFs with a weight above 0%.';
    return null;
  }
  err.hidden = true;
  err.textContent = 'Weights do not total 100%. Adjust them to 100% to see results.';
  results.style.opacity = '1';
  // Portfolio values.
  const series = [initial];
  rs.forEach(r => series.push(series[series.length - 1] * (1 + r)));
  const final = series[series.length - 1];
  const st = statsFromReturns(rs, months);
  document.getElementById('finalValue').textContent = fmtMoney(final);
  document.getElementById('initialEcho').textContent = fmtMoney(initial);
  document.getElementById('cumReturn').textContent = fmtPct(st.cum);
  document.getElementById('annReturn').textContent = fmtPct(st.ann);
  document.getElementById('periodLine').textContent =
    `${dates[start]} to ${dates[end]}, ${months} months`;
  document.getElementById('rangeNote').textContent =
    `Data range: ${dates[0]} to ${dates[end]}.`;
  // Per-ETF own cumulative return.
  const tbody = document.querySelector('#etfTable tbody');
  tbody.innerHTML = '';
  ETFS.forEach(e => {
    const s = ETF_DATA.series[e.sym];
    const cr = (s && s.length === dates.length) ? (s[end] / s[start] - 1) : NaN;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${e.sym} · ${e.desc}</td><td>${Math.round(w[e.sym] * 100)}%</td><td>${isNaN(cr) ? '—' : fmtPct(cr)}</td>`;
    tbody.appendChild(tr);
  });
  chartPoints = series.map((v, i) => ({ date: dates[start + i], value: v }));
  // Drawdown.
  let peak = series[0], peakIdx = 0, minDd = 0, troughIdx = 0, peakIdxAtTrough = 0;
  const dds = series.map((v, i) => {
    if (v > peak) { peak = v; peakIdx = i; }
    const dd = v / peak - 1;
    if (dd < minDd) { minDd = dd; troughIdx = i; peakIdxAtTrough = peakIdx; }
    return dd;
  });
  drawdownPoints = dds.map((dd, i) => ({ date: dates[start + i], dd }));
  const peakValue = series[peakIdxAtTrough];
  let recoveryIdx = null;
  for (let i = troughIdx + 1; i < series.length; i++) {
    if (series[i] >= peakValue) { recoveryIdx = i; break; }
  }
  const ddLine = document.getElementById('drawdownLine');
  if (minDd === 0) {
    ddLine.textContent = 'Max drawdown: 0.0% — the portfolio never fell below a previous peak in this period.';
  } else if (recoveryIdx !== null) {
    ddLine.textContent = `Max drawdown: ${fmtPct(minDd)} — peak ${dates[start + peakIdxAtTrough]}, trough ${dates[start + troughIdx]}, recovered ${dates[start + recoveryIdx]}. Peak to trough: ${troughIdx - peakIdxAtTrough} months; trough to recovery: ${recoveryIdx - troughIdx} months; peak to recovery: ${recoveryIdx - peakIdxAtTrough} months.`;
  } else {
    ddLine.textContent = `Max drawdown: ${fmtPct(minDd)} — peak ${dates[start + peakIdxAtTrough]}, trough ${dates[start + troughIdx]}, not yet recovered by ${dates[end]}. Peak to trough: ${troughIdx - peakIdxAtTrough} months; ${end - peakIdxAtTrough} months since the peak.`;
  }
  // Volatility vs 100% VOO.
  const vooW = {}; ETFS.forEach(e => { vooW[e.sym] = e.sym === 'VOO' ? 1 : 0; });
  const vooRs = monthlyReturns(vooW, start, end);
  const vooSt = vooRs ? statsFromReturns(vooRs, months) : null;
  document.getElementById('volPortfolio').textContent = fmtPctPlain(st.vol);
  document.getElementById('volVOO').textContent = vooSt ? fmtPctPlain(vooSt.vol) : '—';
  document.getElementById('volReduction').textContent =
    vooSt ? fmtPctPlain((vooSt.vol - st.vol) / vooSt.vol) : '—';
  // Scatter points: current, presets, single ETFs.
  scatterPoints = [];
  scatterPoints.push({ name: 'Your portfolio', kind: 'current', vol: st.vol, ann: st.ann });
  PRESET_ORDER.forEach(k => {
    const pw = {}; ETFS.forEach(e => { pw[e.sym] = (PRESETS[k][e.sym] || 0) / 100; });
    const prs = monthlyReturns(pw, start, end);
    if (prs) { const ps = statsFromReturns(prs, months); scatterPoints.push({ name: PRESETS[k].label, kind: 'preset', vol: ps.vol, ann: ps.ann }); }
  });
  ETFS.forEach(e => {
    if (!hasSeries(e.sym, dates.length)) return;
    const ew = {}; ETFS.forEach(x => { ew[x.sym] = x.sym === e.sym ? 1 : 0; });
    const ers = monthlyReturns(ew, start, end);
    if (ers) { const es = statsFromReturns(ers, months); scatterPoints.push({ name: e.sym, kind: 'etf', vol: es.vol, ann: es.ann }); }
  });
  const stab = document.querySelector('#scatterTable tbody');
  stab.innerHTML = '';
  scatterPoints.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td>${fmtPctPlain(p.vol)}</td><td>${fmtPct(p.ann)}</td>`;
    stab.appendChild(tr);
  });
  lastCompute = { months, start, end };
  drawChart();
  drawDrawdown();
  drawScatter();
  return { final, cum: st.cum, ann: st.ann, vol: st.vol, months };
}

function setupCanvas(c) {
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

// Shared line-chart renderer: the historical charts and the
// forward-looking projection (polymarket.js) draw through this one
// function, so layout, axes, colors, labels, and tooltips are
// identical and only the data differs. opts: get (p => value,
// default p.value), fmt (axis labels), zeroTop (drawdown: 0 at the
// top, most negative at the bottom), band (forecast growth only:
// [{lo, hi}] aligned with points, drawn as a shaded p10–p90 region
// behind the line), lastDot (growth: dot on the last point).
function drawLineChart(c, points, opts) {
  const { ctx, W, H } = setupCanvas(c);
  if (points.length < 2) return;
  const get = opts.get || (p => p.value);
  const vals = points.map(get);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (opts.band) {
    opts.band.forEach(b => { lo = Math.min(lo, b.lo); hi = Math.max(hi, b.hi); });
  }
  if (opts.zeroTop) hi = 0;
  const padL = 8, padR = 8, padT = 14, padB = 26;
  const x = i => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
  [lo, (lo + hi) / 2, hi].forEach(v => {
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
    ctx.fillText(opts.fmt(v), padL + 2, y(v) - 4);
  });
  const seen = new Set();
  points.forEach((p, i) => {
    const key = p.date.slice(0, 7);
    if ((p.date.slice(5, 7) === '01' || i === 0 || i === points.length - 1) && !seen.has(key)) {
      seen.add(key);
      ctx.fillText(key, Math.min(x(i), W - 58), H - 8);
    }
  });
  if (opts.band) {
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    opts.band.forEach((b, i) => i === 0 ? ctx.moveTo(x(i), y(b.hi)) : ctx.lineTo(x(i), y(b.hi)));
    for (let i = opts.band.length - 1; i >= 0; i--) ctx.lineTo(x(i), y(opts.band[i].lo));
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(x(i), y(get(p))) : ctx.lineTo(x(i), y(get(p))));
  ctx.stroke();
  if (opts.lastDot) {
    const last = points[points.length - 1];
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.arc(x(points.length - 1), y(get(last)), 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 1;
}

function drawChart() {
  drawLineChart(document.getElementById('chart'), chartPoints, { fmt: fmtMoney, lastDot: true });
}

function drawDrawdown() {
  drawLineChart(document.getElementById('drawdownChart'), drawdownPoints, { get: p => p.dd, fmt: fmtPctPlain, zeroTop: true });
}

// Shared scatter renderer: same axes, point styles, labels, and
// colors for the historical chart and the forward-looking projection.
function drawScatterChart(c, points) {
  const { ctx, W, H } = setupCanvas(c);
  if (!points.length) return;
  const padL = 56, padR = 14, padT = 30, padB = 30;
  const vols = points.map(p => p.vol), anns = points.map(p => p.ann);
  const xMax = Math.max(...vols) * 1.08;
  let yMin = Math.min(...anns), yMax = Math.max(...anns);
  const pad = (yMax - yMin) * 0.15 || 0.05;
  yMin -= pad; yMax += pad;
  const x = v => padL + (v / xMax) * (W - padL - padR);
  const y = v => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB);
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
  for (let i = 0; i <= 5; i++) {
    const v = xMax * i / 5;
    ctx.beginPath(); ctx.moveTo(x(v), padT); ctx.lineTo(x(v), H - padB); ctx.stroke();
    ctx.fillText(fmtPctPlain(v), x(v) - 14, H - 10);
  }
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * i / 4;
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
    ctx.fillText(fmtPctPlain(v), 4, y(v) + 4);
  }
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = '#555'; ctx.beginPath(); ctx.moveTo(padL, y(0)); ctx.lineTo(W - padR, y(0)); ctx.stroke();
  }
  // Axis title at the top right, in the margin above the plot — it used
  // to sit on the bottom row, where it painted over the tick labels.
  ctx.fillStyle = '#888';
  ctx.textAlign = 'right';
  ctx.fillText('Annualized volatility →', W - padR, 13);
  ctx.textAlign = 'left';
  const titleW = ctx.measureText('Annualized volatility →').width;
  const occupied = [{ x0: W - padR - titleW, y0: 2, x1: W - padR, y1: 15 }];
  points.forEach(p => {
    p.px = x(p.vol); p.py = y(p.ann);
  });
  points.forEach(p => {
    if (p.kind === 'current') {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.px, p.py, 7, 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'preset') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.px, p.py, 5, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff'; ctx.fillRect(p.px - 3, p.py - 3, 6, 6);
    }
  });
  // Point labels: shift a label up or down when it would cover another
  // label or the axis title (the projected points cluster in a narrow
  // band, so the default position overlaps). Same 11px labels, just
  // placed so nothing is hidden.
  ctx.fillStyle = '#eee'; ctx.font = '11px sans-serif';
  points.forEach(p => {
    const label = p.name;
    const tx = Math.min(p.px + 9, W - 110);
    const w = ctx.measureText(label).width;
    let ty = p.py - 8;
    const overlaps = (y) => occupied.some(b =>
      tx < b.x1 + 2 && tx + w > b.x0 - 2 && y - 11 < b.y1 + 2 && y + 2 > b.y0 - 2);
    let placed = false;
    for (const dy of [0, 13, -13, 26, -26, 39, -39]) {
      const y = ty + dy;
      if (y - 11 < 0 || y > H - 2) continue;
      if (!overlaps(y)) { ty = y; placed = true; break; }
    }
    if (!placed) ty = Math.max(12, Math.min(H - 2, ty));
    occupied.push({ x0: tx, y0: ty - 11, x1: tx + w, y1: ty + 2 });
    ctx.fillText(label, tx, ty);
  });
  c._scatterPoints = points;
}

function drawScatter() {
  drawScatterChart(document.getElementById('scatterChart'), scatterPoints);
}

function update() { compute(); }

document.getElementById('initial').addEventListener('input', update);
document.getElementById('rangeRow').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('#rangeRow button').forEach(b => b.classList.remove('on'));
  e.target.classList.add('on');
  rangeMonths = e.target.dataset.range === 'all' ? 'all' : parseInt(e.target.dataset.range, 10);
  update();
});
document.getElementById('presetRow').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  const p = PRESETS[e.target.dataset.preset];
  document.querySelectorAll('#weights input').forEach(inp => { inp.value = p[inp.dataset.sym] || 0; });
  update();
});
document.getElementById('chart').addEventListener('mousemove', e => {
  if (!chartPoints.length) return;
  const rect = e.target.getBoundingClientRect();
  const i = Math.round(((e.clientX - rect.left) / rect.width) * (chartPoints.length - 1));
  const p = chartPoints[Math.max(0, Math.min(chartPoints.length - 1, i))];
  document.getElementById('hoverLine').textContent = `${p.date}: ${fmtMoney(p.value)}`;
});
document.getElementById('drawdownChart').addEventListener('mousemove', e => {
  if (!drawdownPoints.length) return;
  const rect = e.target.getBoundingClientRect();
  const i = Math.round(((e.clientX - rect.left) / rect.width) * (drawdownPoints.length - 1));
  const p = drawdownPoints[Math.max(0, Math.min(drawdownPoints.length - 1, i))];
  document.getElementById('hoverDrawdownLine').textContent = `${p.date}: ${fmtPct(p.dd)}`;
});
document.getElementById('scatterChart').addEventListener('mousemove', e => {
  if (!scatterPoints.length) return;
  const rect = e.target.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width * e.target.clientWidth;
  const my = (e.clientY - rect.top) / rect.height * e.target.clientHeight;
  let best = null, bestD = 1e9;
  scatterPoints.forEach(p => {
    if (p.px === undefined) return;
    const d = (p.px - mx) * (p.px - mx) + (p.py - my) * (p.py - my);
    if (d < bestD) { bestD = d; best = p; }
  });
  if (best && bestD < 900) {
    document.getElementById('scatterHoverLine').textContent =
      `${best.name}: volatility ${fmtPctPlain(best.vol)}, annualized return ${fmtPct(best.ann)}`;
  }
});
window.addEventListener('resize', () => { drawChart(); drawDrawdown(); drawScatter(); });

buildWeights();
if (window.ETF_DATA && ETF_DATA.META) {
  document.getElementById('sourceLine').textContent =
    `Data source: ${ETF_DATA.META.source}; through ${ETF_DATA.META.asOf}; ${ETF_DATA.META.note}`;
}
update();

// ETF portfolio simulator, monthly rebalancing.
// DATA comes from data.js: { dates: [...], series: {VOO:[...], ...}, META:{...} }
const ETFS = [
  { sym: 'VOO', desc: '标普 500' },
  { sym: 'QQQM', desc: '纳斯达克 100' },
  { sym: 'VXUS', desc: '美国以外股票' },
  { sym: 'BND', desc: '美国综合债券' },
  { sym: 'SGOV', desc: '短期美国国债' },
];
const PRESETS = {
  voo100: { VOO: 100, QQQM: 0, VXUS: 0, BND: 0, SGOV: 0 },
  'us-intl': { VOO: 60, QQQM: 20, VXUS: 20, BND: 0, SGOV: 0 },
  '6040': { VOO: 40, QQQM: 0, VXUS: 20, BND: 40, SGOV: 0 },
  tech: { VOO: 30, QQQM: 50, VXUS: 20, BND: 0, SGOV: 0 },
  conservative: { VOO: 20, QQQM: 0, VXUS: 10, BND: 40, SGOV: 30 },
};
let rangeMonths = 'all';
let chartPoints = [];

function fmtMoney(x) {
  return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(x) {
  const s = (x * 100).toFixed(1);
  return (x >= 0 ? '+' : '') + s + '%';
}

function buildWeights() {
  const wrap = document.getElementById('weights');
  wrap.innerHTML = '';
  const def = { VOO: 40, QQQM: 20, VXUS: 20, BND: 10, SGOV: 10 };
  ETFS.forEach(e => {
    const row = document.createElement('div');
    row.className = 'weight-row';
    row.innerHTML = `<span class="name">${e.sym}</span><span class="desc">${e.desc}</span>` +
      `<input type="number" min="0" max="100" step="1" data-sym="${e.sym}" value="${def[e.sym]}"> %`;
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

function compute() {
  const { w, sum } = getWeights();
  const initial = parseFloat(document.getElementById('initial').value) || 0;
  const err = document.getElementById('error');
  const results = document.getElementById('results');
  const sumLine = document.getElementById('sumLine');
  sumLine.textContent = `合计：${sum}%`;
  sumLine.className = sum === 100 ? '' : 'bad';
  if (sum !== 100 || initial <= 0 || !window.ETF_DATA || !ETF_DATA.dates.length) {
    err.hidden = !(sum !== 100);
    if (sum === 100) results.style.opacity = '0.4';
    return null;
  }
  err.hidden = true;
  results.style.opacity = '1';
  const dates = ETF_DATA.dates;
  const end = dates.length - 1;
  const months = rangeMonths === 'all' ? end : Math.min(rangeMonths, end);
  const start = end - months;
  // Monthly portfolio series, rebalanced monthly.
  const series = [initial];
  for (let i = start + 1; i <= end; i++) {
    let r = 0;
    ETFS.forEach(e => {
      const s = ETF_DATA.series[e.sym];
      if (s && s[i - 1] && s[i]) r += w[e.sym] * (s[i] / s[i - 1] - 1);
    });
    series.push(series[series.length - 1] * (1 + r));
  }
  const final = series[series.length - 1];
  const cum = final / initial - 1;
  const ann = Math.pow(final / initial, 12 / months) - 1;
  document.getElementById('finalValue').textContent = fmtMoney(final);
  document.getElementById('initialEcho').textContent = fmtMoney(initial);
  document.getElementById('cumReturn').textContent = fmtPct(cum);
  document.getElementById('annReturn').textContent = fmtPct(ann);
  document.getElementById('periodLine').textContent =
    `${dates[start]} 至 ${dates[end]}，共 ${months} 个月`;
  document.getElementById('rangeNote').textContent =
    `数据起止：${dates[0]} 至 ${dates[end]}。`;
  // Per-ETF own cumulative return over the same window.
  const tbody = document.querySelector('#etfTable tbody');
  tbody.innerHTML = '';
  ETFS.forEach(e => {
    const s = ETF_DATA.series[e.sym];
    const cr = s ? (s[end] / s[start] - 1) : NaN;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${e.sym} · ${e.desc}</td><td>${Math.round(w[e.sym] * 100)}%</td><td>${fmtPct(cr)}</td>`;
    tbody.appendChild(tr);
  });
  chartPoints = series.map((v, i) => ({ date: dates[start + i], value: v }));
  drawChart();
  return { final, cum, ann, months, series };
}

function drawChart() {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (chartPoints.length < 2) return;
  const vals = chartPoints.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const padL = 8, padR = 8, padT = 14, padB = 26;
  const x = i => padL + (i / (chartPoints.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  // Grid + y labels.
  ctx.strokeStyle = '#222'; ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
  [min, (min + max) / 2, max].forEach(v => {
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
    ctx.fillText(fmtMoney(v), padL + 2, y(v) - 4);
  });
  // X labels: first Jan of each year present, plus start/end.
  const seen = new Set();
  chartPoints.forEach((p, i) => {
    const yr = p.date.slice(0, 4);
    if ((p.date.slice(5, 7) === '01' || i === 0 || i === chartPoints.length - 1) && !seen.has(yr + p.date.slice(5, 7))) {
      seen.add(yr + p.date.slice(5, 7));
      ctx.fillText(p.date.slice(0, 7), Math.min(x(i), W - 58), H - 8);
    }
  });
  // Line.
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
  chartPoints.forEach((p, i) => i === 0 ? ctx.moveTo(x(i), y(p.value)) : ctx.lineTo(x(i), y(p.value)));
  ctx.stroke();
  // End dot.
  const last = chartPoints[chartPoints.length - 1];
  ctx.fillStyle = '#fff'; ctx.beginPath();
  ctx.arc(x(chartPoints.length - 1), y(last.value), 4, 0, Math.PI * 2); ctx.fill();
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
  document.querySelectorAll('#weights input').forEach(inp => { inp.value = p[inp.dataset.sym]; });
  update();
});
document.getElementById('chart').addEventListener('mousemove', e => {
  if (!chartPoints.length) return;
  const rect = e.target.getBoundingClientRect();
  const i = Math.round(((e.clientX - rect.left) / rect.width) * (chartPoints.length - 1));
  const p = chartPoints[Math.max(0, Math.min(chartPoints.length - 1, i))];
  document.getElementById('hoverLine').textContent = `${p.date}：${fmtMoney(p.value)}`;
});
window.addEventListener('resize', drawChart);

buildWeights();
if (window.ETF_DATA && ETF_DATA.META) {
  document.getElementById('sourceLine').textContent =
    `数据来源：${ETF_DATA.META.source}；截至 ${ETF_DATA.META.asOf}；${ETF_DATA.META.note}`;
}
update();

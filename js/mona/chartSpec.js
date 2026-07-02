// js/mona/chartSpec.js — declarative chart/table spec validation + rendering.
// Validation is pure (safe under `node --test`). Rendering (renderChart/renderTable)
// touches Chart.js/DOM only when invoked, never at import time.

const CHART_TYPES = new Set(['line', 'bar', 'stackedBar', 'scatter', 'pie', 'area']);
const MAX_SERIES = 12, MAX_POINTS = 500, MAX_STR = 200, MAX_COLS = 20, MAX_ROWS = 500;

const str = (v, max = MAX_STR) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function validateChartSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec no es objeto'] };
  if (!CHART_TYPES.has(spec.type)) errors.push(`tipo inválido: ${spec.type}`);
  if (!Array.isArray(spec.series) || spec.series.length < 1) errors.push('series requerido');
  else if (spec.series.length > MAX_SERIES) errors.push(`máximo ${MAX_SERIES} series`);
  if (errors.length) return { ok: false, errors };

  // Scatter needs numeric x; category/line/bar/area keep x as-is (string labels
  // like variety names or ranches must survive).
  const xNumeric = spec.type === 'scatter';
  const series = [];
  for (const s of spec.series) {
    if (!Array.isArray(s.points)) { errors.push('serie sin points'); continue; }
    if (s.points.length > MAX_POINTS) { errors.push(`máximo ${MAX_POINTS} puntos por serie`); continue; }
    const points = s.points
      .map(p => ({ x: xNumeric ? num(p.x) : (typeof p.x === 'string' ? p.x.slice(0, MAX_STR) : num(p.x)), y: num(p.y) }))
      .filter(p => p.y !== null && (!xNumeric || p.x !== null));
    series.push({ label: str(s.label) || 'Serie', points });
  }
  if (errors.length) return { ok: false, errors };

  const clean = {
    type: spec.type, title: str(spec.title), xLabel: str(spec.xLabel), yLabel: str(spec.yLabel),
    series, options: sanitizeOptions(spec.options),
  };
  return { ok: true, spec: clean };
}

function sanitizeOptions(o) {
  const out = {};
  if (o && typeof o === 'object') {
    if (typeof o.yMin === 'number') out.yMin = o.yMin;
    if (typeof o.yMax === 'number') out.yMax = o.yMax;
    if (typeof o.showPoints === 'boolean') out.showPoints = o.showPoints;
    if (typeof o.stacked === 'boolean') out.stacked = o.stacked;
  }
  return out;
}

export function validateTableSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['spec no es objeto'] };
  if (!Array.isArray(spec.columns) || spec.columns.length < 1) errors.push('columns requerido');
  else if (spec.columns.length > MAX_COLS) errors.push(`máximo ${MAX_COLS} columnas`);
  if (!Array.isArray(spec.rows)) errors.push('rows requerido');
  else if (spec.rows.length > MAX_ROWS) errors.push(`máximo ${MAX_ROWS} filas`);
  if (errors.length) return { ok: false, errors };

  const columns = spec.columns.map(c => ({
    key: str(c.key, 60), label: str(c.label), unit: c.unit ? str(c.unit, 20) : undefined,
  }));
  const rows = spec.rows.slice(0, MAX_ROWS);
  return { ok: true, spec: { title: str(spec.title), columns, rows } };
}

// ── Rendering (browser only; Chart.js lazy-imported so this file stays
//    import-safe under `node --test`) ──

const PALETTE = [
  '#C4A060', '#DC143C', '#6366F1', '#84CC16', '#F97316', '#22D3EE',
  '#EC4899', '#3B82F6', '#F59E0B', '#14B8A6', '#A78BFA', '#4ADE80',
];

const _instances = {}; // canvasId → Chart instance
let _ChartMod = null;
let _seq = 0;

function themeVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function toChartType(t) {
  if (t === 'stackedBar') return 'bar';
  if (t === 'area') return 'line';
  return t; // line, bar, scatter, pie
}

function buildDatasets(spec) {
  const isXY = spec.type === 'scatter';
  return spec.series.map((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const data = isXY
      ? s.points.map(p => ({ x: p.x, y: p.y }))
      : s.points.map(p => p.y);
    return {
      label: s.label,
      data,
      backgroundColor: spec.type === 'pie' ? PALETTE.map(c => c) : color,
      borderColor: color,
      borderWidth: 2,
      fill: spec.type === 'area',
      tension: spec.type === 'area' || spec.type === 'line' ? 0.25 : 0,
      pointRadius: spec.options?.showPoints === false ? 0 : 3,
    };
  });
}

// Labels come from the first series' x values (categorical/line/bar/area).
function buildLabels(spec) {
  if (spec.type === 'scatter' || spec.type === 'pie') {
    return spec.type === 'pie' ? spec.series.map(s => s.label) : undefined;
  }
  const first = spec.series[0];
  return first ? first.points.map(p => p.x) : [];
}

export async function renderChart(canvasEl, spec) {
  if (!_ChartMod) _ChartMod = (await import('chart.js/auto')).default;
  const Chart = _ChartMod;
  const id = canvasEl.id || (canvasEl.id = `mona-chart-${++_seq}`);
  if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }

  const tickColor = themeVar('--muted', '#888');
  const titleColor = themeVar('--text', '#D8D0C4');
  const gridColor = 'rgba(255,255,255,0.06)';
  const stacked = spec.type === 'stackedBar' || spec.options?.stacked === true;
  const isPie = spec.type === 'pie';

  const datasets = isPie
    ? [{ data: spec.series.map(s => s.points.reduce((a, p) => a + (p.y || 0), 0)), backgroundColor: PALETTE }]
    : buildDatasets(spec);

  const scales = isPie ? {} : {
    x: {
      stacked,
      title: { display: !!spec.xLabel, text: spec.xLabel, color: titleColor, font: { size: 11, family: 'Sackers Gothic Medium' } },
      ticks: { color: tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
      grid: { color: gridColor },
      type: spec.type === 'scatter' ? 'linear' : 'category',
    },
    y: {
      stacked,
      min: spec.options?.yMin, max: spec.options?.yMax,
      title: { display: !!spec.yLabel, text: spec.yLabel, color: titleColor, font: { size: 11, family: 'Sackers Gothic Medium' } },
      ticks: { color: tickColor, font: { size: 9, family: 'Sackers Gothic Medium' } },
      grid: { color: gridColor },
    },
  };

  const config = {
    type: toChartType(spec.type),
    data: { labels: buildLabels(spec), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: {
          display: spec.series.length > 1 || isPie,
          labels: { color: titleColor, font: { size: 10, family: 'Sackers Gothic Medium' }, boxWidth: 12 },
        },
        title: { display: !!spec.title, text: spec.title, color: titleColor, font: { size: 12, family: 'Sackers Gothic Medium' } },
      },
      scales,
    },
  };

  const chart = new Chart(canvasEl, config);
  _instances[id] = chart;
  return chart;
}

export function renderTable(containerEl, spec) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const head = spec.columns.map(c => `<th>${esc(c.label)}${c.unit ? ` <span class="mona-unit">(${esc(c.unit)})</span>` : ''}</th>`).join('');
  const body = spec.rows.map(row => {
    const cells = spec.columns.map(c => {
      const v = Array.isArray(row) ? row[spec.columns.indexOf(c)] : row[c.key];
      return `<td>${esc(v)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  containerEl.innerHTML = `${spec.title ? `<div class="mona-table-title">${esc(spec.title)}</div>` : ''}
    <div class="table-scroll"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function destroyMonaCharts() {
  for (const id of Object.keys(_instances)) {
    try { _instances[id].destroy(); } catch { /* noop */ }
    delete _instances[id];
  }
}

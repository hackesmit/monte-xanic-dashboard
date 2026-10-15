// js/tanques/panelCharts.js - the selected lote's analyses in the tank panel,
// with a link into the Explorador. Bead xd-qrn.7. Spec: state/specs/xd-tanques.
//
// Division of labour (CLAUDE.md):
//   - No Supabase queries live here: the samples arrive already loaded by
//     DataStore (dataLoader.js owns every query). render() reads them off the
//     store it is handed; it never fetches.
//   - No tank semantics are restated here: the stage that decides which picture
//     to draw comes from estado.js, and the empty-tank fallback lote comes from
//     estado.historialTanque. This file only turns a lote's lab samples into a
//     chart/table and draws it.
//
// The pure spec-building (especificacionPanel / serieFermentacion /
// analisisVinoJoven) is import-safe under `node --test`: it pulls in only the
// pure plan/estado helpers, never the DOM, Chart.js or the store. The render
// path lazy-imports the Chart.js renderer and the view router so a test that
// imports the builders never drags either into its graph.

import { historialTanque } from './estado.js';
import { fechaCorta } from './plan.js';

// During these stages the lote is still fermenting, so the useful picture is
// the sugar/temperature time series from the Must samples. After descube (des)
// the wine is made and the latest Young Wine chemistry is what matters.
export const ETAPAS_FERMENTACION = ['rec', 'mac', 'fa'];

// The Young Wine analyses the panel surfaces, in display order. pH and A.T. are
// the core pair; A.V. (volatile acidity) and SO2 show only when the sample
// carries them ("...SO2 if present", SPEC). Azúcar closes the row as a dry
// check. Field names match DataStore.wineRecepcion (js/config.js supabaseToWineJS).
export const ANALISIS_VINO_JOVEN = [
  { campo: 'pH',   etiqueta: 'pH',     unidad: '' },
  { campo: 'at',   etiqueta: 'A.T.',   unidad: 'g/L' },
  { campo: 'av',   etiqueta: 'A.V.',   unidad: 'g/L' },
  { campo: 'so2',  etiqueta: 'SO₂',    unidad: 'mg/L' },
  { campo: 'brix', etiqueta: 'Azúcar', unidad: '°Bx' },
];

const CANVAS_ID = 'tanques-panel-chart';

// A finite number or null: an empty string, a dash, a word like 'n/d' or a
// boolean are "no reading", never 0.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) && v.trim() !== '' ? n : null;
}

// The business day of a sample, as stored ('YYYY-MM-DD' or a timestamp).
function dia(v) {
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

// --- pure spec building ------------------------------------------------------

// Collapse a lote's Must samples into one point per day with the Brix and the
// temperature it carries. A day with no numeric reading at all is dropped; when
// two rows share a day the later-read value for each metric wins. Sorted old to
// new so the fermentation curve reads left to right.
export function serieFermentacion(muestras) {
  const porDia = new Map();
  for (const m of (muestras || [])) {
    const d = dia(m && m.fecha);
    if (!d) continue;
    const brix = num(m.brix);
    const temp = num(m.temp);
    if (brix === null && temp === null) continue;
    const prev = porDia.get(d) || { fecha: d, brix: null, temp: null };
    if (brix !== null) prev.brix = brix;
    if (temp !== null) prev.temp = temp;
    porDia.set(d, prev);
  }
  return [...porDia.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

// A line chart spec for the fermentation series, or null when there is nothing
// numeric to draw. Brix is always the first series; Temperatura is added only
// when at least one day carries it, and over the SAME day axis so the two lines
// stay aligned (Chart.js spans the null gaps).
function specFermentacion(serie, lote) {
  if (!serie.length) return null;
  const eje = serie.map((p) => fechaCorta(p.fecha) || p.fecha);
  const azucar = { label: 'Azúcar (°Bx)', points: serie.map((p, i) => ({ x: eje[i], y: p.brix })) };
  const series = [azucar];
  if (serie.some((p) => p.temp !== null)) {
    series.push({ label: 'Temperatura (°C)', points: serie.map((p, i) => ({ x: eje[i], y: p.temp })) });
  }
  return {
    type: 'line',
    title: `Fermentación · ${lote}`,
    xLabel: '', yLabel: '',
    series,
    options: { showPoints: true },
  };
}

// The latest Young Wine sample that carries any analysis, reduced to the fields
// present on it. Returns null when no Young Wine sample has a single reading.
export function analisisVinoJoven(muestras) {
  const orden = [...(muestras || [])].sort((a, b) => {
    const da = dia(a && a.fecha), db = dia(b && b.fecha);
    return da < db ? 1 : da > db ? -1 : 0;   // newest first
  });
  for (const m of orden) {
    const valores = ANALISIS_VINO_JOVEN
      .map((a) => ({ ...a, valor: num(m[a.campo]) }))
      .filter((a) => a.valor !== null);
    if (valores.length) return { fecha: dia(m.fecha), valores };
  }
  return null;
}

// Decide which picture the panel draws for a lote.
//   - still fermenting + a Brix curve exists -> the fermentation time series
//   - past fermentation + young-wine chemistry recorded -> the latest analyses
//   - past fermentation but every young-wine row is blank -> fall back to the
//     fermentation curve (still the only real, lote-tied series), e.g. H8 today
//   - nothing at all -> empty
export function especificacionPanel({ etapa, muestrasMust, muestrasVinoJoven, lote } = {}) {
  const chartSpec = specFermentacion(serieFermentacion(muestrasMust), lote);
  const analisis = analisisVinoJoven(muestrasVinoJoven);
  const fermentando = ETAPAS_FERMENTACION.includes(etapa);
  if (fermentando && chartSpec) return { modo: 'fermentacion', chartSpec, lote };
  if (analisis) return { modo: 'vino-joven', analisis, lote };
  if (chartSpec) return { modo: 'fermentacion', chartSpec, lote };
  return { modo: 'vacio', lote };
}

// --- render (browser only) ---------------------------------------------------

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Round to at most two decimals without trailing zeros (pH 3.70 -> "3.7").
function fmtValor(n) {
  return Number(n.toFixed(2)).toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

export const PanelCharts = {
  // Called by TanquesView.render() right after it writes the panel HTML, with
  // the derived bodega, the current selection and the store that holds the
  // already-loaded lab samples. One call, no return value.
  render(panelEl, bodega, seleccion, store) {
    if (!panelEl) return;
    const { estado, catalogo, movimientos, sinonimos } = bodega || {};
    const est = (estado || {})[seleccion];

    // Which lote to chart: the tank's primary lote when it holds wine, else the
    // last lote it held (the empty-tank fallback the panel already names). The
    // stage comes from estado; an empty tank has no live stage, so it routes to
    // the young-wine / fallback branch.
    let lote = null;
    let etapa = null;
    if (est && (est.litros || 0) > 0 && (est.partes || []).length) {
      const mayor = [...est.partes].sort((a, b) => (b.litros || 0) - (a.litros || 0))[0];
      lote = mayor && mayor.lot_code;
      etapa = est.etapa || null;
    } else if (catalogo && movimientos) {
      const hist = historialTanque(catalogo, movimientos, seleccion, { sinonimos, incluirAnulados: true });
      const ultimo = [...hist].reverse().find((h) => h.aplicado && !h.anulado && h.lot_code);
      lote = ultimo && ultimo.lot_code;
    }
    if (!lote) return;

    const preferment = (store && store.winePreferment) || [];
    const recepcion = (store && store.wineRecepcion) || [];
    const must = preferment.filter((r) => r && r.codigoBodega === lote);
    const joven = recepcion.filter((r) => r && r.codigoBodega === lote && r.sampleType === 'Young Wine');

    const spec = especificacionPanel({ etapa, muestrasMust: must, muestrasVinoJoven: joven, lote });
    if (spec.modo === 'vacio') return;

    const sec = document.createElement('div');
    sec.className = 'tanques-sec tanques-analisis';

    if (spec.modo === 'fermentacion') {
      sec.innerHTML = '<h3>Análisis del lote</h3>'
        + `<div class="tanques-chart-wrap" style="position:relative;height:180px">`
        + `<canvas id="${CANVAS_ID}"></canvas></div>`
        + this._botonExplorador(lote);
    } else {
      sec.innerHTML = '<h3>Análisis del lote</h3>'
        + `<div class="tanques-p-sub">Vino joven &middot; ${esc(fechaCorta(spec.analisis.fecha) || spec.analisis.fecha)}</div>`
        + '<dl class="tanques-kv">'
        + spec.analisis.valores.map((v) => `<dt>${esc(v.etiqueta)}</dt>`
          + `<dd>${esc(fmtValor(v.valor))}${v.unidad ? ` <small>${esc(v.unidad)}</small>` : ''}</dd>`).join('')
        + '</dl>'
        + this._botonExplorador(lote);
    }

    // Place the analyses near the top of the panel (after the fill bar) rather
    // than below a long history list.
    const ancla = panelEl.querySelector('.tanques-fillbar');
    if (ancla && ancla.parentNode === panelEl) ancla.after(sec);
    else panelEl.appendChild(sec);

    this._wireExplorador(sec, lote);

    if (spec.modo === 'fermentacion') {
      const canvas = sec.querySelector(`#${CANVAS_ID}`);
      if (canvas) {
        import('../mona/chartSpec.js')
          .then((m) => m.renderChart(canvas, spec.chartSpec))
          .catch((e) => console.warn('[tanques] panel chart render failed:', e));
      }
    }
  },

  _botonExplorador(lote) {
    return `<button type="button" class="tanques-route-stop tanques-ir-explorador" data-lote="${esc(lote)}">`
      + `Abrir ${esc(lote)} en el Explorador</button>`;
  },

  // The button opens the Explorador filtered to this lote. The router and the
  // Explorer are lazy-imported so this module stays out of the node test graph.
  _wireExplorador(sec, lote) {
    const btn = sec.querySelector('.tanques-ir-explorador');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const [{ App }, { Explorer }] = await Promise.all([
          import('../app.js'), import('../explorer.js'),
        ]);
        App.setView('explorer');
        Explorer.focusLote(lote);
      } catch (e) {
        console.warn('[tanques] could not open the Explorador:', e);
      }
    });
  },
};

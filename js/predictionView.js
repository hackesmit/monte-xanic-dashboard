// js/predictionView.js
// Renders the Predicción card grid. No math; delegates to Prediction.
// No queries; reads DataStore.berryData and DataStore.harvestTargetOverrides.

import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { Charts } from './charts.js';
import * as Prediction from './prediction.js';
import { resolveValley } from './classification.js';

let activeValley = 'all';

export const PredictionView = {
  mount() {
    const chipBar = document.getElementById('prediccion-valley-chips');
    if (chipBar && !chipBar._wired) {
      chipBar.addEventListener('click', e => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        activeValley = btn.dataset.valley || 'all';
        chipBar.querySelectorAll('.chip').forEach(b =>
          b.classList.toggle('chip-active', b === btn));
        this.render();
      });
      chipBar._wired = true;
    }
    // Wire any link-buttons inside the Predicción view that switch view
    document.querySelectorAll('#view-prediccion .link-button[data-view]')
      .forEach(a => {
        if (a._wired) return;
        a._wired = true;
        a.addEventListener('click', e => {
          e.preventDefault();
          // Dynamic import to avoid a circular dep on app.js boot
          import('./app.js').then(m => m.App.setView(a.dataset.view));
        });
      });
    this.render();
  },

  render() {
    const grid = document.getElementById('prediccion-grid');
    if (!grid) return;
    const today = new Date();
    const currentVintage = today.getFullYear();
    const rubricFor = ({ variety, appellation }) => {
      const valley = resolveValley(appellation);
      const map = CONFIG.varietyRubricMap[valley];
      if (!map) return null;
      const rubricId = map[variety];
      return rubricId ? CONFIG.rubrics[rubricId] : null;
    };
    const valleyFor = ({ appellation }) => {
      const v = resolveValley(appellation);
      return v === 'Valle de Guadalupe' ? 'VDG'
           : v === 'Valle de Ojos Negros' ? 'VON'
           : v === 'Valle de San Vicente' ? 'VSV' : null;
    };
    const results = Prediction.computeAll({
      berryData: DataStore.berryData || [],
      today, currentVintage,
      overrides: DataStore.harvestTargetOverrides || [],
      rubricFor, valleyFor,
    });
    const filtered = activeValley === 'all'
      ? results
      : results.filter(r => r.valley === activeValley);
    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="empty-state">Sin datos para mostrar.</p>';
      return;
    }
    for (const r of filtered) {
      grid.appendChild(this.renderCard(r, today));
    }
  },

  renderCard(r, today) {
    const card = document.createElement('div');
    const p = r.prediction;
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas']
                    .includes(p.reason);
    const isEmpty = p.reason === 'pocos-datos-temporada';
    card.className = 'pred-card'
      + (isAlert ? ' pred-card-alert' : '')
      + (isEmpty ? ' pred-card-empty' : '');

    const dateText = (() => {
      if (isEmpty) return null;
      if (p.reason === 'sin-tendencia-positiva') return 'Sin tendencia';
      if (p.reason === 'antocianinas-estancadas') return 'ANT estancadas';
      if (p.reason === 'no-alcanzar-A') return 'No alcanzará A';
      if (p.reason === 'riesgo-sobremadurez') return 'Riesgo de sobremadurez';
      if (p.reason === 'ya-en-ventana') return 'Ya en ventana';
      if (!p.recommendedDate) return null;
      return p.recommendedDate.toLocaleDateString('es-MX',
        { day: 'numeric', month: 'short' });
    })();

    const badgeClass = (() => {
      if (isAlert) return 'pred-badge pred-badge-warn';
      if (p.label === 'Alta')  return 'pred-badge pred-badge-alta';
      if (p.label === 'Media') return 'pred-badge pred-badge-media';
      return 'pred-badge pred-badge-baja';
    })();
    const badgeText = isAlert ? '⚠ Aviso' : (isEmpty ? '' : p.label);

    const closesText = p.brixWindowCloses
      ? `cierra ${p.brixWindowCloses.toLocaleDateString('es-MX',
          { day: 'numeric', month: 'short' })}`
      : '';
    const horizonDays = p.recommendedDate
      ? Math.max(0, Math.round((p.recommendedDate - today) / 86_400_000))
      : null;

    card.innerHTML = `
      <div class="pred-card-header">
        <div>
          <div style="font-weight:600;font-size:14px">${escapeHtml(r.variety)}</div>
          <div style="font-size:11px;color:#7a7368">${escapeHtml(r.appellation)}</div>
        </div>
        ${badgeText ? `<div class="${badgeClass}">${escapeHtml(badgeText)}</div>` : ''}
      </div>
      ${isEmpty ? `
        <div style="margin:24px 0;text-align:center;color:#9b9388;font-size:12px">
          Pocos datos esta temporada<br>
          <span style="font-size:10px">se requiere n ≥ 2</span>
        </div>` : `
        <div class="pred-card-date">${dateText ? escapeHtml(dateText) : '—'}</div>
        <div class="pred-card-sub">
          ${horizonDays != null ? `±${Math.round(p.bandDays)} d · faltan ${horizonDays} d` : ''}
          ${closesText ? ` · ${closesText}` : ''}
        </div>
        <div style="font-size:9px;color:#7a7368;margin-top:6px">Brix</div>
        <canvas data-axis="brix"></canvas>
        ${r.target.antTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">Antocianinas</div>
          <canvas data-axis="ant"></canvas>` : ''}
        <div class="pred-card-foot">
          <span>Brix <b>${p.brixHoy != null ? p.brixHoy.toFixed(1) : '—'}</b></span>
          <span>ANT <b>${p.antHoy != null ? Math.round(p.antHoy) : '—'}</b></span>
          <span>n=${p.nCurrent} · ${p.V}v</span>
        </div>`}
    `;

    // After insertion, render the canvases. Defer to allow layout.
    if (!isEmpty) {
      requestAnimationFrame(() => {
        const brixCanvas = card.querySelector('canvas[data-axis="brix"]');
        if (brixCanvas) {
          Charts.renderPredictionMini(brixCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'brix');
        }
        const antCanvas = card.querySelector('canvas[data-axis="ant"]');
        if (antCanvas) {
          Charts.renderPredictionMini(antCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ant');
        }
      });
    }
    return card;
  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Rebuild the current-vintage sample array for the chart. computeAll
// consumed berryData and returned a per-group result, but didn't include
// the raw sample list — pull it again from DataStore.
function rebuildCurrent(r) {
  const currentVintage = new Date().getFullYear();
  return (DataStore.berryData || [])
    .filter(row => row.variety === r.variety
                && row.appellation === r.appellation
                && row.vintage === currentVintage
                && Number.isFinite(Number(row.brix)))
    .map(row => ({
      sampleDate: row.sampleDate instanceof Date ? row.sampleDate
                  : new Date(row.sampleDate),
      brix: Number(row.brix),
      ant:  Number(row.tant ?? row.anthocyanins ?? row.ant),
    }))
    .sort((a, b) => a.sampleDate - b.sampleDate);
}

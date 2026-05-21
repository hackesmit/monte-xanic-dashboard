// js/predictionView.js
// Renders the Predicción card grid. No math; delegates to Prediction.
// No queries; reads DataStore.berryData and DataStore.harvestTargetOverrides.

import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { Charts } from './charts.js';
import * as Prediction from './prediction.js';
import { resolveValley } from './classification.js';
import { attachModalHygiene } from './modalHygiene.js';

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
    const grid = document.getElementById('prediccion-grid');
    if (grid && !grid._predDetailWired) {
      grid.addEventListener('click', e => {
        if (e.target.closest('a, button, [data-pred-detail-close]')) return;
        const card = e.target.closest('.pred-card');
        if (!card) return;
        const idx = Array.from(grid.children).indexOf(card);
        if (idx < 0) return;
        const r = this._lastResults?.[idx];
        if (r) this.openDetail(r, new Date());
      });
      grid._predDetailWired = true;
    }
    const detailModal = document.getElementById('pred-detail-modal');
    if (detailModal && !detailModal._predDetailWired) {
      detailModal.addEventListener('click', e => {
        if (e.target.closest('[data-pred-detail-close]')) {
          detailModal.close();
        }
      });
      detailModal._predDetailWired = true;
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
    this._lastResults = filtered;
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
                     'sin-tendencia-positiva', 'antocianinas-estancadas',
                     'ph-excedido', 'ph-temprano', 'riesgo-ph']
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
      if (p.reason === 'ph-excedido') return 'pH excedido';
      if (p.reason === 'ph-temprano') return 'pH temprano';
      if (p.reason === 'riesgo-ph') return 'Riesgo pH';
      if (!p.recommendedDate) return null;
      return p.recommendedDate.toLocaleDateString('es-MX',
        { day: 'numeric', month: 'short' });
    })();
    const dateClass = (p.reason && p.reason !== null)
      ? 'pred-card-status' : 'pred-card-date';

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
        <div class="${dateClass}">${dateText ? escapeHtml(dateText) : '—'}</div>
        <div class="pred-card-sub">
          ${horizonDays != null ? `±${Math.round(p.bandDays)} d · faltan ${horizonDays} d` : ''}
          ${closesText ? ` · ${closesText}` : ''}
        </div>
        <div style="font-size:9px;color:#7a7368;margin-top:6px">Brix</div>
        <div class="pred-mini"><canvas data-axis="brix"></canvas></div>
        ${r.target.antTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">Antocianinas</div>
          <div class="pred-mini"><canvas data-axis="ant"></canvas></div>`
        : r.target.phTarget != null ? `
          <div style="font-size:9px;color:#7a7368;margin-top:4px">pH</div>
          <div class="pred-mini"><canvas data-axis="ph"></canvas></div>` : ''}
        <div class="pred-card-foot">
          <span>Brix <b>${p.brixHoy != null ? p.brixHoy.toFixed(1) : '—'}</b></span>
          ${r.target.antTarget != null
            ? `<span>ANT <b>${p.antHoy != null ? Math.round(p.antHoy) : '—'}</b></span>`
            : `<span>pH <b>${p.phHoy != null ? p.phHoy.toFixed(2) : '—'}</b></span>`}
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
        const phCanvas = card.querySelector('canvas[data-axis="ph"]');
        if (phCanvas) {
          Charts.renderPredictionMini(phCanvas, {
            prediction: p, target: r.target, today,
            current: rebuildCurrent(r),
          }, 'ph');
        }
      });
    }
    return card;
  },

  openDetail(r, today) {
    const modal = document.getElementById('pred-detail-modal');
    if (!modal) return;
    const p = r.prediction;
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas',
                     'ph-excedido', 'ph-temprano', 'riesgo-ph']
                    .includes(p.reason);
    const isEmpty = p.reason === 'pocos-datos-temporada';

    // Header
    modal.querySelector('.pred-detail-variety').textContent = r.variety;
    modal.querySelector('.pred-detail-appellation').textContent = r.appellation;
    const badgeEl = modal.querySelector('.pred-detail-badge');
    badgeEl.className = 'pred-detail-badge ' + (() => {
      if (isAlert) return 'pred-badge pred-badge-warn';
      if (p.label === 'Alta')  return 'pred-badge pred-badge-alta';
      if (p.label === 'Media') return 'pred-badge pred-badge-media';
      return 'pred-badge pred-badge-baja';
    })();
    badgeEl.textContent = isAlert ? '⚠ Aviso' : (isEmpty ? '' : p.label);

    // Status
    const statusEl = modal.querySelector('.pred-detail-status');
    const subEl    = modal.querySelector('.pred-detail-sub');
    const statusText = (() => {
      if (isEmpty) return 'Sin datos suficientes';
      if (p.reason === 'sin-tendencia-positiva') return 'Sin tendencia positiva';
      if (p.reason === 'antocianinas-estancadas') return 'Antocianinas estancadas';
      if (p.reason === 'no-alcanzar-A') return 'No alcanzará calidad A';
      if (p.reason === 'riesgo-sobremadurez') return 'Riesgo de sobremadurez';
      if (p.reason === 'ya-en-ventana') return 'Ya en ventana';
      if (p.reason === 'ph-excedido') return 'pH excedido';
      if (p.reason === 'ph-temprano') return 'pH temprano antes del Brix';
      if (p.reason === 'riesgo-ph') return 'Riesgo: pH apretará la ventana';
      if (p.recommendedDate) {
        return p.recommendedDate.toLocaleDateString('es-MX',
          { weekday: 'long', day: 'numeric', month: 'long' });
      }
      return '—';
    })();
    statusEl.textContent = statusText;
    statusEl.classList.toggle('is-reason', !!p.reason && p.reason !== 'ya-en-ventana');
    const closesText = p.brixWindowCloses
      ? `cierra ${p.brixWindowCloses.toLocaleDateString('es-MX',
          { day: 'numeric', month: 'short' })}`
      : '';
    const horizonDays = p.recommendedDate
      ? Math.max(0, Math.round((p.recommendedDate - today) / 86_400_000))
      : null;
    const subParts = [];
    if (horizonDays != null && !isEmpty) {
      subParts.push(`±${Math.round(p.bandDays)} d · faltan ${horizonDays} d`);
    }
    if (closesText) subParts.push(closesText);
    subEl.textContent = subParts.join(' · ');

    // Targets
    const targetsBody = modal.querySelector('.pred-detail-targets-body');
    targetsBody.innerHTML = '';
    const addRow = (label, value) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value;
      targetsBody.appendChild(dt); targetsBody.appendChild(dd);
    };
    if (r.target.brixLower != null && r.target.brixUpper != null) {
      addRow('Ventana Brix',
        `${r.target.brixLower.toFixed(1)}–${r.target.brixUpper.toFixed(1)} °Bx`);
    }
    if (r.target.brixTarget != null) {
      addRow('Brix objetivo', `${r.target.brixTarget.toFixed(1)} °Bx`);
    }
    if (r.target.antTarget != null) {
      addRow('Antocianinas objetivo', `≥ ${Math.round(r.target.antTarget)} mg/L`);
    }
    if (r.target.phTarget != null && r.target.antTarget == null) {
      addRow('pH tope', `≤ ${r.target.phTarget.toFixed(2)}`);
    }

    // Diagnostic
    const diagBody = modal.querySelector('.pred-detail-diagnostic-body');
    diagBody.innerHTML = '';
    const addDiag = (label, value) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value;
      diagBody.appendChild(dt); diagBody.appendChild(dd);
    };
    if (p.brixHoy != null) {
      addDiag('Brix hoy (ŷ)', `${p.brixHoy.toFixed(2)} °Bx`);
    }
    if (p.brixComb && Number.isFinite(p.brixComb.betaPost)) {
      addDiag('β Brix', `${p.brixComb.betaPost.toFixed(3)} °Bx/día`);
    }
    if (p.antHoy != null && r.target.antTarget != null) {
      addDiag('ANT hoy (ŷ)', `${Math.round(p.antHoy)} mg/L`);
    }
    if (p.antComb && Number.isFinite(p.antComb.betaPost) && r.target.antTarget != null) {
      addDiag('β ANT', `${p.antComb.betaPost.toFixed(2)} mg/L/día`);
    }
    if (p.phHoy != null && r.target.phTarget != null && r.target.antTarget == null) {
      addDiag('pH hoy (ŷ)', `${p.phHoy.toFixed(2)}`);
    }
    if (p.phComb && Number.isFinite(p.phComb.betaPost) && r.target.phTarget != null
        && r.target.antTarget == null) {
      addDiag('β pH', `${p.phComb.betaPost.toFixed(3)} /día`);
    }
    if (Number.isFinite(p.bandDays)) {
      addDiag('Banda confianza (95%)', `±${Math.round(p.bandDays)} días`);
    }
    addDiag('Muestras temporada', `n = ${p.nCurrent}`);
    addDiag('Vintages históricos', `V = ${p.V}`);
    addDiag('Confianza', p.label);

    // Reason block
    const reasonSection = modal.querySelector('.pred-detail-reason');
    const reasonBody = modal.querySelector('.pred-detail-reason-body');
    const reasonExplain = {
      'sin-tendencia-positiva':
        'El Brix no muestra tendencia positiva en las muestras recientes. Revisar muestreo o esperar más datos.',
      'antocianinas-estancadas':
        'Las antocianinas están planas o decrecen. La fruta puede no estar madurando fenólicamente.',
      'no-alcanzar-A':
        'Las antocianinas no alcanzarán el objetivo antes de que el Brix supere el límite alto. La calidad A no es viable este ciclo.',
      'riesgo-sobremadurez':
        'El Brix supera el límite alto antes de que las antocianinas alcancen el objetivo. Considera cosechar antes para evitar sobremadurez.',
      'pocos-datos-temporada':
        'Hay menos de 2 muestras este ciclo. Toma más muestras antes de confiar en una recomendación.',
      'ph-excedido':
        'El pH ya superó el umbral de calidad A. Las uvas se cosecharán en grado B/C.',
      'ph-temprano':
        'El pH cruzará el umbral antes de que el Brix entre en la ventana ideal. Calidad A no es viable este ciclo.',
      'riesgo-ph':
        'El pH apretará la ventana — habrá que cosechar antes del Brix ideal para no perder calidad A.',
    };
    if (reasonExplain[p.reason]) {
      reasonBody.textContent = reasonExplain[p.reason];
      reasonSection.hidden = false;
    } else {
      reasonSection.hidden = true;
    }

    // Charts
    const brixCanvas = modal.querySelector('canvas[data-detail-axis="brix"]');
    const secondaryBlock = modal.querySelector('[data-secondary-block]');
    const secondaryLabel = modal.querySelector('[data-secondary-label]');
    const secondaryCanvasContainer = secondaryBlock?.querySelector('.pred-detail-mini');
    const isRed   = r.target.antTarget != null;
    const isWhite = r.target.phTarget != null && r.target.antTarget == null;
    if (secondaryBlock) {
      secondaryBlock.style.display = (isRed || isWhite) ? '' : 'none';
    }
    if (secondaryLabel) {
      secondaryLabel.textContent = isRed ? 'Antocianinas' : 'pH';
    }
    if (secondaryCanvasContainer) {
      secondaryCanvasContainer.innerHTML =
        `<canvas data-detail-axis="${isRed ? 'ant' : 'ph'}"></canvas>`;
    }
    const secondaryCanvas = secondaryBlock?.querySelector('canvas');

    modal.showModal();
    attachModalHygiene(modal, {
      onDismiss: () => {
        for (const c of [brixCanvas, secondaryCanvas]) {
          if (!c?.id) continue;
          const inst = Charts.instances[c.id];
          if (inst) { inst.destroy(); delete Charts.instances[c.id]; }
        }
      },
    });

    requestAnimationFrame(() => {
      if (brixCanvas) {
        Charts.renderPredictionDetail(brixCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, 'brix');
      }
      if (secondaryCanvas && (isRed || isWhite)) {
        Charts.renderPredictionDetail(secondaryCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, isRed ? 'ant' : 'ph');
      }
    });
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
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
      pH:   Number(row.pH ?? row.ph),
    }))
    .sort((a, b) => a.sampleDate - b.sampleDate);
}

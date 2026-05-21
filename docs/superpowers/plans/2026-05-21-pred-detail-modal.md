# Predicción Detail Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Click any `.pred-card` → open a centered `<dialog>` with enlarged Brix + ANT charts, full target/diagnostic info, with the program's standard motion.

**Architecture:** New `<dialog id="pred-detail-modal" class="row-edit-modal pred-detail-modal">` in index.html. `PredictionView.openDetail(r, today)` fills the modal, instantiates two large charts via a new `Charts.renderPredictionDetail`, and uses the existing `attachModalHygiene` for scroll lock + focus trap + ESC/backdrop close. Animation: CSS `@starting-style` + `transition-behavior: allow-discrete` with existing motion tokens.

**Tech stack:** Vanilla JS ES modules, native `<dialog>`, Chart.js v4, existing modalHygiene module, existing motion tokens.

**Spec source:** brainstorm session in conversation (2026-05-21).

---

## File Structure

| File | Change |
|---|---|
| `index.html` | Add `<dialog id="pred-detail-modal" class="row-edit-modal pred-detail-modal">` shell |
| `js/predictionView.js` | Add `openDetail(r, today)`; wire click handler on `.pred-card`; track current chart instances for cleanup |
| `js/charts.js` | Add `renderPredictionDetail(canvas, ctx, axis)` — mirrors `renderPredictionMini` but with richer tooltip (include weekday) and bigger axes ticks |
| `css/styles.css` | `.pred-detail-modal` (layout + entrance/exit animation), `.pred-detail-grid`, `.pred-detail-mini` wrapper (height:220px), section blocks |

---

## Task 1 — HTML scaffold

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the dialog element**

Find the closing `</dialog>` of the last existing modal (`pref-edit-modal`) in `index.html` (search for `id="pref-edit-modal"`). After that closing `</dialog>`, insert:

```html

  <!-- Predicción — expanded detail modal -->
  <dialog id="pred-detail-modal" class="row-edit-modal pred-detail-modal"
          aria-labelledby="pred-detail-title">
    <button type="button" class="row-edit-close" data-pred-detail-close
            aria-label="Cerrar">×</button>
    <header class="pred-detail-header">
      <div>
        <h2 id="pred-detail-title" class="pred-detail-variety"></h2>
        <div class="pred-detail-appellation"></div>
      </div>
      <div class="pred-detail-badge"></div>
    </header>
    <div class="pred-detail-status"></div>
    <div class="pred-detail-sub"></div>
    <div class="pred-detail-grid">
      <div>
        <div class="pred-detail-axis-label">Brix</div>
        <div class="pred-detail-mini"><canvas data-detail-axis="brix"></canvas></div>
      </div>
      <div data-ant-block>
        <div class="pred-detail-axis-label">Antocianinas</div>
        <div class="pred-detail-mini"><canvas data-detail-axis="ant"></canvas></div>
      </div>
    </div>
    <section class="pred-detail-targets">
      <h3>Objetivos</h3>
      <div class="pred-detail-targets-body"></div>
    </section>
    <section class="pred-detail-diagnostic">
      <h3>Diagnóstico</h3>
      <div class="pred-detail-diagnostic-body"></div>
    </section>
    <section class="pred-detail-reason" hidden>
      <h3>Razón</h3>
      <p class="pred-detail-reason-body"></p>
    </section>
  </dialog>
```

- [ ] **Step 2: Verify by opening dev server**

Run `npm run dev` briefly; confirm no console errors and the dialog is in the DOM (`document.getElementById('pred-detail-modal')` returns the element). Don't try to open it yet — JS isn't wired.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
feat(predictor): add detail modal HTML scaffold

Empty <dialog> placeholder. Wiring (JS + CSS) lands in next commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — CSS: layout + animation

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Add CSS block after the `.pred-mini` rule**

Find the line `.pred-mini        { position: relative; height: 70px; margin-top: 6px; }` and immediately after it, insert:

```css

/* ── Predicción detail modal ─────────────────────────────────────────── */
.pred-detail-modal {
  width: min(880px, 92vw);
  max-height: 90vh;
  padding: 0;
  overflow: hidden;
  border: 1px solid #e6e3dc;
  border-radius: 12px;
  background: #fff;
  /* Animatable closed state — applies when [open] is not present */
  opacity: 0;
  transform: translateY(8px) scale(0.96);
  transition:
    opacity      var(--motion-slow) var(--ease-entrance),
    transform    var(--motion-slow) var(--ease-entrance),
    overlay      var(--motion-slow) allow-discrete,
    display      var(--motion-slow) allow-discrete;
}
.pred-detail-modal[open] {
  opacity: 1;
  transform: translateY(0) scale(1);
}
@starting-style {
  .pred-detail-modal[open] {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
}
.pred-detail-modal::backdrop {
  background: rgba(20, 16, 14, 0.45);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  opacity: 0;
  transition:
    opacity     var(--motion-base) var(--ease-standard),
    overlay     var(--motion-base) allow-discrete,
    display     var(--motion-base) allow-discrete;
}
.pred-detail-modal[open]::backdrop { opacity: 1; }
@starting-style {
  .pred-detail-modal[open]::backdrop { opacity: 0; }
}

.pred-detail-modal > * { padding: 0 24px; }
.pred-detail-modal > .pred-detail-header { padding-top: 24px; }
.pred-detail-modal > section:last-child,
.pred-detail-modal > .pred-detail-grid + section:last-of-type { padding-bottom: 24px; }

.pred-detail-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px; padding-bottom: 4px;
}
.pred-detail-variety {
  margin: 0; font-size: 20px; font-weight: 600; color: #2d2520;
  line-height: 1.2;
}
.pred-detail-appellation {
  margin-top: 4px; font-size: 13px; color: #7a7368;
}
.pred-detail-badge { /* badges reuse .pred-badge classes via JS */ }

.pred-detail-status {
  font-size: 22px; font-weight: 600; color: #5b2d3a;
  margin-top: 14px; line-height: 1.2;
}
.pred-detail-status.is-reason { font-size: 16px; color: #7a4250; }
.pred-detail-sub {
  font-size: 12px; color: #7a7368; margin-top: 4px; padding-bottom: 14px;
}

.pred-detail-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
  padding-bottom: 16px;
}
@media (max-width: 700px) {
  .pred-detail-grid { grid-template-columns: 1fr; }
}
.pred-detail-axis-label {
  font-size: 10px; color: #7a7368; text-transform: uppercase;
  letter-spacing: .04em; margin-bottom: 4px;
}
.pred-detail-mini { position: relative; height: 220px; }

.pred-detail-targets, .pred-detail-diagnostic, .pred-detail-reason {
  border-top: 1px solid #f0ebe4; padding-top: 14px; padding-bottom: 14px;
}
.pred-detail-targets h3, .pred-detail-diagnostic h3, .pred-detail-reason h3 {
  margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase;
  letter-spacing: .05em; color: #5a534a;
}
.pred-detail-targets-body, .pred-detail-diagnostic-body {
  display: grid; grid-template-columns: auto 1fr;
  column-gap: 16px; row-gap: 4px; font-size: 13px; color: #2d2520;
}
.pred-detail-targets-body dt, .pred-detail-diagnostic-body dt {
  color: #7a7368;
}
.pred-detail-reason-body {
  margin: 0; font-size: 13px; line-height: 1.45; color: #5b2d3a;
}

.row-edit-close { /* assumed present — reused */ }
```

If `.row-edit-close` does not exist anywhere in `css/styles.css`, add this rule at the end of the inserted block (check first via `grep -n "row-edit-close" css/styles.css`):

```css
.row-edit-close {
  position: absolute; top: 12px; right: 12px;
  width: 32px; height: 32px; border: none; background: transparent;
  font-size: 20px; line-height: 1; color: #5a534a; cursor: pointer;
  border-radius: 6px; transition: background var(--motion-fast);
}
.row-edit-close:hover { background: #f0ebe4; }
```

- [ ] **Step 2: Smoke check in browser**

Refresh `npm run dev`. In console: `document.getElementById('pred-detail-modal').showModal()` — verify modal opens, centered, with entrance animation. Then `.close()` to dismiss.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add css/styles.css && git commit -m "$(cat <<'EOF'
feat(predictor): style detail modal + entrance animation

Layout: 2-column charts on desktop, single column under 700px. Sections
for targets, diagnostic, reason. Entrance uses @starting-style +
transition-behavior:allow-discrete with --motion-slow / --ease-entrance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Charts: renderPredictionDetail

**Files:**
- Modify: `js/charts.js`

- [ ] **Step 1: Add the new function**

Find `renderPredictionMini(canvas, ctx, axis)` (around line 2670). Just below its closing `};` of the Charts object exit (look for the closing brace before module export OR the last line of the object), find a clean location inside the Charts object. Add this function as a sibling method of `renderPredictionMini`. The implementation reuses the same calculations:

```javascript
  renderPredictionDetail(canvas, ctx, axis) {
    if (!canvas || !ctx) return;
    const { prediction, target, today } = ctx;
    const C = CONFIG.predictionColors;

    const sortedCurrent = ctx.current
      .slice()
      .sort((a, b) => a.sampleDate - b.sampleDate);
    if (sortedCurrent.length === 0) return;
    const dayMs = 86_400_000;
    const t0 = sortedCurrent[0].sampleDate.getTime();
    const dayOf = ms => (ms - t0) / dayMs;
    const observed = sortedCurrent.map(s => ({
      x: dayOf(s.sampleDate.getTime()),
      y: axis === 'brix' ? s.brix : s.ant,
    }));
    const etaDays = axis === 'brix'
      ? prediction.samplesProjected.brixEta
      : prediction.samplesProjected.antEta;
    const horizonDays = Number.isFinite(etaDays) ? Math.max(etaDays + 5, 5) : 21;
    const todayX = dayOf(today.getTime());
    const horizonEndX = todayX + horizonDays;
    const fit = axis === 'brix' ? prediction.brixFit : prediction.antFit;
    const comb = axis === 'brix' ? prediction.brixComb : prediction.antComb;
    if (!fit || !Number.isFinite(comb?.betaPost)) return;
    const tToday = todayX;
    const projAtDays = d => {
      const yhatToday = fit.alpha + fit.beta * tToday;
      return yhatToday + comb.betaPost * d;
    };
    const projection = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      projection.push({ x: todayX + d, y: projAtDays(d) });
    }
    const sigmaY = Math.sqrt(Math.max(0, fit.sigma2));
    const cone = [];
    for (let d = 0; d <= horizonDays; d += 1) {
      const y = projAtDays(d);
      const wY = 1.96 * Math.sqrt(sigmaY * sigmaY + (d * Math.sqrt(comb.sigmaBeta2Post)) ** 2);
      cone.push({ x: todayX + d, yLo: y - wY, yHi: y + wY });
    }

    const targetY = axis === 'brix' ? target.brixTarget : target.antTarget;
    const datasets = [
      { label: 'Banda confianza',
        type: 'line', borderColor: 'transparent',
        backgroundColor: C.cone, fill: '+1',
        data: cone.map(p => ({ x: p.x, y: p.yHi })),
        pointRadius: 0, tension: 0, order: 1 },
      { label: 'Banda inferior',
        type: 'line', borderColor: 'transparent',
        data: cone.map(p => ({ x: p.x, y: p.yLo })),
        pointRadius: 0, tension: 0, order: 1 },
      { label: 'Observado',
        type: 'line', borderColor: C.line, borderWidth: 2,
        backgroundColor: C.line, data: observed,
        pointRadius: 3.5, tension: 0, order: 2 },
      { label: 'Proyección',
        type: 'line', borderColor: C.projection, borderWidth: 2,
        borderDash: [4, 4], data: projection,
        pointRadius: 0, tension: 0, order: 2 },
    ];
    if (targetY != null) {
      datasets.push({
        label: 'Objetivo', type: 'line',
        borderColor: C.target, borderWidth: 1.5, borderDash: [3, 4],
        data: [
          { x: observed[0].x, y: targetY },
          { x: horizonEndX,   y: targetY },
        ],
        pointRadius: 0, tension: 0, order: 0,
      });
    }

    const canvasId = canvas.id || `pred-detail-${axis}-${Math.random().toString(36).slice(2,8)}`;
    if (this.instances[canvasId]) { this.instances[canvasId].destroy(); }
    const unit = axis === 'brix' ? '°Bx' : 'mg/L';
    const fmtVal = v => axis === 'brix'
      ? `${Number(v).toFixed(1)} ${unit}`
      : `${Math.round(Number(v))} ${unit}`;
    const fmtDate = xDays => new Date(t0 + xDays * dayMs)
      .toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
    this.instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        scales: {
          x: { type: 'linear', ticks: { font: { size: 11 } } },
          y: { ticks: { font: { size: 11 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            filter: item => {
              const lbl = item.dataset.label;
              return lbl === 'Observado' || lbl === 'Proyección' || lbl === 'Objetivo';
            },
            callbacks: {
              title: items => fmtDate(items[0].parsed.x),
              label: item => `${item.dataset.label}: ${fmtVal(item.parsed.y)}`,
            },
          },
        },
        animation: { duration: 300 },
      },
    });
  },
```

If placing inside the `Charts` object literal, make sure to add the trailing comma after `renderPredictionMini`'s closing `}`.

- [ ] **Step 2: Verify no test regressions**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && node --test tests/mt23-prediction-model.test.mjs tests/mt24-prediction-resolve.test.mjs tests/mt25-prediction-integration.test.mjs tests/mt26-prediction-backtest.test.mjs tests/mt27-demo-predictor.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/charts.js && git commit -m "$(cat <<'EOF'
feat(predictor): add renderPredictionDetail for the expand modal

Mirrors renderPredictionMini but with bigger ticks (11px), thicker
borders, larger observed-point radius, and richer tooltips that include
the weekday and the target/cone band datasets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — PredictionView: openDetail + click wiring

**Files:**
- Modify: `js/predictionView.js`

- [ ] **Step 1: Add import**

At the top of `js/predictionView.js`, add to the imports:

```javascript
import { attachModalHygiene } from './modalHygiene.js';
```

- [ ] **Step 2: Add `openDetail` method on PredictionView**

Add the method as a sibling of `renderCard`. Insert just before the closing `};` of `export const PredictionView`:

```javascript
  openDetail(r, today) {
    const modal = document.getElementById('pred-detail-modal');
    if (!modal) return;
    const p = r.prediction;
    const isAlert = ['riesgo-sobremadurez', 'no-alcanzar-A',
                     'sin-tendencia-positiva', 'antocianinas-estancadas']
                    .includes(p.reason);
    const isEmpty = p.reason === 'pocos-datos-temporada';

    // Header
    modal.querySelector('.pred-detail-variety').textContent = r.variety;
    modal.querySelector('.pred-detail-appellation').textContent =
      `${r.appellation}${r.valley ? ` (${r.valley})` : ''}`;
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
    if (p.antHoy != null) {
      addDiag('ANT hoy (ŷ)', `${Math.round(p.antHoy)} mg/L`);
    }
    if (p.antComb && Number.isFinite(p.antComb.betaPost)) {
      addDiag('β ANT', `${p.antComb.betaPost.toFixed(2)} mg/L/día`);
    }
    if (Number.isFinite(p.bandDays)) {
      addDiag('Banda confianza (95%)', `±${Math.round(p.bandDays)} días`);
    }
    addDiag('Muestras temporada', `n = ${p.nCurrent}`);
    addDiag('Vintages históricos', `V = ${p.V}`);
    addDiag('Confianza', p.label);

    // Reason block — only show when there's a reason that isn't ya-en-ventana
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
    };
    if (reasonExplain[p.reason]) {
      reasonBody.textContent = reasonExplain[p.reason];
      reasonSection.hidden = false;
    } else {
      reasonSection.hidden = true;
    }

    // Charts — destroy any prior instances under known canvas ids
    const brixCanvas = modal.querySelector('canvas[data-detail-axis="brix"]');
    const antCanvas  = modal.querySelector('canvas[data-detail-axis="ant"]');
    const antBlock   = modal.querySelector('[data-ant-block]');
    if (antBlock) antBlock.style.display = r.target.antTarget != null ? '' : 'none';

    // Open + attach hygiene BEFORE constructing charts so the modal has layout
    modal.showModal();
    attachModalHygiene(modal, {
      onDismiss: () => {
        // Cleanup chart instances on close
        for (const c of [brixCanvas, antCanvas]) {
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
      if (antCanvas && r.target.antTarget != null) {
        Charts.renderPredictionDetail(antCanvas, {
          prediction: p, target: r.target, today,
          current: rebuildCurrent(r),
        }, 'ant');
      }
    });
  },
```

- [ ] **Step 3: Wire click handler on cards**

In `PredictionView.mount()`, where the chip bar is wired (search for `chipBar._wired`), add similar wiring on the grid AFTER the chip-bar block:

```javascript
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
```

Also wire the close button. In the same `mount()` after the grid block, add:

```javascript
    const detailModal = document.getElementById('pred-detail-modal');
    if (detailModal && !detailModal._predDetailWired) {
      detailModal.addEventListener('click', e => {
        if (e.target.closest('[data-pred-detail-close]')) {
          detailModal.close();
        }
      });
      detailModal._predDetailWired = true;
    }
```

- [ ] **Step 4: Persist `_lastResults` so the click handler can find them**

In `render()`, save the filtered results on the view before iterating:

Find:
```javascript
    const filtered = activeValley === 'all'
      ? results
      : results.filter(r => r.valley === activeValley);
    grid.innerHTML = '';
```

Replace with:
```javascript
    const filtered = activeValley === 'all'
      ? results
      : results.filter(r => r.valley === activeValley);
    this._lastResults = filtered;
    grid.innerHTML = '';
```

- [ ] **Step 5: Manual verify in browser**

Run `npm run dev`. Open Predicción with Modo Demo active. Click a card. Verify:
- Modal opens centered, fades in with scale animation
- Header / status / charts / targets / diagnostic / reason populate correctly
- ESC closes; backdrop click closes; X button closes
- Reopening another card works (charts re-instantiate cleanly, no leak)
- White-variety card (no antTarget) hides the ANT chart block

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git add js/predictionView.js && git commit -m "$(cat <<'EOF'
feat(predictor): wire detail modal — openDetail + click delegation

Click any prediction card → opens the detail modal populated with
variety/appellation, status/sub, targets table, diagnostic table,
reason explanation, and two large charts. Reuses attachModalHygiene
for scroll lock + focus trap + ESC/backdrop close. Destroys Chart
instances on close to avoid leaks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Playwright visual verify + push

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && nohup npm run dev > /tmp/vite-verify.log 2>&1 &
sleep 3
```

- [ ] **Step 2: Use Playwright MCP to verify**

Steps in a single browser_evaluate call:
- Set `localStorage.xanic_session_token = 'dev-bypass'`, `localStorage.xanic_role = 'lab'`
- Navigate to `http://localhost:8080/`
- Wait, then activate demo + go to prediccion view
- Click `.pred-card:nth-child(1)`
- Verify modal is `[open]`, has populated header text, both canvases have intrinsic ≥ 200px height (no stretch)
- Press Escape, verify modal closed and chart instances cleaned up

If verification passes, screenshot `pred-detail-verify.png` then delete after viewing.

- [ ] **Step 3: Push**

```bash
cd "/mnt/c/Users/danie/Xanic Dashboard" && git push origin main
```

- [ ] **Step 4: Cleanup**

```bash
pkill -f vite || true
```

- [ ] **Step 5: Report done to user with commit SHAs**

---

## Self-Review

**Spec coverage:**
- Modal scaffold (Task 1) ✓
- Layout + entrance/exit animation with motion tokens (Task 2) ✓
- Large-variant chart renderer (Task 3) ✓
- openDetail + click delegation + modalHygiene + chart cleanup (Task 4) ✓
- Visual verification + push (Task 5) ✓

**Placeholders:** none — every step has exact code or exact command.

**Type consistency:**
- `openDetail(r, today)` signature matches `renderCard(r, today)` ✓
- `Charts.renderPredictionDetail(canvas, ctx, axis)` signature matches `renderPredictionMini` ✓
- `_lastResults` array index = card position in grid (DOM order preserved by render loop) ✓
- `attachModalHygiene(modal, { onDismiss })` matches existing signature in `js/modalHygiene.js` ✓

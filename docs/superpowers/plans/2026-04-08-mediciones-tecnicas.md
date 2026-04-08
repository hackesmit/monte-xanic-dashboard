# Mediciones Tecnicas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Mediciones" view for recording physical berry field measurements (tonnage, berry size/weight, 200-berry health sort) with manual form entry, sortable table, and comparison charts.

**Architecture:** New `js/mediciones.js` module handles form, table, and chart rendering. Data stored in Supabase `mediciones_tecnicas` table. Uses existing auth-gated `/api/upload` endpoint (add table to allowlist). Follows existing patterns: config in `config.js`, queries in `dataLoader.js`, events in `events.js`, routing in `app.js`.

**Tech Stack:** Vanilla JS (ES6), Chart.js 4.4.1 (CDN), Supabase (PostgreSQL)

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `sql/migration_mediciones.sql` | Create `mediciones_tecnicas` table | 1 |
| `api/upload.js` | Add `mediciones_tecnicas` to allowed tables | 2 |
| `js/dataLoader.js` | Add query function + row mapper + state array | 2 |
| `js/mediciones.js` | **New** — form, table, charts for mediciones view | 3, 4, 5 |
| `index.html` | Nav tab + view panel HTML + script tag | 3 |
| `css/styles.css` | Form + health bar styles | 3 |
| `js/app.js` | Routing for `mediciones` view + filter visibility | 6 |
| `js/events.js` | Form submit + table sort event bindings | 6 |

---

## Task 1: SQL Migration

**Files:**
- Create: `sql/migration_mediciones.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Mediciones Tecnicas: physical berry field measurements
CREATE TABLE IF NOT EXISTS mediciones_tecnicas (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medicion_code   TEXT NOT NULL UNIQUE,
  medicion_date   DATE NOT NULL,
  vintage_year    INT NOT NULL,
  variety         TEXT NOT NULL,
  appellation     TEXT NOT NULL,
  lot_code        TEXT,
  tons_received   NUMERIC(8,2),
  berry_count_sample INT,
  berry_avg_weight_g NUMERIC(6,2),
  berry_diameter_mm  NUMERIC(5,2),
  health_grade    TEXT CHECK (health_grade IN ('Excelente','Bueno','Regular','Malo')),
  health_madura   INT DEFAULT 0,
  health_inmadura INT DEFAULT 0,
  health_sobremadura INT DEFAULT 0,
  health_picadura INT DEFAULT 0,
  health_enfermedad INT DEFAULT 0,
  health_quemadura INT DEFAULT 0,
  measured_by     TEXT,
  notes           TEXT,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mediciones_variety ON mediciones_tecnicas(variety);
CREATE INDEX idx_mediciones_date ON mediciones_tecnicas(medicion_date);
CREATE INDEX idx_mediciones_vintage ON mediciones_tecnicas(vintage_year);
```

- [ ] **Step 2: Run in Supabase SQL editor**

Execute the migration in the Supabase dashboard SQL editor. Verify table exists with `SELECT * FROM mediciones_tecnicas LIMIT 1;`.

---

## Task 2: Backend — Upload Allowlist + DataLoader Query

**Files:**
- Modify: `api/upload.js:5-9` — add `mediciones_tecnicas` to `ALLOWED_TABLES`
- Modify: `js/dataLoader.js` — add `medicionesData` array, `_rowToMedicion` mapper, `loadMediciones` query

- [ ] **Step 1: Add table to upload allowlist**

In `api/upload.js`, add to `ALLOWED_TABLES` object:

```javascript
mediciones_tecnicas: { conflict: 'medicion_code', maxRows: 200 },
```

- [ ] **Step 2: Add state array to DataStore**

In `js/dataLoader.js`, after `winePreferment: [],` (line 6), add:

```javascript
medicionesData: [],
```

- [ ] **Step 3: Add row mapper**

In `js/dataLoader.js`, add `_rowToMedicion` method (near the other `_rowTo*` mappers):

```javascript
_rowToMedicion(row) {
  return {
    id: row.id,
    code: row.medicion_code,
    date: row.medicion_date,
    vintage: row.vintage_year,
    variety: row.variety,
    appellation: row.appellation,
    lotCode: row.lot_code,
    tons: row.tons_received ? parseFloat(row.tons_received) : null,
    berryCount: row.berry_count_sample,
    berryWeight: row.berry_avg_weight_g ? parseFloat(row.berry_avg_weight_g) : null,
    berryDiameter: row.berry_diameter_mm ? parseFloat(row.berry_diameter_mm) : null,
    healthGrade: row.health_grade,
    healthMadura: row.health_madura || 0,
    healthInmadura: row.health_inmadura || 0,
    healthSobremadura: row.health_sobremadura || 0,
    healthPicadura: row.health_picadura || 0,
    healthEnfermedad: row.health_enfermedad || 0,
    healthQuemadura: row.health_quemadura || 0,
    measuredBy: row.measured_by,
    notes: row.notes
  };
},
```

- [ ] **Step 4: Add loadMediciones query**

In `js/dataLoader.js`, add a `loadMediciones` method (near the other `load*` methods):

```javascript
async loadMediciones() {
  if (!this.supabase) return;
  try {
    let all = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await this.supabase
        .from('mediciones_tecnicas')
        .select('*')
        .order('medicion_date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) { console.error('[DataStore] mediciones query error:', error); break; }
      if (!data || !data.length) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    this.medicionesData = all.map(r => this._rowToMedicion(r));
  } catch (e) {
    console.error('[DataStore] loadMediciones failed:', e);
  }
},
```

- [ ] **Step 5: Commit**

```bash
git add api/upload.js js/dataLoader.js sql/migration_mediciones.sql
git commit -m "feat: mediciones_tecnicas table + upload allowlist + data loader"
```

---

## Task 3: HTML + CSS — Nav Tab, View Panel, Form

**Files:**
- Modify: `index.html:126` — add nav tab
- Modify: `index.html:683` — add view panel before `</main>`
- Modify: `index.html:772` — add script tag
- Modify: `css/styles.css` — add form + health bar styles

- [ ] **Step 1: Add nav tab**

In `index.html`, after the Explorador nav tab (line 126), add:

```html
<button class="nav-tab" data-view="mediciones">Mediciones</button>
```

- [ ] **Step 2: Add view panel**

In `index.html`, after the MAP VIEW closing `</div>` (line 683) and before `</main>` (line 685), add:

```html
    <!-- ═══════ MEDICIONES VIEW ═══════ -->
    <div id="view-mediciones" class="view-panel">
      <div class="section-label">Mediciones Tecnicas</div>

      <!-- KPIs -->
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-label">Total Mediciones</div><div class="kpi-value" id="med-kpi-count">—</div></div>
        <div class="kpi-card"><div class="kpi-label">Toneladas Totales</div><div class="kpi-value" id="med-kpi-tons">—</div></div>
        <div class="kpi-card"><div class="kpi-label">Peso Prom. Baya</div><div class="kpi-value" id="med-kpi-weight">—</div></div>
        <div class="kpi-card"><div class="kpi-label">% Madura Prom.</div><div class="kpi-value" id="med-kpi-health">—</div></div>
      </div>

      <!-- Entry Form -->
      <div class="section-label" style="margin-top:18px">Nueva Medicion</div>
      <form id="medicion-form" class="medicion-form">
        <div class="form-row">
          <div class="form-group">
            <label>Codigo</label>
            <input type="text" id="med-code" required placeholder="MT-2025-001">
          </div>
          <div class="form-group">
            <label>Fecha</label>
            <input type="date" id="med-date" required>
          </div>
          <div class="form-group">
            <label>Vendimia</label>
            <input type="number" id="med-vintage" required min="2020" max="2030" placeholder="2025">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Variedad</label>
            <select id="med-variety" required></select>
          </div>
          <div class="form-group">
            <label>Origen</label>
            <select id="med-origin" required></select>
          </div>
          <div class="form-group">
            <label>Lote</label>
            <input type="text" id="med-lot" placeholder="CSMX-3A">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Toneladas</label>
            <input type="number" id="med-tons" step="0.01" min="0" placeholder="2.50">
          </div>
          <div class="form-group">
            <label>Peso Prom. Baya (g)</label>
            <input type="number" id="med-weight" step="0.01" min="0" placeholder="1.85">
          </div>
          <div class="form-group">
            <label>Diametro Prom. (mm)</label>
            <input type="number" id="med-diameter" step="0.01" min="0" placeholder="14.2">
          </div>
        </div>

        <div class="section-label" style="margin-top:12px;font-size:11px">Sorteo Sanitario (200 bayas)</div>
        <div class="form-row health-row">
          <div class="form-group form-group-sm">
            <label>Madura</label>
            <input type="number" id="med-h-madura" min="0" value="0">
          </div>
          <div class="form-group form-group-sm">
            <label>Inmadura</label>
            <input type="number" id="med-h-inmadura" min="0" value="0">
          </div>
          <div class="form-group form-group-sm">
            <label>Sobremad.</label>
            <input type="number" id="med-h-sobremadura" min="0" value="0">
          </div>
          <div class="form-group form-group-sm">
            <label>Picadura</label>
            <input type="number" id="med-h-picadura" min="0" value="0">
          </div>
          <div class="form-group form-group-sm">
            <label>Enferm.</label>
            <input type="number" id="med-h-enfermedad" min="0" value="0">
          </div>
          <div class="form-group form-group-sm">
            <label>Quemad.</label>
            <input type="number" id="med-h-quemadura" min="0" value="0">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Grado Sanitario</label>
            <select id="med-grade">
              <option value="">— Seleccionar —</option>
              <option value="Excelente">Excelente</option>
              <option value="Bueno">Bueno</option>
              <option value="Regular">Regular</option>
              <option value="Malo">Malo</option>
            </select>
          </div>
          <div class="form-group">
            <label>Medido por</label>
            <input type="text" id="med-by" placeholder="Nombre">
          </div>
          <div class="form-group">
            <label>Notas</label>
            <input type="text" id="med-notes" placeholder="Observaciones">
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-gold">Guardar Medicion</button>
          <span id="med-form-status" class="form-status"></span>
        </div>
      </form>

      <!-- Charts -->
      <div class="section-label" style="margin-top:24px">Comparaciones</div>
      <div class="charts-grid">
        <div class="chart-card">
          <div class="chart-title">Toneladas por Variedad</div>
          <div class="chart-h chart-h-sm" style="height:280px"><canvas id="chartMedTons"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Peso Baya en Temporada</div>
          <div class="chart-h chart-h-sm" style="height:280px"><canvas id="chartMedWeight"></canvas></div>
        </div>
        <div class="chart-card chart-wide">
          <div class="chart-title">Distribucion Sanitaria por Variedad</div>
          <div class="chart-h chart-h-lg" style="height:320px"><canvas id="chartMedHealth"></canvas></div>
        </div>
      </div>

      <!-- Table -->
      <div class="section-label" style="margin-top:24px">Registro de Mediciones · <span id="med-table-count"></span></div>
      <div class="table-wrap">
        <div class="table-scroll">
          <table class="data-table" id="mediciones-table">
            <thead>
              <tr>
                <th data-sort="code">Codigo</th>
                <th data-sort="date">Fecha</th>
                <th data-sort="variety">Variedad</th>
                <th data-sort="appellation">Origen</th>
                <th data-sort="tons">Tons</th>
                <th data-sort="berryWeight">Peso (g)</th>
                <th data-sort="berryDiameter">Diam (mm)</th>
                <th>Salud</th>
                <th data-sort="healthGrade">Grado</th>
              </tr>
            </thead>
            <tbody id="med-table-body"></tbody>
          </table>
        </div>
      </div>

      <div style="padding:20px;text-align:center;color:var(--muted);font-size:11px" id="med-no-data">
        No hay mediciones registradas. Use el formulario para agregar la primera.
      </div>
    </div>
```

- [ ] **Step 3: Add script tag**

In `index.html`, after `<script src="js/maps.js"></script>` (line 772), add:

```html
<script src="js/mediciones.js"></script>
```

- [ ] **Step 4: Add CSS styles**

Append to `css/styles.css`:

```css
/* ── Mediciones Form ── */
.medicion-form { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.form-row { display: flex; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.form-group { flex: 1; min-width: 140px; }
.form-group label { display: block; font-size: 10px; color: var(--muted); margin-bottom: 4px; font-family: 'Sackers Gothic Medium', sans-serif; text-transform: uppercase; letter-spacing: 0.5px; }
.form-group input, .form-group select { width: 100%; padding: 7px 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 13px; font-family: 'Jost', sans-serif; }
.form-group input:focus, .form-group select:focus { border-color: var(--gold); outline: none; }
.form-group-sm { min-width: 80px; flex: 0 1 100px; }
.health-row { background: var(--surface); border-radius: 6px; padding: 10px 12px; }
.form-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.btn-gold { padding: 8px 20px; background: var(--gold); color: var(--black); border: none; border-radius: 4px; font-family: 'Sackers Gothic Medium', sans-serif; font-size: 11px; letter-spacing: 0.5px; cursor: pointer; text-transform: uppercase; }
.btn-gold:hover { background: var(--gold-lt); }
.btn-gold:disabled { opacity: 0.5; cursor: not-allowed; }
.form-status { font-size: 12px; color: var(--muted); }
.form-status.success { color: var(--success-color); }
.form-status.error { color: var(--flag-error); }

/* Health mini-bar in table */
.health-mini-bar { display: flex; height: 14px; border-radius: 3px; overflow: hidden; min-width: 80px; }
.health-mini-bar span { display: block; height: 100%; }
.hb-madura { background: #7EC87A; }
.hb-inmadura { background: #60A8C0; }
.hb-sobremadura { background: #F5C542; }
.hb-picadura { background: #E07060; }
.hb-enfermedad { background: #9B59B6; }
.hb-quemadura { background: #E67E22; }
```

- [ ] **Step 5: Commit**

```bash
git add index.html css/styles.css
git commit -m "feat: mediciones view HTML + form + CSS styles"
```

---

## Task 4: Mediciones Module — Form Submit + Table Render

**Files:**
- Create: `js/mediciones.js`

- [ ] **Step 1: Create the module with form handling and table rendering**

Create `js/mediciones.js`:

```javascript
// ── Mediciones Tecnicas — form, table, charts ──

const Mediciones = {
  _sortField: 'date',
  _sortAsc: false,

  // Populate variety + origin dropdowns from CONFIG
  initDropdowns() {
    const varietyEl = document.getElementById('med-variety');
    const originEl = document.getElementById('med-origin');
    if (!varietyEl || !originEl) return;

    const allVarieties = [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white].sort();
    varietyEl.innerHTML = '<option value="">— Seleccionar —</option>' +
      allVarieties.map(v => `<option value="${v}">${v}</option>`).join('');

    const origins = Object.keys(CONFIG.originColors).sort();
    originEl.innerHTML = '<option value="">— Seleccionar —</option>' +
      origins.map(o => `<option value="${o}">${o}</option>`).join('');

    // Default date to today
    const dateEl = document.getElementById('med-date');
    if (dateEl && !dateEl.value) {
      dateEl.value = new Date().toISOString().split('T')[0];
    }
  },

  // Collect form data and submit to /api/upload
  async submitForm() {
    const code = document.getElementById('med-code')?.value.trim();
    const date = document.getElementById('med-date')?.value;
    const vintage = parseInt(document.getElementById('med-vintage')?.value, 10);
    const variety = document.getElementById('med-variety')?.value;
    const appellation = document.getElementById('med-origin')?.value;
    const lotCode = document.getElementById('med-lot')?.value.trim() || null;
    const tons = parseFloat(document.getElementById('med-tons')?.value) || null;
    const weight = parseFloat(document.getElementById('med-weight')?.value) || null;
    const diameter = parseFloat(document.getElementById('med-diameter')?.value) || null;
    const grade = document.getElementById('med-grade')?.value || null;
    const measuredBy = document.getElementById('med-by')?.value.trim() || null;
    const notes = document.getElementById('med-notes')?.value.trim() || null;

    const hMadura = parseInt(document.getElementById('med-h-madura')?.value, 10) || 0;
    const hInmadura = parseInt(document.getElementById('med-h-inmadura')?.value, 10) || 0;
    const hSobremadura = parseInt(document.getElementById('med-h-sobremadura')?.value, 10) || 0;
    const hPicadura = parseInt(document.getElementById('med-h-picadura')?.value, 10) || 0;
    const hEnfermedad = parseInt(document.getElementById('med-h-enfermedad')?.value, 10) || 0;
    const hQuemadura = parseInt(document.getElementById('med-h-quemadura')?.value, 10) || 0;

    if (!code || !date || !vintage || !variety || !appellation) {
      this._setStatus('Campos obligatorios: codigo, fecha, vendimia, variedad, origen', 'error');
      return;
    }

    const berryTotal = hMadura + hInmadura + hSobremadura + hPicadura + hEnfermedad + hQuemadura;

    const row = {
      medicion_code: code,
      medicion_date: date,
      vintage_year: vintage,
      variety,
      appellation,
      lot_code: lotCode,
      tons_received: tons,
      berry_count_sample: berryTotal || null,
      berry_avg_weight_g: weight,
      berry_diameter_mm: diameter,
      health_grade: grade,
      health_madura: hMadura,
      health_inmadura: hInmadura,
      health_sobremadura: hSobremadura,
      health_picadura: hPicadura,
      health_enfermedad: hEnfermedad,
      health_quemadura: hQuemadura,
      measured_by: measuredBy,
      notes
    };

    const btn = document.querySelector('#medicion-form .btn-gold');
    if (btn) btn.disabled = true;
    this._setStatus('Guardando...', '');

    try {
      const token = localStorage.getItem('xanic_session_token');
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': token || ''
        },
        body: JSON.stringify({ table: 'mediciones_tecnicas', rows: [row] })
      });
      const data = await res.json();
      if (data.ok) {
        this._setStatus('Medicion guardada correctamente', 'success');
        document.getElementById('medicion-form')?.reset();
        // Re-default date
        const dateEl = document.getElementById('med-date');
        if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
        // Reload data and refresh view
        await DataStore.loadMediciones();
        this.refresh();
      } else {
        this._setStatus(data.error || 'Error al guardar', 'error');
      }
    } catch (e) {
      this._setStatus('Error de conexion', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _setStatus(msg, type) {
    const el = document.getElementById('med-form-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'form-status' + (type ? ' ' + type : '');
  },

  // Render the sortable table
  renderTable(data) {
    const tbody = document.getElementById('med-table-body');
    const countEl = document.getElementById('med-table-count');
    const noData = document.getElementById('med-no-data');
    if (!tbody) return;

    if (countEl) countEl.textContent = `${data.length} registros`;
    if (noData) noData.style.display = data.length ? 'none' : '';

    // Sort
    const sorted = [...data].sort((a, b) => {
      let va = a[this._sortField], vb = b[this._sortField];
      if (va === null || va === undefined) va = '';
      if (vb === null || vb === undefined) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return this._sortAsc ? va - vb : vb - va;
      return this._sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    const esc = (s) => {
      if (s === null || s === undefined) return '—';
      const div = document.createElement('div');
      div.textContent = String(s);
      return div.innerHTML;
    };

    tbody.innerHTML = sorted.map(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura +
                    d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      const pct = (v) => total > 0 ? ((v / total) * 100).toFixed(0) : 0;
      const bar = total > 0
        ? `<div class="health-mini-bar" title="Madura ${pct(d.healthMadura)}% | Inmadura ${pct(d.healthInmadura)}% | Sobremad. ${pct(d.healthSobremadura)}% | Picadura ${pct(d.healthPicadura)}% | Enferm. ${pct(d.healthEnfermedad)}% | Quemad. ${pct(d.healthQuemadura)}%">` +
          `<span class="hb-madura" style="width:${pct(d.healthMadura)}%"></span>` +
          `<span class="hb-inmadura" style="width:${pct(d.healthInmadura)}%"></span>` +
          `<span class="hb-sobremadura" style="width:${pct(d.healthSobremadura)}%"></span>` +
          `<span class="hb-picadura" style="width:${pct(d.healthPicadura)}%"></span>` +
          `<span class="hb-enfermedad" style="width:${pct(d.healthEnfermedad)}%"></span>` +
          `<span class="hb-quemadura" style="width:${pct(d.healthQuemadura)}%"></span>` +
          `</div>`
        : '—';
      return `<tr>
        <td>${esc(d.code)}</td>
        <td>${esc(d.date)}</td>
        <td>${esc(d.variety)}</td>
        <td>${esc(d.appellation)}</td>
        <td>${d.tons !== null ? d.tons.toFixed(2) : '—'}</td>
        <td>${d.berryWeight !== null ? d.berryWeight.toFixed(2) : '—'}</td>
        <td>${d.berryDiameter !== null ? d.berryDiameter.toFixed(1) : '—'}</td>
        <td>${bar}</td>
        <td>${esc(d.healthGrade)}</td>
      </tr>`;
    }).join('');
  },

  sortBy(field) {
    if (this._sortField === field) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortField = field;
      this._sortAsc = true;
    }
    this.refresh();
  },

  // KPIs
  updateKPIs(data) {
    const countEl = document.getElementById('med-kpi-count');
    const tonsEl = document.getElementById('med-kpi-tons');
    const weightEl = document.getElementById('med-kpi-weight');
    const healthEl = document.getElementById('med-kpi-health');

    if (countEl) countEl.textContent = data.length || '—';

    const totalTons = data.reduce((s, d) => s + (d.tons || 0), 0);
    if (tonsEl) tonsEl.textContent = totalTons > 0 ? totalTons.toFixed(1) + ' t' : '—';

    const weights = data.filter(d => d.berryWeight > 0).map(d => d.berryWeight);
    if (weightEl) weightEl.textContent = weights.length ? (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2) + ' g' : '—';

    const maduraPcts = data.map(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura + d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      return total > 0 ? (d.healthMadura / total) * 100 : null;
    }).filter(v => v !== null);
    if (healthEl) healthEl.textContent = maduraPcts.length ? (maduraPcts.reduce((a, b) => a + b, 0) / maduraPcts.length).toFixed(0) + '%' : '—';
  },

  // Full refresh
  refresh() {
    const data = DataStore.medicionesData || [];
    this.updateKPIs(data);
    this.renderTable(data);
    this.renderCharts(data);
  },

  // Charts placeholder — implemented in Task 5
  renderCharts(data) {}
};
```

- [ ] **Step 2: Commit**

```bash
git add js/mediciones.js
git commit -m "feat: mediciones module — form submit + table + KPIs"
```

---

## Task 5: Mediciones Charts

**Files:**
- Modify: `js/mediciones.js` — replace `renderCharts` placeholder

- [ ] **Step 1: Implement renderCharts**

Replace the `renderCharts(data) {}` placeholder in `js/mediciones.js`:

```javascript
  renderCharts(data) {
    this._chartTonnage(data);
    this._chartWeightTimeline(data);
    this._chartHealthDistribution(data);
  },

  // Grouped bar: total tons per variety
  _chartTonnage(data) {
    const canvasId = 'chartMedTons';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const byVariety = {};
    data.forEach(d => {
      if (!d.tons) return;
      byVariety[d.variety] = (byVariety[d.variety] || 0) + d.tons;
    });

    const varieties = Object.keys(byVariety).sort((a, b) => byVariety[b] - byVariety[a]);
    if (!varieties.length) return;

    const colors = varieties.map(v => CONFIG.varietyColors[v] || '#888');

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: varieties,
          datasets: [{
            label: 'Toneladas',
            data: varieties.map(v => byVariety[v]),
            backgroundColor: colors.map(c => c + 'CC'),
            borderColor: colors,
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              title: { display: true, text: 'Toneladas', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 } },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 } },
              grid: { display: false }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] tonnage chart error:', e); }
  },

  // Scatter: berry weight over date per variety
  _chartWeightTimeline(data) {
    const canvasId = 'chartMedWeight';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const byVariety = {};
    data.forEach(d => {
      if (!d.berryWeight || !d.date) return;
      if (!byVariety[d.variety]) byVariety[d.variety] = [];
      byVariety[d.variety].push({ x: d.date, y: d.berryWeight });
    });

    const datasets = Object.keys(byVariety).sort().map(v => ({
      label: v,
      data: byVariety[v],
      backgroundColor: (CONFIG.varietyColors[v] || '#888') + 'CC',
      borderColor: CONFIG.varietyColors[v] || '#888',
      pointRadius: 5,
      pointHoverRadius: 7
    }));

    if (!datasets.length) return;

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 }, boxWidth: 12, padding: 8 } }
          },
          scales: {
            x: {
              type: 'time',
              time: { unit: 'week', displayFormats: { week: 'd MMM' } },
              title: { display: true, text: 'Fecha', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 } },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              title: { display: true, text: 'Peso Baya (g)', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 } },
              grid: { color: CONFIG.chartDefaults.gridColor }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] weight chart error:', e); }
  },

  // Stacked horizontal bar: health distribution per variety
  _chartHealthDistribution(data) {
    const canvasId = 'chartMedHealth';
    if (Charts.instances[canvasId]) { Charts.instances[canvasId].destroy(); delete Charts.instances[canvasId]; }
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const categories = [
      { key: 'healthMadura',      label: 'Madura',      color: '#7EC87A' },
      { key: 'healthInmadura',    label: 'Inmadura',    color: '#60A8C0' },
      { key: 'healthSobremadura', label: 'Sobremadura', color: '#F5C542' },
      { key: 'healthPicadura',    label: 'Picadura',    color: '#E07060' },
      { key: 'healthEnfermedad',  label: 'Enfermedad',  color: '#9B59B6' },
      { key: 'healthQuemadura',   label: 'Quemadura',   color: '#E67E22' }
    ];

    // Aggregate by variety: average percentages
    const byVariety = {};
    data.forEach(d => {
      const total = d.healthMadura + d.healthInmadura + d.healthSobremadura +
                    d.healthPicadura + d.healthEnfermedad + d.healthQuemadura;
      if (total <= 0) return;
      if (!byVariety[d.variety]) byVariety[d.variety] = { count: 0 };
      const v = byVariety[d.variety];
      v.count++;
      categories.forEach(c => {
        v[c.key] = (v[c.key] || 0) + (d[c.key] / total) * 100;
      });
    });

    const varieties = Object.keys(byVariety).sort();
    if (!varieties.length) return;

    // Average
    varieties.forEach(v => {
      categories.forEach(c => {
        byVariety[v][c.key] = byVariety[v][c.key] / byVariety[v].count;
      });
    });

    const datasets = categories.map(c => ({
      label: c.label,
      data: varieties.map(v => byVariety[v][c.key] || 0),
      backgroundColor: c.color + 'CC',
      borderColor: c.color,
      borderWidth: 1
    }));

    try {
      Charts.instances[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: { labels: varieties, datasets },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 }, boxWidth: 12, padding: 8 } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` } }
          },
          scales: {
            x: {
              stacked: true,
              max: 100,
              title: { display: true, text: '% Promedio', color: '#6B6B6B', font: { size: 9, family: 'Sackers Gothic Medium' } },
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 9 }, callback: v => v + '%' },
              grid: { color: CONFIG.chartDefaults.gridColor }
            },
            y: {
              stacked: true,
              ticks: { color: CONFIG.chartDefaults.tickColor, font: { size: 10 } },
              grid: { display: false }
            }
          }
        }
      });
    } catch (e) { console.error('[Mediciones] health chart error:', e); }
  },
```

- [ ] **Step 2: Commit**

```bash
git add js/mediciones.js
git commit -m "feat: mediciones charts — tonnage, weight timeline, health distribution"
```

---

## Task 6: Wiring — App Routing + Events

**Files:**
- Modify: `js/app.js:270` — add `mediciones` to filter visibility
- Modify: `js/app.js:296` — add `mediciones` case to refresh switch
- Modify: `js/events.js:1-17` — add `_bindMediciones` to `bindAll()`

- [ ] **Step 1: Add mediciones to filter visibility in setView**

In `js/app.js:270`, update the berry filters visibility line to include `mediciones`:

```javascript
if (berryFilters) berryFilters.style.display = (view === 'berry' || view === 'vintage' || view === 'extraction' || view === 'explorer' || view === 'map' || view === 'mediciones') ? '' : 'none';
```

Also hide filters for mediciones (like map — it has its own form), add after the map block:

```javascript
if (view === 'mediciones') {
  if (berryFilters) berryFilters.style.display = 'none';
  if (wineFilters) wineFilters.style.display = 'none';
}
```

- [ ] **Step 2: Add mediciones case to refresh switch**

In `js/app.js`, inside `refresh()`, after the `case 'map'` block and before the closing `}` of the switch, add:

```javascript
      case 'mediciones': {
        Mediciones.initDropdowns();
        Mediciones.refresh();
        break;
      }
```

- [ ] **Step 3: Load mediciones data on init**

In `js/app.js`, find where `DataStore.loadBerryData()` is called during init and add after it:

```javascript
DataStore.loadMediciones();
```

- [ ] **Step 4: Add event bindings**

In `js/events.js`, add `this._bindMediciones();` to the `bindAll()` method.

Then add the handler method:

```javascript
  _bindMediciones() {
    const form = document.getElementById('medicion-form');
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      Mediciones.submitForm();
    });

    const table = document.getElementById('mediciones-table');
    if (table) table.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) Mediciones.sortBy(th.dataset.sort);
    });
  },
```

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/events.js
git commit -m "feat: wire mediciones view — routing, events, data loading"
```

---

## Post-Implementation

- [ ] Run `npm start`, navigate to Mediciones tab
- [ ] Fill out form, submit, verify data appears in table
- [ ] Verify KPIs update
- [ ] Verify charts render (tonnage, weight, health)
- [ ] Verify table sorting works
- [ ] Verify form validation (missing required fields shows error)
- [ ] Run `npm test` to ensure existing tests still pass

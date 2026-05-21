// js/predictionSettings.js
// Renders the harvest-target overrides editor. Lab/admin can edit;
// everyone else sees read-only inputs.

import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';
import { Auth } from './auth.js';

const VALLEY_CODES = { 'Valle de Guadalupe': 'VDG',
                       'Valle de Ojos Negros': 'VON',
                       'Valle de San Vicente': 'VSV' };

let dirtyRows = new Map();          // key = `${variety}|${valley}` → row patch

export const PredictionSettings = {
  mount() {
    dirtyRows = new Map();
    this.render();
    const saveBtn = document.getElementById('ajustes-objetivos-save');
    if (saveBtn && !saveBtn._wired) {
      saveBtn._wired = true;
      saveBtn.addEventListener('click', () => this.save());
    }
    const cancelBtn = document.getElementById('ajustes-objetivos-cancel');
    if (cancelBtn && !cancelBtn._wired) {
      cancelBtn._wired = true;
      cancelBtn.addEventListener('click', () => { dirtyRows.clear(); this.render(); });
    }
    // Wire link-buttons in this view for cross-view navigation
    document.querySelectorAll('#view-ajustes-objetivos .link-button[data-view]')
      .forEach(a => {
        if (a._wired) return;
        a._wired = true;
        a.addEventListener('click', e => {
          e.preventDefault();
          import('./app.js').then(m => m.App.setView(a.dataset.view));
        });
      });
  },

  render() {
    const tbody = document.querySelector('#ajustes-objetivos-table tbody');
    const meta  = document.getElementById('ajustes-objetivos-meta');
    if (!tbody) return;
    const canEdit = Auth?.role === 'lab' || Auth?.role === 'admin';
    const overrides = new Map();
    for (const o of (DataStore.harvestTargetOverrides || [])) {
      overrides.set(`${o.variety}|${o.valley}`, o);
    }
    tbody.innerHTML = '';
    // Build all (variety, valley) combos that have a rubric entry
    const rows = [];
    for (const [valleyName, vmap] of Object.entries(CONFIG.varietyRubricMap)) {
      const valley = VALLEY_CODES[valleyName];
      if (!valley) continue;
      for (const [variety, rubricId] of Object.entries(vmap)) {
        const rubric = CONFIG.rubrics[rubricId];
        const rb = rubric?.params?.brix;
        const ra = rubric?.params?.anthocyanins;
        const rp = rubric?.params?.pH;
        const inherited = {
          brixTarget: rb ? (rb.a[0] + rb.a[1]) / 2 : null,
          brixLower:  rb?.a?.[0] ?? null,
          brixUpper:  rb?.a?.[1] ?? null,
          antTarget:  ra?.a ?? null,
          phTarget:   (rp && !ra) ? rp.a : null,
        };
        const ovr = overrides.get(`${variety}|${valley}`);
        rows.push({ variety, valley, rubric, inherited, ovr });
      }
    }
    rows.sort((a, b) => a.variety.localeCompare(b.variety)
                     || a.valley.localeCompare(b.valley));
    for (const r of rows) tbody.appendChild(this.renderRow(r, canEdit));

    // Meta: latest updated_by/updated_at
    const latest = (DataStore.harvestTargetOverrides || [])
      .slice()
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    if (meta && latest) {
      meta.textContent = `Última actualización: ${latest.updated_by ?? '—'} · `
        + new Date(latest.updated_at).toLocaleDateString('es-MX',
            { day:'numeric', month:'short', year:'numeric' });
    } else if (meta) {
      meta.textContent = 'Sin overrides registrados — todos los valores se heredan de la rúbrica.';
    }
    const saveBtn = document.getElementById('ajustes-objetivos-save');
    if (saveBtn) saveBtn.disabled = !canEdit;
  },

  renderRow(r, canEdit) {
    const tr = document.createElement('tr');
    const key = `${r.variety}|${r.valley}`;
    const dirty = dirtyRows.get(key) ?? {};
    const v = field => (
      dirty[field] !== undefined ? dirty[field]
      : r.ovr?.[field] !== undefined && r.ovr[field] !== null ? r.ovr[field]
      : ''
    );
    const ph = field => {
      const map = { brix_target: 'brixTarget', brix_target_lower: 'brixLower',
                    brix_upper: 'brixUpper', anthocyanin_target: 'antTarget',
                    ph_target: 'phTarget' };
      const inh = r.inherited[map[field]];
      return inh != null ? String(inh) : 'n/a';
    };

    const inputs = ['brix_target', 'brix_target_lower', 'brix_upper'];
    const cells = inputs.map(f =>
      `<td class="num"><input type="number" step="0.01" data-field="${f}"
          value="${escapeHtml(String(v(f)))}" placeholder="${escapeHtml(ph(f))}" ${canEdit ? '' : 'disabled'}></td>`
    ).join('');
    const antCell = r.inherited.antTarget == null
      ? `<td class="num" style="color:#9b9388;font-style:italic">no aplica</td>`
      : `<td class="num"><input type="number" step="1" data-field="anthocyanin_target"
            value="${escapeHtml(String(v('anthocyanin_target')))}" placeholder="${escapeHtml(ph('anthocyanin_target'))}"
            ${canEdit ? '' : 'disabled'}></td>`;
    const phCell = r.inherited.phTarget == null
      ? `<td class="num" style="color:#9b9388;font-style:italic">no aplica</td>`
      : `<td class="num"><input type="number" step="0.01" data-field="ph_target"
            value="${escapeHtml(String(v('ph_target')))}" placeholder="${escapeHtml(ph('ph_target'))}"
            ${canEdit ? '' : 'disabled'}></td>`;

    let note;
    if (!r.ovr) note = '100% de rúbrica';
    else {
      const fields = ['brix_target','brix_target_lower','brix_upper','anthocyanin_target','ph_target'];
      const overridden = fields.filter(f => r.ovr[f] != null);
      if (overridden.length === fields.length) note = 'override completo';
      else if (overridden.length === 0) note = '100% de rúbrica';
      else note = `heredado: ${fields.filter(f => !overridden.includes(f))
                    .map(f => f.replace('brix_','Brix ')
                              .replace('anthocyanin_','ANT ')
                              .replace('ph_','pH '))
                    .join(', ')}`;
    }

    tr.innerHTML = `
      <td><b>${escapeHtml(r.variety)}</b></td>
      <td>${escapeHtml(r.valley)}</td>
      ${cells}
      ${antCell}
      ${phCell}
      <td style="font-size:11px;color:#7a7368">${escapeHtml(note)}</td>
    `;
    if (canEdit) {
      tr.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', e => {
          const patch = dirtyRows.get(key) ?? {};
          const val = e.target.value.trim();
          patch[e.target.dataset.field] = val === '' ? null : Number(val);
          dirtyRows.set(key, patch);
        });
      });
    }
    return tr;
  },

  async save() {
    if (!dirtyRows.size) return;
    const errors = [];
    for (const [key, patch] of dirtyRows.entries()) {
      const [variety, valley] = key.split('|');
      try {
        await DataStore.upsertHarvestTargetOverride({
          variety, valley, ...patch,
        });
      } catch (e) {
        errors.push(`${variety} · ${valley}: ${e.message}`);
      }
    }
    dirtyRows.clear();
    this.render();
    if (errors.length) {
      alert(`Algunos registros no se guardaron:\n${errors.join('\n')}`);
    }
  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

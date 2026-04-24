// ── Upload Manager: parser-agnostic preview → confirm → upsert pipeline ──
// Parsing lives in js/upload/<parser>.js. This module owns:
//   - file validation gates (size, role, single-flight)
//   - preview state (_pendingUpload)
//   - confirm/cancel handlers
//   - Supabase upsert (via /api/upload)
// All user-facing messages are in Spanish.

import { Identity } from './identity.js';
import { DataStore } from './dataLoader.js';
import { Auth } from './auth.js';
import { App } from './app.js';
import { PARSERS } from './upload/index.js';

const MAX_SIZE = 10 * 1024 * 1024;

const TABLE_DISPLAY = {
  wine_samples:     { emoji: '🍷', label: 'Muestras de vino' },
  berry_samples:    { emoji: '🫐', label: 'Muestras de baya' },
  tank_receptions:  { emoji: '🛢️', label: 'Recepciones de tanque' },
  reception_lots:   { emoji: '📦', label: 'Lotes de recepción' },
  prefermentativos: { emoji: '🧪', label: 'Prefermentativos' },
  pre_receptions:   { emoji: '📋', label: 'Pre-recepciones' },
};

const EXCLUDED_LABEL = {
  control_wine:  'Control Wine',
  lab_test:      'Pruebas de laboratorio',
  california:    'Appellation California',
  hard_excluded: 'Excluidos por política',
};

export const UploadManager = {
  _uploading: false,
  _pendingUpload: null,

  _esc(str) {
    if (typeof document === 'undefined') return String(str);
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  // Public entry point — called from events.js button handlers.
  async startUpload(parserId, file, statusEl) {
    const parser = PARSERS[parserId];
    if (!parser) {
      this._setStatus(statusEl, 'error', `✗ Parser desconocido: ${parserId}`);
      return;
    }
    return this._startUploadWithParser(parser, file, statusEl);
  },

  // Internal — also the test surface.
  async _startUploadWithParser(parser, file, statusEl) {
    if (this._uploading) {
      this._setStatus(statusEl, 'error', 'Carga en progreso, espere...');
      return;
    }
    if (!Auth.canUpload()) {
      this._setStatus(statusEl, 'error', '✗ Sin permisos para subir datos.');
      return;
    }
    if (file.size > MAX_SIZE) {
      this._setStatus(statusEl, 'error', '✗ Archivo demasiado grande (máx 10 MB).');
      return;
    }

    this._uploading = true;
    this._setStatus(statusEl, 'pending', `⏳ Leyendo ${this._esc(file.name)}…`);

    try {
      const result = await parser.parse(file);

      for (const t of result.targets) {
        if (t.table === 'wine_samples' || t.table === 'berry_samples') {
          Identity.canonicalSeqAssign(t.rows);
        }
        t.newCount = await this._countNew(t.table, t.rows, t.conflictKey);
        t.updateCount = t.rows.length - t.newCount;
      }

      const totalRows = result.targets.reduce((s, t) => s + t.rows.length, 0);
      if (totalRows === 0 && result.rejected.length === 0) {
        this._uploading = false;
        this._setStatus(statusEl, 'error', '✗ El archivo no contiene filas válidas.');
        return;
      }

      this._pendingUpload = { parser, file, ...result };
      this._renderPreviewCard(statusEl);
    } catch (err) {
      this._uploading = false;
      this._setStatus(statusEl, 'error', `✗ ${err.message || 'Error al leer el archivo.'}`);
    }
  },

  async confirmPendingUpload(statusEl) {
    if (!this._pendingUpload) return [];
    const { targets, rejected } = this._pendingUpload;
    const results = [];
    for (const t of targets) {
      if (!t.rows.length) continue;
      const r = await this.upsertRows(t.table, t.rows);
      results.push({ table: t.table, count: r.count, error: r.error });
      if (r.error) break;
    }
    this._renderSummary(statusEl, results, rejected);
    this._pendingUpload = null;
    this._uploading = false;
    try {
      if (DataStore && DataStore.cacheData) DataStore.cacheData();
      if (App && App.refreshAllViews) App.refreshAllViews();
    } catch (_) { /* refresh is best-effort */ }
    return results;
  },

  cancelPendingUpload(statusEl) {
    this._pendingUpload = null;
    this._uploading = false;
    this._setStatus(statusEl, 'idle', '');
  },

  async _countNew(table, rows, conflictKey) {
    if (!rows.length || !DataStore.supabase || !conflictKey) return rows.length;
    const keyCols = conflictKey.split(',').map(s => s.trim());
    try {
      const primary = keyCols[0];
      const keys = [...new Set(rows.map(r => r[primary]).filter(Boolean))];
      if (!keys.length) return rows.length;
      const { data, error } = await DataStore.supabase
        .from(table)
        .select(keyCols.join(','))
        .in(primary, keys);
      if (error || !data) return rows.length;
      const toKey = r => keyCols.map(c => r[c] ?? '').join('|');
      const existing = new Set(data.map(toKey));
      return rows.filter(r => !existing.has(toKey(r))).length;
    } catch (_) {
      return rows.length;
    }
  },

  async upsertRows(table, rows) {
    if (!rows.length) return { count: 0, error: null };
    const token = Auth.getToken();
    if (!token) return { count: 0, error: 'No autorizado — inicie sesión' };

    let total = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      try {
        const resp = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': token,
          },
          body: JSON.stringify({ table, rows: chunk }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          return { count: total, error: data.error || 'Error al insertar datos' };
        }
        total += data.count || chunk.length;
      } catch (err) {
        return { count: total, error: err.message };
      }
    }
    return { count: total, error: null };
  },

  // UI helpers (preview card + summary DOM rendering) — implemented in Task 13
  _setStatus(el, state, msg) {
    if (!el) return;
    el.dataset.state = state;
    el.textContent = msg;
  },

  _renderPreviewCard(statusEl) {
    if (!statusEl || !this._pendingUpload) return;
    const { parser, file, targets, excluded, rejected } = this._pendingUpload;
    const totalRows = targets.reduce((s, t) => s + t.rows.length, 0);

    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
    statusEl.dataset.state = 'preview';

    const card = document.createElement('div');
    card.className = 'upload-preview-card';

    const header = document.createElement('div');
    header.className = 'upload-preview-header';
    header.textContent = `📄 ${file.name} · ${totalRows} filas procesables · ${parser.label}`;
    card.appendChild(header);

    const readyH = document.createElement('h4');
    readyH.textContent = 'Listo para insertar';
    card.appendChild(readyH);

    for (const t of targets) {
      if (!t.rows.length) continue;
      const disp = TABLE_DISPLAY[t.table] || { emoji: '📄', label: t.table };
      const row = document.createElement('div');
      row.className = 'upload-preview-row';
      row.textContent = `${disp.emoji} ${disp.label}: ${t.rows.length} (${t.newCount} nuevas · ${t.updateCount} actualizadas)`;
      card.appendChild(row);
    }

    const hasExcluded = Object.values(excluded || {}).some(n => n > 0);
    if (hasExcluded) {
      const excH = document.createElement('h4');
      excH.textContent = 'Omitidos por política';
      card.appendChild(excH);
      for (const [key, count] of Object.entries(excluded)) {
        if (!count) continue;
        const row = document.createElement('div');
        row.className = 'upload-preview-row upload-preview-excluded';
        row.textContent = `${EXCLUDED_LABEL[key] || key}: ${count}`;
        card.appendChild(row);
      }
    }

    if (rejected && rejected.length) {
      const rejH = document.createElement('h4');
      rejH.textContent = '⚠ Rechazados (revisar)';
      card.appendChild(rejH);

      const byMotivo = {};
      for (const r of rejected) {
        byMotivo[r.motivo_rechazo] = (byMotivo[r.motivo_rechazo] || 0) + 1;
      }
      for (const [motivo, count] of Object.entries(byMotivo)) {
        const row = document.createElement('div');
        row.className = 'upload-preview-row upload-preview-rejected';
        row.textContent = `${motivo}: ${count}`;
        card.appendChild(row);
      }

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.textContent = 'Descargar rechazados.csv';
      dlBtn.className = 'btn upload-preview-download';
      dlBtn.addEventListener('click', () => this._downloadRejected());
      card.appendChild(dlBtn);
    }

    const actions = document.createElement('div');
    actions.className = 'upload-preview-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.addEventListener('click', () => this.cancelPendingUpload(statusEl));

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirmar e insertar';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.disabled = targets.every(t => !t.rows.length);
    confirmBtn.addEventListener('click', () => this.confirmPendingUpload(statusEl));

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);

    statusEl.appendChild(card);
  },

  _renderSummary(statusEl, results, rejected) {
    if (!statusEl) return;
    while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);

    const anyError = results.some(r => r.error);
    statusEl.dataset.state = anyError ? 'partial' : 'success';

    const box = document.createElement('div');
    box.className = anyError ? 'upload-summary upload-summary-partial' : 'upload-summary upload-summary-success';

    const lines = [];
    for (const r of results) {
      const disp = TABLE_DISPLAY[r.table] || { label: r.table };
      if (r.error) {
        lines.push(`✗ ${disp.label}: ${r.error}`);
      } else {
        lines.push(`✓ ${disp.label}: ${r.count} insertadas/actualizadas`);
      }
    }
    if (rejected && rejected.length) {
      lines.push(`Rechazadas: ${rejected.length}`);
    }

    for (const line of lines) {
      const el = document.createElement('div');
      el.textContent = line;
      box.appendChild(el);
    }
    statusEl.appendChild(box);
  },

  _downloadRejected() {
    if (!this._pendingUpload || !this._pendingUpload.rejected.length) return;
    const { rejected, file } = this._pendingUpload;

    const headerSet = new Set();
    for (const r of rejected) Object.keys(r.row).forEach(k => headerSet.add(k));
    const headers = [...headerSet, 'motivo_rechazo'];

    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [headers.map(escape).join(',')];
    for (const r of rejected) {
      const vals = headers.map(h => h === 'motivo_rechazo' ? escape(r.motivo_rechazo) : escape(r.row[h]));
      lines.push(vals.join(','));
    }
    const csv = lines.join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rechazados-${file.name.replace(/\.[^.]+$/, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

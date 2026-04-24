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

  _renderPreviewCard(_statusEl) {
    // stub — Task 13 replaces this with full DOM rendering
  },

  _renderSummary(_statusEl, _results, _rejected) {
    // stub — Task 13 replaces this with full DOM rendering
  },
};

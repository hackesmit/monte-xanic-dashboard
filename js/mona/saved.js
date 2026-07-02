// js/mona/saved.js — "Guardados" tab: user-saved Mona charts/tables, live-rendered.
import { renderChart, renderTable } from './chartSpec.js';

const token = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('xanic_session_token') : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(action, payload = {}) {
  const res = await fetch('/api/mona-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': token() },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export async function saveView({ title, view_type, spec }) {
  return api('saveView', { title, view_type, spec });
}

export const MonaSaved = {
  async render() {
    const root = document.getElementById('view-guardados');
    if (!root) return;
    root.innerHTML = '<div class="mona-saved-loading">Cargando…</div>';
    let views = [];
    try { views = await api('listSavedViews'); } catch { root.innerHTML = '<div class="mona-error">No se pudieron cargar las vistas.</div>'; return; }

    if (!views.length) {
      root.innerHTML = '<div class="mona-saved-empty">Aún no has guardado gráficas ni tablas.<br>Genera una con Mona y pulsa <strong>Guardar</strong>.</div>';
      return;
    }

    root.innerHTML = '<div class="mona-saved-grid" id="mona-saved-grid"></div>';
    const grid = document.getElementById('mona-saved-grid');
    for (const v of views) {
      const card = document.createElement('div');
      card.className = 'mona-saved-card';
      card.innerHTML = `
        <div class="mona-saved-head">
          <span class="mona-saved-title">${esc(v.title)}</span>
          <button class="mona-saved-del" data-mona-view-del="${v.id}" title="Eliminar">✕</button>
        </div>
        <div class="mona-saved-body"></div>`;
      grid.appendChild(card);
      const body = card.querySelector('.mona-saved-body');
      try {
        if (v.view_type === 'chart') {
          const wrap = document.createElement('div');
          wrap.className = 'mona-chart-wrap';
          const canvas = document.createElement('canvas');
          wrap.appendChild(canvas);
          body.appendChild(wrap);
          renderChart(canvas, v.spec).catch(() => { body.innerHTML = '<div class="mona-error">Error al dibujar.</div>'; });
        } else {
          renderTable(body, v.spec);
        }
      } catch { body.innerHTML = '<div class="mona-error">Error al renderizar.</div>'; }
    }
  },

  async deleteView(id) {
    try { await api('deleteView', { id }); } catch { /* noop */ }
    this.render();
  },
};

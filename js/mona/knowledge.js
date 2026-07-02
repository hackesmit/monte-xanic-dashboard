// js/mona/knowledge.js — Mona's knowledge base: pure context assembly (Node-safe)
// plus the "Conocimiento" panel (lab/admin curate facts; Mona proposes them).
const token = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('xanic_session_token') : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAX_FACTS = 100;
const MAX_CHARS = 8000;

// Pure: format approved facts into a Spanish system-appendix block. No I/O.
export function assembleKnowledgeContext(facts) {
  const approved = (facts || []).filter(f => f && f.status === 'approved').slice(0, MAX_FACTS);
  if (!approved.length) return '';
  const lines = approved.map(f => `- ${f.fact}`);
  let block = `Conocimiento acumulado sobre la bodega (hechos verificados):\n${lines.join('\n')}`;
  if (block.length > MAX_CHARS) block = block.slice(0, MAX_CHARS);
  return block;
}

async function api(action, payload = {}) {
  const res = await fetch('/api/mona-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': token() },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export const MonaKnowledge = {
  facts: [],

  async load() {
    try { this.facts = await api('listKnowledge'); } catch { this.facts = []; }
    return this.facts;
  },

  approvedContext() { return assembleKnowledgeContext(this.facts); },

  async proposeFact(fact) { return api('proposeFact', { fact }); },
  async approve(id) { await api('approveFact', { id }); await this.load(); this.renderPanel(); },
  async remove(id) { await api('deleteFact', { id }); await this.load(); this.renderPanel(); },
  async add(fact) { await api('addFact', { fact }); await this.load(); this.renderPanel(); },

  openPanel() {
    let modal = document.getElementById('mona-kb-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'mona-kb-modal';
      modal.className = 'mona-kb-modal';
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    this.load().then(() => this.renderPanel());
  },

  closePanel() { const m = document.getElementById('mona-kb-modal'); if (m) m.hidden = true; },

  renderPanel() {
    const modal = document.getElementById('mona-kb-modal');
    if (!modal) return;
    const pending = this.facts.filter(f => f.status === 'pending');
    const approved = this.facts.filter(f => f.status === 'approved');
    const row = (f, actions) => `<li class="mona-kb-item"><span>${esc(f.fact)}</span><span class="mona-kb-actions">${actions}</span></li>`;
    modal.innerHTML = `
      <div class="mona-kb-panel">
        <div class="mona-kb-head"><span>Conocimiento de Mona</span><button data-mona-kb-close title="Cerrar">✕</button></div>
        <div class="mona-kb-add">
          <input id="mona-kb-input" placeholder="Agregar un hecho…" maxlength="1000">
          <button data-mona-kb-add>Agregar</button>
        </div>
        <div class="mona-kb-section">
          <h4>Propuestos (${pending.length})</h4>
          <ul>${pending.map(f => row(f, `<button data-mona-kb-approve="${f.id}">Aprobar</button><button data-mona-kb-del="${f.id}">Eliminar</button>`)).join('') || '<li class="mona-kb-empty">Ninguno</li>'}</ul>
        </div>
        <div class="mona-kb-section">
          <h4>Aprobados (${approved.length})</h4>
          <ul>${approved.map(f => row(f, `<button data-mona-kb-del="${f.id}">Eliminar</button>`)).join('') || '<li class="mona-kb-empty">Ninguno</li>'}</ul>
        </div>
      </div>`;
  },
};

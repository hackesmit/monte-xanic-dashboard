// js/mona/ui.js — Mona's rendering layer: full tab, floating widget, message
// bubbles, streaming, tool chips, chart/table cards, and the pin-to-Guardados flow.
// A single conversation (MonaChat.messages) is mirrored to every mounted "surface"
// (tab thread + widget thread), so both stay in sync automatically.
import { MonaChat } from './chat.js';
import { renderChart, renderTable, validateChartSpec, validateTableSpec } from './chartSpec.js';

const TOOL_LABELS = {
  query_data: 'Consultando datos…',
  aggregate_data: 'Agregando datos…',
  list_fields: 'Revisando campos…',
  compute_kpis: 'Calculando KPIs…',
  render_chart: 'Generando gráfica…',
  render_table: 'Generando tabla…',
  apply_filters: 'Aplicando filtros…',
  set_view: 'Cambiando de vista…',
  propose_fact: 'Proponiendo un hecho…',
};

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Minimal, safe markdown: bold, italics, inline code, line breaks.
function mdToHtml(text) {
  let h = esc(text);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

export const MonaUI = {
  surfaces: [],   // [{ thread, open: {bubble} }]
  _pendingDisplays: [],

  // ── Surface registration ──
  registerSurface(threadEl) {
    const surface = { thread: threadEl, openBubble: null, openText: '' };
    this.surfaces.push(surface);
    return surface;
  },

  eachSurface(fn) { this.surfaces.forEach(fn); },
  scroll(surface) { surface.thread.scrollTop = surface.thread.scrollHeight; },

  // ── Message bubbles ──
  addUserBubble(text) {
    this.eachSurface(s => {
      const b = el('div', 'mona-msg mona-msg-user', `<div class="mona-bubble">${mdToHtml(text)}</div>`);
      s.thread.appendChild(b);
      this.scroll(s);
    });
  },

  startAssistantBubble() {
    this.eachSurface(s => {
      const b = el('div', 'mona-msg mona-msg-bot');
      const bubble = el('div', 'mona-bubble mona-typing', '<span></span><span></span><span></span>');
      b.appendChild(bubble);
      s.thread.appendChild(b);
      s.openBubble = bubble;
      s.openText = '';
      this.scroll(s);
    });
  },

  appendText(delta) {
    this.eachSurface(s => {
      if (!s.openBubble) return;
      s.openBubble.classList.remove('mona-typing');
      s.openText += delta;
      s.openBubble.innerHTML = mdToHtml(s.openText);
      this.scroll(s);
    });
  },

  addToolChip(name) {
    this.eachSurface(s => {
      const chip = el('div', 'mona-tool-chip', esc(TOOL_LABELS[name] || name));
      s.thread.appendChild(chip);
      this.scroll(s);
    });
  },

  addDisplay(display) {
    this._pendingDisplays.push(display);
    this.eachSurface(s => this._renderDisplayInto(s.thread, display));
  },

  _renderDisplayInto(threadEl, display) {
    const card = el('div', 'mona-display-card');
    const body = el('div', 'mona-display-body');
    card.appendChild(body);
    if (display.kind === 'chart') {
      const wrap = el('div', 'mona-chart-wrap');
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      body.appendChild(wrap);
      renderChart(canvas, display.spec).catch(() => { body.innerHTML = '<div class="mona-error">No se pudo dibujar la gráfica.</div>'; });
    } else {
      renderTable(body, display.spec);
    }
    const bar = el('div', 'mona-display-actions');
    const btn = el('button', 'mona-pin-btn', 'Guardar');
    btn.dataset.monaPin = JSON.stringify({ kind: display.kind, title: display.spec.title || '' });
    // Stash full spec on the node to avoid re-serializing large payloads into the DOM attr.
    btn._monaSpec = display.spec;
    btn._monaKind = display.kind;
    bar.appendChild(btn);
    card.appendChild(bar);
    threadEl.appendChild(card);
    threadEl.scrollTop = threadEl.scrollHeight;
  },

  addError(msg) {
    this.eachSurface(s => {
      s.thread.appendChild(el('div', 'mona-msg mona-msg-error', `<div class="mona-bubble mona-error">${esc(msg)} <button class="mona-retry">Reintentar</button></div>`));
      this.scroll(s);
    });
  },

  // ── Replay a loaded conversation into all surfaces ──
  replay(messages) {
    this.eachSurface(s => { s.thread.innerHTML = ''; s.openBubble = null; });
    for (const m of messages) {
      if (m.role === 'user') {
        if (typeof m.content === 'string') this.addUserBubble(m.content);
        // tool_result arrays are internal — not shown
      } else if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const blk of m.content) {
          if (blk.type === 'text' && blk.text) {
            this.eachSurface(s => s.thread.appendChild(el('div', 'mona-msg mona-msg-bot', `<div class="mona-bubble">${mdToHtml(blk.text)}</div>`)));
          } else if (blk.type === 'tool_use' && (blk.name === 'render_chart' || blk.name === 'render_table')) {
            const v = blk.name === 'render_chart' ? validateChartSpec(blk.input) : validateTableSpec(blk.input);
            if (v.ok) this.addDisplay({ kind: blk.name === 'render_chart' ? 'chart' : 'table', spec: v.spec });
          }
        }
      }
    }
    this.eachSurface(s => this.scroll(s));
  },

  // ── Full tab ──
  buildTab() {
    const root = document.getElementById('view-mona');
    if (!root) return;
    root.innerHTML = `
      <div class="mona-layout">
        <aside class="mona-sidebar">
          <button class="mona-new-conv" data-mona-new>+ Nueva conversación</button>
          <div class="mona-conv-list" id="mona-conv-list"></div>
        </aside>
        <section class="mona-main">
          <div class="mona-thread" id="mona-thread"></div>
          <div class="mona-input-row">
            <textarea id="mona-input" class="mona-input" rows="1" placeholder="Pregúntale a Mona…"></textarea>
            <button id="mona-send" class="mona-send" data-mona-send>Enviar</button>
          </div>
        </section>
      </div>`;
    this.registerSurface(document.getElementById('mona-thread'));
    this.renderConvList();
  },

  renderConvList() {
    const list = document.getElementById('mona-conv-list');
    if (!list) return;
    list.innerHTML = '';
    for (const c of MonaChat.conversations) {
      const item = el('div', `mona-conv-item${c.id === MonaChat.conversationId ? ' active' : ''}`, `
        <span class="mona-conv-title">${esc(c.title || 'Conversación')}</span>
        <button class="mona-conv-del" data-mona-del="${c.id}" title="Eliminar">✕</button>`);
      item.dataset.monaConv = c.id;
      list.appendChild(item);
    }
  },

  // ── Floating widget (Phase 3) ──
  buildWidget() {
    let root = document.getElementById('mona-widget-root');
    if (!root) {
      root = el('div', '', '');
      root.id = 'mona-widget-root';
      document.body.appendChild(root);
    }
    root.innerHTML = `
      <button class="mona-fab" data-mona-fab title="Mona" aria-label="Abrir Mona">
        <span class="mona-fab-icon">M</span>
      </button>
      <div class="mona-widget" id="mona-widget" hidden>
        <div class="mona-widget-head">
          <span>Mona</span>
          <div class="mona-widget-head-actions">
            <button class="mona-widget-expand" data-mona-expand title="Abrir pestaña">⤢</button>
            <button class="mona-widget-close" data-mona-close title="Cerrar">✕</button>
          </div>
        </div>
        <div class="mona-thread mona-widget-thread" id="mona-widget-thread"></div>
        <div class="mona-input-row">
          <textarea id="mona-widget-input" class="mona-input" rows="1" placeholder="Pregúntale a Mona…"></textarea>
          <button class="mona-send" data-mona-widget-send>Enviar</button>
        </div>
      </div>`;
    this.registerSurface(document.getElementById('mona-widget-thread'));
  },

  toggleWidget(force) {
    const w = document.getElementById('mona-widget');
    if (!w) return;
    const show = force != null ? force : w.hasAttribute('hidden');
    if (show) { w.removeAttribute('hidden'); requestAnimationFrame(() => w.classList.add('open')); this.replay(MonaChat.messages); }
    else { w.classList.remove('open'); setTimeout(() => w.setAttribute('hidden', ''), 200); }
  },

  setFabVisible(visible) {
    const fab = document.querySelector('.mona-fab');
    if (fab) fab.style.display = visible ? '' : 'none';
  },

  // ── Pin flow ──
  async pinDisplay(btn) {
    const spec = btn._monaSpec, kind = btn._monaKind;
    if (!spec) return;
    const title = window.prompt('Título para guardar:', spec.title || (kind === 'chart' ? 'Gráfica' : 'Tabla'));
    if (title == null) return;
    try {
      const { saveView } = await import('./saved.js');
      await saveView({ title: title.slice(0, 120), view_type: kind, spec });
      btn.textContent = 'Guardado ✓';
      btn.disabled = true;
    } catch {
      btn.textContent = 'Error al guardar';
    }
  },

  // ── Wire MonaChat hooks + tool-effect ctx ──
  wire(ctx) {
    MonaChat.hooks = {
      onUser: (t) => this.addUserBubble(t),
      onAssistantStart: () => this.startAssistantBubble(),
      onText: (d) => this.appendText(d),
      onToolStart: (n) => this.addToolChip(n),
      onDisplay: (d) => this.addDisplay(d),
      onError: (m) => this.addError(m),
      onDone: () => {},
      onConversationChange: () => this.renderConvList(),
      onReplay: (msgs) => this.replay(msgs),
    };
    MonaChat.ctx = { ...MonaChat.ctx, ...ctx };
  },
};

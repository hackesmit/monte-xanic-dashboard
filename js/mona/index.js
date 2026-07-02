// js/mona/index.js — Mona facade: builds the UI, wires tool-effect callbacks to
// the app, injects the knowledge base, and boots the conversation. Imported by app.js.
import { App } from '../app.js';
import { Filters } from '../filters.js';
import { Auth } from '../auth.js';
import { MonaChat } from './chat.js';
import { MonaUI } from './ui.js';
import { MonaSaved } from './saved.js';
import { MonaKnowledge } from './knowledge.js';

const KNOWN_VIEWS = new Set(['berry', 'wine', 'extraction', 'vintage', 'map', 'explorer', 'mediciones', 'prediccion', 'mona', 'guardados']);

export const Mona = {
  initialized: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    MonaUI.buildTab();
    MonaUI.buildWidget();

    // Tool-effect callbacks (kept out of tools.js so that module stays DOM-free).
    MonaUI.wire({
      onChart: () => {},   // display handled via MonaChat.hooks.onDisplay
      onTable: () => {},
      onSetView: (view) => {
        if (!KNOWN_VIEWS.has(view)) return false;
        App.setView(view);
        return true;
      },
      onApplyFilters: (input) => {
        const addAll = (field, values) => {
          if (!Array.isArray(values)) return;
          for (const v of values) Filters.state[field].add(field === 'vintages' ? Number(v) : v);
        };
        addAll('varieties', input.varieties);
        addAll('origins', input.origins);
        addAll('vintages', input.vintages);
        if (input.grapeType && ['all', 'red', 'white'].includes(input.grapeType)) Filters.state.grapeType = input.grapeType;
        Filters.syncChipUI();
        App.refresh();
        try { return Filters.getFiltered().length; } catch { return null; }
      },
      onProposeFact: (fact) => MonaKnowledge.proposeFact(fact),
    });

    // Knowledge base → Mona's context (the "gets smarter" loop).
    await MonaKnowledge.load();
    MonaChat.ctx.systemExtra = MonaKnowledge.approvedContext();

    // Boot conversation history.
    await MonaChat.ensureConversation();
    MonaUI.replay(MonaChat.messages);

    // Knowledge panel button visible only to lab/admin.
    this.updateKbButton();
  },

  // Called from App.setView on every view change.
  onViewChange(view) {
    if (!this.initialized) return;
    // Hide the floating widget button on Mona's own tabs.
    MonaUI.setFabVisible(view !== 'mona' && view !== 'guardados');
    if (view === 'guardados') MonaSaved.render();
  },

  updateKbButton() {
    const isStaff = Auth.role === 'lab' || Auth.role === 'admin';
    const sidebar = document.querySelector('.mona-sidebar');
    if (!sidebar || !isStaff || sidebar.querySelector('.mona-kb-open')) return;
    const btn = document.createElement('button');
    btn.className = 'mona-kb-open';
    btn.dataset.monaKbOpen = '1';
    btn.textContent = 'Conocimiento';
    sidebar.appendChild(btn);
  },
};

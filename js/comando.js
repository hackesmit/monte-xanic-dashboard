// comando.js — Ctrl-K / Cmd-K command menu (hq-ik6v0.7).
// Lists every visible view tab and the header actions, filters as you type,
// Enter runs the highlighted entry, Esc closes and returns focus. It only
// clicks controls that already exist, so it adds no route and no logic.

const ACTIONS = [
  ['demo-toggle-btn', 'Modo Demo', false],
  ['theme-toggle-btn', 'Cambiar tema', false],
  ['help-toggle-btn', 'Ayuda', '#help-modal .help-close'], // opens its own modal, which takes the focus
];

function visible(el) {
  if (!el || el.hidden || el.getClientRects().length === 0) return false;
  const v = getComputedStyle(el).visibility;
  return v !== 'hidden' && v !== 'collapse';
}

// A text field keeps its own Ctrl-K (search boxes, textareas, contenteditable).
const NON_TEXT = /^(checkbox|radio|button|submit|reset|image|file|range|color)$/;
function editable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !NON_TEXT.test(el.type) && el !== input;
}

function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function entries() {
  const out = [];
  document.querySelectorAll('#nav-tabs .nav-tab[data-view]').forEach((el) => {
    if (visible(el)) out.push({ label: el.textContent.trim(), kind: 'Vista', el });
  });
  for (const [id, label, ownsFocus] of ACTIONS) {
    const el = document.getElementById(id);
    if (visible(el)) out.push({ label, kind: 'Acción', el, ownsFocus });
  }
  return out;
}

let dlg = null;
let input = null;
let list = null;
let opener = null;
let handoff = null;
let shown = [];
let active = 0;

function build() {
  dlg = document.createElement('dialog');
  dlg.id = 'comando';
  dlg.className = 'comando';
  dlg.setAttribute('aria-label', 'Ir a');
  input = document.createElement('input');
  input.type = 'text';
  input.className = 'comando-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'comando-lista');
  input.setAttribute('aria-label', 'Ir a');
  input.autocomplete = 'off';
  input.spellcheck = false;
  list = document.createElement('ul');
  list.id = 'comando-lista';
  list.className = 'comando-lista';
  list.setAttribute('role', 'listbox');
  dlg.append(input, list);
  document.body.appendChild(dlg);

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[active]);
    }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) run(shown[Number(li.dataset.i)]);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => {
    const target = handoff && document.querySelector(handoff);
    handoff = null;
    if (target && visible(target)) target.focus();
    else if (opener && opener.isConnected) opener.focus();
    opener = null;
  });
}

function render() {
  const q = norm(input.value.trim());
  shown = entries().filter((it) => norm(it.label).includes(q));
  active = 0;
  input.setAttribute('aria-expanded', String(shown.length > 0));
  list.replaceChildren(...shown.map((it, i) => {
    const li = document.createElement('li');
    li.id = `comando-op-${i}`;
    li.dataset.i = String(i);
    li.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.textContent = it.label;
    const kind = document.createElement('span');
    kind.className = 'comando-tipo';
    kind.textContent = it.kind;
    li.append(name, kind);
    return li;
  }));
  paint();
}

function paint() {
  [...list.children].forEach((li, i) => {
    li.setAttribute('aria-selected', String(i === active));
    li.classList.toggle('is-active', i === active);
  });
  if (shown.length) {
    input.setAttribute('aria-activedescendant', `comando-op-${active}`);
    list.children[active].scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function run(it) {
  if (!it) return;
  close();
  // The close event fires after this task: clearing the opener keeps focus
  // inside the modal the action opens instead of dropping it behind.
  // The native dialog also restores focus to the old element on close, so the
  // close handler moves it into the new modal instead.
  if (it.ownsFocus) { opener = null; handoff = it.ownsFocus; }
  it.el.click();
}

function open() {
  if (!dlg) build();
  if (dlg.open) return;
  const dash = document.getElementById('dashboard-content');
  if (!visible(dash)) return; // login or loading screen: leave Ctrl-K to the browser
  opener = document.activeElement;
  input.value = '';
  render();
  dlg.showModal();
  input.focus();
}

function close() {
  if (dlg && dlg.open) dlg.close();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
    if (!visible(document.getElementById('dashboard-content'))) return;
    if (editable(document.activeElement)) return;
    e.preventDefault();
    if (dlg && dlg.open) close(); else open();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#comando-btn')) open();
});

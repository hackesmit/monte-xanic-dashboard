// ── modalHygiene — shared dialog hygiene helpers ──────────────────
//
// Used by rowEditor.js (berry/wine/preferment edit) and mediciones.js to
// add iOS-safe body scroll lock, focus trap, autofocus, and optional ESC +
// backdrop dismiss handling around native <dialog> elements.
//
// Callers that already wire their own ESC + backdrop handling (mediciones
// does this in events.js) should call attachModalHygiene without onDismiss
// so only scroll lock + focus management are applied.

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function lockBodyScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const body = document.body;
  const depth = parseInt(body.dataset.modalDepth || '0', 10);
  if (depth === 0) {
    const y = window.scrollY || 0;
    body.dataset.modalScrollY = String(y);
    body.style.setProperty('--modal-scroll-y', `-${y}px`);
    body.classList.add('modal-open');
  }
  body.dataset.modalDepth = String(depth + 1);
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const body = document.body;
  const depth = parseInt(body.dataset.modalDepth || '0', 10);
  if (depth <= 1) {
    const y = parseInt(body.dataset.modalScrollY || '0', 10);
    body.classList.remove('modal-open');
    body.style.removeProperty('--modal-scroll-y');
    delete body.dataset.modalScrollY;
    delete body.dataset.modalDepth;
    if (y) window.scrollTo(0, y);
  } else {
    body.dataset.modalDepth = String(depth - 1);
  }
}

export function trapFocus(event, modal) {
  if (event.key !== 'Tab') return;
  const nodes = modal.querySelectorAll(FOCUSABLE_SELECTOR);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === modal)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function autofocusFirstField(modal, firstFieldId = null) {
  if (firstFieldId) {
    const el = document.getElementById(firstFieldId);
    if (el && typeof el.focus === 'function') { el.focus(); return; }
  }
  const focusable = modal.querySelector(FOCUSABLE_SELECTOR);
  if (focusable && typeof focusable.focus === 'function') focusable.focus();
}

export function attachModalHygiene(modal, opts = {}) {
  if (!modal) return;
  const { firstFieldId = null, onDismiss = null } = opts;
  lockBodyScroll();
  autofocusFirstField(modal, firstFieldId);
  const onKeydown = (e) => { if (e.key === 'Tab') trapFocus(e, modal); };
  const onCancel = (e) => {
    if (typeof onDismiss === 'function') {
      e.preventDefault();
      onDismiss();
    }
  };
  const onClick = (e) => {
    if (e.target === modal && typeof onDismiss === 'function') onDismiss();
  };
  const onClose = () => {
    modal.removeEventListener('keydown', onKeydown);
    modal.removeEventListener('cancel', onCancel);
    if (typeof onDismiss === 'function') modal.removeEventListener('click', onClick);
    unlockBodyScroll();
  };
  modal.addEventListener('keydown', onKeydown);
  modal.addEventListener('cancel', onCancel);
  if (typeof onDismiss === 'function') modal.addEventListener('click', onClick);
  modal.addEventListener('close', onClose, { once: true });
}

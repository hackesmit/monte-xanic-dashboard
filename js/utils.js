// ── Shared pure helpers (no DOM, no I/O) ──

// Escape a value for safe interpolation into an HTML string. Handles the five
// significant characters incl. both quote styles, so output is safe in both
// element-text and attribute contexts. null/undefined → '' (never "null").
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

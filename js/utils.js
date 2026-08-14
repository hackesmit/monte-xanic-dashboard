// ── Shared pure helpers (no DOM, no I/O) ──

// Escape a value for safe interpolation into an HTML string. Handles the five
// significant characters incl. both quote styles, so output is safe in both
// element-text and attribute contexts. null/undefined → '' (never "null").
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The vineyard's timezone. Every "today" the app shows or stores is a date in
// Baja, not in UTC, and the two disagree for seven hours of every day. Deriving
// a date from toISOString() during that window is off by one, which filed a
// medicion taken at 6pm under tomorrow and made three weather tests fail
// nightly. One definition so the app and its tests cannot drift.
export const VINEYARD_TZ = 'America/Tijuana';

export function todayInVineyard() {
  return new Date().toLocaleDateString('en-CA', { timeZone: VINEYARD_TZ });
}

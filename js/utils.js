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

// Expand a multi-lot code ('SBVDG-2A/2B', 'GREVA-3A,4A') into the per-lot codes
// that share its head: ['SBVDG-2A/2B', 'SBVDG-2A', 'SBVDG-2B']. The verbatim
// code stays first so an exact match always wins over an expansion.
//
// One medicion routinely covers several field lots that were pressed together,
// while berry samples are taken per lot. Whichever side does the lookup has to
// expand, or the two never meet. This lived as a private method on DataStore
// and classification.js could not reach it without importing the data layer,
// so scoreFromMedicion did an exact get and reported "Sin berry" for lots the
// calidad map joined fine (xd-5en.9). One definition, both callers.
export function expandLotCode(code) {
  if (!code) return [];
  const c = String(code);
  if (!/[/,]/.test(c)) return [c];
  const dash = c.indexOf('-');
  if (dash < 0) return [c];
  const head = c.slice(0, dash);
  const parts = c.slice(dash + 1).split(/[/,]/).map(x => x.trim()).filter(Boolean);
  return [c, ...parts.map(x => `${head}-${x}`)];
}

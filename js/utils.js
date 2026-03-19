// ── Shared Utilities ──
// Consolidated helpers used across multiple modules.
// Never redefine these locally — always use Utils.*.

const Utils = {
  // Average of numeric values in an array, ignoring nulls/NaN
  avg(arr) {
    const valid = arr.filter(x => typeof x === 'number' && !isNaN(x));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  },

  // HTML-escape a string to prevent XSS
  esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  },

  // Format a number with fixed decimals, or return '—' for null/NaN
  fmtNum(val, dec) {
    if (val === null || val === undefined || typeof val !== 'number' || isNaN(val)) return '—';
    return dec === 0 ? Math.round(val) : val.toFixed(dec);
  },

  // Shorthand for document.getElementById
  el(id) {
    return document.getElementById(id);
  }
};

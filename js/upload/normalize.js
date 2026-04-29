// js/upload/normalize.js
// Shared cell-value normalizers for the upload parsers.
//
// Round 30 root cause: each parser used to define a private normalizeValue
// helper whose `val instanceof Date` branch was dead code under SheetJS'
// `raw: false` mode. Locale-formatted date strings ("21/08/2024") flowed
// straight to Postgres and were rejected with "date/time field value out
// of range". The fix moves the shared logic here and adds a date-aware
// normalizeDate so each parser routes its known date columns through it.

import * as XLSX from 'xlsx';

// Empty/blank markers shared by every parser.
const EMPTY_MARKERS = new Set(['', '-', '—', 'NA', 'N/A']);

/**
 * Normalize a single non-date cell value coming out of XLSX.utils.sheet_to_json
 * (with `raw: true, cellDates: true`) or a CSV row.
 *
 *  - null / undefined / blank markers → null
 *  - Date object → ISO YYYY-MM-DD (callers that need date-aware handling
 *    should use normalizeDate instead, but a Date in a non-date column is
 *    still better off as ISO than the raw object)
 *  - finite number → number
 *  - everything else → trimmed string, coerced to number when fully numeric
 */
export function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const str = String(val).trim();
  if (EMPTY_MARKERS.has(str)) return null;
  const n = Number(str);
  return Number.isNaN(n) ? str : n;
}

/**
 * Normalize a value coming from a *date-typed* column to ISO YYYY-MM-DD,
 * or null on unparseable input. Postgres `date` columns reject anything
 * that isn't unambiguously parseable, so any uncertain input is dropped
 * rather than guessed.
 *
 * Handles, in order:
 *   - null/undefined/blank → null
 *   - Date object → ISO YYYY-MM-DD (timezone-stripped via UTC view)
 *   - number → Excel serial date (via XLSX.SSF.parse_date_code, which
 *     accounts for Excel's 1900-leap-year quirk)
 *   - ISO-prefixed string ("YYYY-MM-DD" or "YYYY-MM-DDT...") → YYYY-MM-DD
 *   - Slash- or dash-separated string → parsed under the `dateOrder` hint
 *     ("dmy" or "mdy"), with a heuristic override when one component > 12
 *     unambiguously identifies the day.
 *
 * @param {*} val
 * @param {{dateOrder?: 'dmy'|'mdy'}} [opts]
 * @returns {string|null}
 */
export function normalizeDate(val, { dateOrder = 'dmy' } = {}) {
  if (val === null || val === undefined) return null;

  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString().split('T')[0];
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return null;
    const parsed = XLSX.SSF.parse_date_code(val);
    if (!parsed) return null;
    const { y, m, d } = parsed;
    return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
  }

  const str = String(val).trim();
  if (EMPTY_MARKERS.has(str)) return null;

  // ISO prefix: YYYY-MM-DD optionally followed by Thh:mm:ss[.frac][tz].
  // Postgres `date` columns only need the date component, so we drop any
  // trailing timestamp (this also sidesteps WineXRay's UploadDate which
  // emits 7-digit fractional seconds — beyond Postgres' 6-digit limit).
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Slash/dash separated: 1–2 digit / 1–2 digit / 2 or 4 digit year.
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    // 2-digit years assume 21st century. All winery records are post-2015;
    // a stray '8/21/95' would land as 2095-08-21, which is obviously wrong
    // and surfaces immediately in the UI rather than corrupting silently.
    if (year < 100) year += 2000;
    let day, month;
    if (a > 12 && b <= 12)      { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else if (dateOrder === 'mdy') { month = a; day = b; }
    else                          { day = a; month = b; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function pad4(n) { return String(n).padStart(4, '0'); }

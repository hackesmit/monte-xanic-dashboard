// js/mona/dataAccess.js - pure data query/aggregate helpers (no DOM, no imports)
// Operates on plain row arrays (DataStore.berryData, etc.). Kept side-effect free
// so it imports cleanly under `node --test`.
//
// The model names the fields itself, and the datasets do not share names (berry
// rows say variety/appellation, wine rows say variedad/proveedor). A guessed
// name used to filter every row out with no error, and Mona then told the user
// no data existed (xd-7ap.2). So an unknown field or operator throws an error
// that lists the real fields, and a filter value that matches nothing comes
// back with an `aviso` naming the values that do exist.

const MAX_GROUPS = 100;
const MAX_HINT_VALUES = 40;
const OPS = new Set(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'between']);

// Every key of every row: a column that is null in the first rows still counts.
function knownFields(rows) {
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return keys;
}

function checkField(known, name) {
  if (known.size && !known.has(name)) {
    const list = [...known].filter(k => !k.startsWith('_')).join(', ');
    throw new Error(`campo desconocido "${name}"; los campos de este conjunto son: ${list}`);
  }
}

// eq/ne/in: a number matches its numeric string ("2025"), text ignores case and
// surrounding spaces ("cabernet sauvignon").
function norm(v) {
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t.toLowerCase();
  }
  return v;
}
const same = (a, b) => norm(a) === norm(b);
const num = (x) => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x);

function matches(row, { field, op, value }) {
  const v = row[field];
  switch (op) {
    case 'eq': return same(v, value);
    case 'ne': return !same(v, value);
    case 'in': return Array.isArray(value) && value.some(x => same(v, x));
    case 'gt': return typeof v === 'number' && v > num(value);
    case 'gte': return typeof v === 'number' && v >= num(value);
    case 'lt': return typeof v === 'number' && v < num(value);
    case 'lte': return typeof v === 'number' && v <= num(value);
    case 'between': return typeof v === 'number' && Array.isArray(value) && v >= num(value[0]) && v <= num(value[1]);
    default: return false;
  }
}

function checkFilters(known, filters) {
  for (const f of filters) {
    if (!f || typeof f !== 'object') throw new Error('cada filtro es un objeto {field, op, value}');
    checkField(known, f.field);
    if (!OPS.has(f.op)) throw new Error(`operador desconocido "${f.op}"; usa uno de: ${[...OPS].join(', ')}`);
  }
}

// When nothing matched: for each eq/in filter whose value matches no row at all,
// name the values the field does have, so the model can correct a spelling.
function emptyHint(rows, filters) {
  const notes = [];
  for (const f of filters) {
    if (f.op !== 'eq' && f.op !== 'in') continue;
    const wanted = f.op === 'in' ? (Array.isArray(f.value) ? f.value : []) : [f.value];
    if (rows.some(r => wanted.some(w => same(r[f.field], w)))) continue;
    const values = [...new Set(rows.map(r => r[f.field]).filter(v => v != null && v !== ''))];
    const shown = values.slice(0, MAX_HINT_VALUES).join(', ');
    notes.push(`ninguna fila tiene ${f.field} = ${JSON.stringify(f.value)}; valores existentes: ${shown}${values.length > MAX_HINT_VALUES ? ', ...' : ''}`);
  }
  return notes.length ? notes.join('. ') : undefined;
}

function applyFilters(rows, filters, known) {
  if (!Array.isArray(filters) || !filters.length) return rows;
  checkFilters(known, filters);
  return rows.filter(r => filters.every(f => matches(r, f)));
}

export function queryData(rows, { filters = [], fields = null, limit = 200 } = {}) {
  rows = rows || [];
  const known = knownFields(rows);
  if (Array.isArray(fields)) for (const k of fields) checkField(known, k);
  const filtered = applyFilters(rows, filters, known);
  const total = filtered.length;
  let out = filtered.slice(0, limit);
  if (Array.isArray(fields) && fields.length) {
    out = out.map(r => {
      const o = {};
      for (const k of fields) if (k in r) o[k] = r[k];
      return o;
    });
  }
  const result = { rows: out, truncated: total > out.length, total };
  if (!total && rows.length && Array.isArray(filters)) {
    const aviso = emptyHint(rows, filters);
    if (aviso) result.aviso = aviso;
  }
  return result;
}

function metricValue(rs, metric, field) {
  if (metric === 'count') return rs.length;
  const nums = rs.map(r => r[field]).filter(n => typeof n === 'number' && !Number.isNaN(n));
  if (!nums.length) return null;
  if (metric === 'sum') return Math.round(nums.reduce((a, b) => a + b, 0) * 1000) / 1000;
  if (metric === 'min') return Math.min(...nums);
  if (metric === 'max') return Math.max(...nums);
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000; // avg
}

export function aggregateData(rows, { groupBy = null, metric = 'avg', field = null, filters = [] } = {}) {
  rows = rows || [];
  const known = knownFields(rows);
  if (groupBy != null) checkField(known, groupBy);
  if (metric !== 'count') {
    if (field == null) throw new Error(`falta field: la métrica ${metric} necesita un campo numérico`);
    checkField(known, field);
  }
  const filtered = applyFilters(rows, filters, known);
  const buckets = new Map();
  for (const r of filtered) {
    const key = groupBy == null ? 'Total' : String(r[groupBy] ?? '—');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const groups = [];
  for (const [key, rs] of buckets) groups.push({ key, value: metricValue(rs, metric, field), count: rs.length });
  const truncated = groups.length > MAX_GROUPS;
  const result = { groups: groups.slice(0, MAX_GROUPS), truncated };
  // The figure over every filtered row, so the model never adds or averages
  // the groups itself (it got 858.1 for 859.12, xd-7ap.2).
  if (groupBy != null && filtered.length) result.overall = { value: metricValue(filtered, metric, field), count: filtered.length };
  if (!filtered.length && rows.length && Array.isArray(filters)) {
    const aviso = emptyHint(rows, filters);
    if (aviso) result.aviso = aviso;
  }
  return result;
}

// Every row, not a sample: a column that is empty in the first rows (a newer
// measurement) must still be listed, or the model never learns its name.
export function listFields(rows) {
  const numeric = new Set(), categorical = new Set();
  for (const r of (rows || [])) {
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') numeric.add(k);
      else if (typeof v === 'string') categorical.add(k);
    }
  }
  return { numeric: [...numeric], categorical: [...categorical] };
}

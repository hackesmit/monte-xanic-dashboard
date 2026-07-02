// js/mona/dataAccess.js — pure data query/aggregate helpers (no DOM, no imports)
// Operates on plain row arrays (DataStore.berryData, etc.). Kept side-effect free
// so it imports cleanly under `node --test`.

const MAX_GROUPS = 100;

function matches(row, { field, op, value }) {
  const v = row[field];
  switch (op) {
    case 'eq': return v === value;
    case 'ne': return v !== value;
    case 'in': return Array.isArray(value) && value.includes(v);
    case 'gt': return typeof v === 'number' && v > value;
    case 'gte': return typeof v === 'number' && v >= value;
    case 'lt': return typeof v === 'number' && v < value;
    case 'lte': return typeof v === 'number' && v <= value;
    case 'between': return typeof v === 'number' && Array.isArray(value) && v >= value[0] && v <= value[1];
    default: return false;
  }
}

function applyFilters(rows, filters) {
  if (!Array.isArray(filters) || !filters.length) return rows;
  return rows.filter(r => filters.every(f => matches(r, f)));
}

export function queryData(rows, { filters = [], fields = null, limit = 200 } = {}) {
  const filtered = applyFilters(rows || [], filters);
  const total = filtered.length;
  let out = filtered.slice(0, limit);
  if (Array.isArray(fields) && fields.length) {
    out = out.map(r => {
      const o = {};
      for (const k of fields) if (k in r) o[k] = r[k];
      return o;
    });
  }
  return { rows: out, truncated: total > out.length, total };
}

export function aggregateData(rows, { groupBy = null, metric = 'avg', field = null, filters = [] } = {}) {
  const filtered = applyFilters(rows || [], filters);
  const buckets = new Map();
  for (const r of filtered) {
    const key = groupBy == null ? 'Total' : String(r[groupBy] ?? '—');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const groups = [];
  for (const [key, rs] of buckets) {
    let value;
    if (metric === 'count') {
      value = rs.length;
    } else {
      const nums = rs.map(r => r[field]).filter(n => typeof n === 'number' && !Number.isNaN(n));
      if (!nums.length) value = null;
      else if (metric === 'sum') value = nums.reduce((a, b) => a + b, 0);
      else if (metric === 'min') value = Math.min(...nums);
      else if (metric === 'max') value = Math.max(...nums);
      else value = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000; // avg
    }
    groups.push({ key, value, count: rs.length });
  }
  const truncated = groups.length > MAX_GROUPS;
  return { groups: groups.slice(0, MAX_GROUPS), truncated };
}

export function listFields(rows) {
  const numeric = new Set(), categorical = new Set();
  for (const r of (rows || []).slice(0, 200)) {
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') numeric.add(k);
      else if (typeof v === 'string') categorical.add(k);
    }
  }
  return { numeric: [...numeric], categorical: [...categorical] };
}

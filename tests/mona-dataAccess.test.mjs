import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryData, aggregateData, listFields } from '../js/mona/dataAccess.js';

const rows = [
  { variety: 'Cabernet Sauvignon', appellation: 'Viña Grande', brix: 24, ph: 3.6, vintage: 2025 },
  { variety: 'Cabernet Sauvignon', appellation: 'Viña Grande', brix: 26, ph: 3.8, vintage: 2025 },
  { variety: 'Durif', appellation: 'El Porvenir', brix: 22, ph: 3.4, vintage: 2024 },
];

test('queryData eq filter', () => {
  const r = queryData(rows, { filters: [{ field: 'variety', op: 'eq', value: 'Durif' }] });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].appellation, 'El Porvenir');
  assert.equal(r.total, 1);
});

test('queryData between + projection + limit truncation', () => {
  const r = queryData(rows, { filters: [{ field: 'brix', op: 'between', value: [23, 27] }], fields: ['brix'], limit: 1 });
  assert.equal(r.rows.length, 1);
  assert.equal(r.truncated, true);
  assert.deepEqual(Object.keys(r.rows[0]), ['brix']);
});

test('aggregateData avg group-by', () => {
  const r = aggregateData(rows, { groupBy: 'variety', metric: 'avg', field: 'brix' });
  const cab = r.groups.find(g => g.key === 'Cabernet Sauvignon');
  assert.equal(cab.value, 25);
  assert.equal(cab.count, 2);
});

test('aggregateData count metric ignores field', () => {
  const r = aggregateData(rows, { groupBy: 'vintage', metric: 'count' });
  assert.equal(r.groups.find(g => g.key === '2025').value, 2);
});

test('aggregateData skips non-numeric for avg', () => {
  const dirty = [...rows, { variety: 'Durif', brix: null, vintage: 2024 }];
  const r = aggregateData(dirty, { groupBy: 'variety', metric: 'avg', field: 'brix' });
  assert.equal(r.groups.find(g => g.key === 'Durif').value, 22); // null skipped
});

test('listFields splits numeric/categorical', () => {
  const f = listFields(rows);
  assert.ok(f.numeric.includes('brix'));
  assert.ok(f.categorical.includes('variety'));
});

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

// xd-7ap.2: a guessed field name ("variedad" on berry rows, "anio") used to
// filter everything out with no error, and Mona then told the user no data
// existed. An unknown field or operator is now an error that names the real
// fields, so the model can retry with the right one.
test('unknown filter field throws and names the real fields', () => {
  assert.throws(
    () => queryData(rows, { filters: [{ field: 'variedad', op: 'eq', value: 'Durif' }] }),
    (e) => /campo desconocido "variedad"/.test(e.message) && /variety/.test(e.message) && /vintage/.test(e.message),
  );
});

test('unknown groupBy or metric field throws', () => {
  assert.throws(() => aggregateData(rows, { groupBy: 'anio', metric: 'count' }), /campo desconocido "anio"/);
  assert.throws(() => aggregateData(rows, { metric: 'avg', field: 'peso_baya' }), /campo desconocido "peso_baya"/);
  assert.throws(() => aggregateData(rows, { metric: 'avg', filters: [{ field: 'añada', op: 'eq', value: 2025 }], field: 'brix' }), /campo desconocido "añada"/);
});

test('unknown projection field and unknown operator throw', () => {
  assert.throws(() => queryData(rows, { fields: ['brix', 'origen'] }), /campo desconocido "origen"/);
  assert.throws(() => queryData(rows, { filters: [{ field: 'brix', op: 'like', value: 2 }] }), /operador desconocido "like"/);
});

test('a field present only in some rows is known', () => {
  const mixed = [...rows, { variety: 'Durif', tANT: 500, vintage: 2024 }];
  const r = aggregateData(mixed, { metric: 'max', field: 'tANT' });
  assert.equal(r.groups[0].value, 500);
});

test('an empty dataset does not throw', () => {
  assert.equal(queryData([], { filters: [{ field: 'x', op: 'eq', value: 1 }] }).total, 0);
});

test('eq/in match a numeric string against a number and ignore case and spaces', () => {
  assert.equal(queryData(rows, { filters: [{ field: 'vintage', op: 'eq', value: '2025' }] }).total, 2);
  assert.equal(queryData(rows, { filters: [{ field: 'variety', op: 'eq', value: ' cabernet sauvignon' }] }).total, 2);
  assert.equal(queryData(rows, { filters: [{ field: 'variety', op: 'in', value: ['durif', 'Syrah'] }] }).total, 1);
  assert.equal(queryData(rows, { filters: [{ field: 'variety', op: 'ne', value: 'DURIF' }] }).total, 2);
  assert.equal(queryData(rows, { filters: [{ field: 'brix', op: 'gte', value: '24' }] }).total, 2);
});

test('a filter value that matches no row comes back with the values that exist', () => {
  const r = queryData(rows, { filters: [{ field: 'variety', op: 'eq', value: 'Tempranilo' }] });
  assert.equal(r.total, 0);
  assert.match(r.aviso, /variety/);
  assert.match(r.aviso, /Cabernet Sauvignon/);
  assert.match(r.aviso, /Durif/);
  const a = aggregateData(rows, { groupBy: 'variety', metric: 'count', filters: [{ field: 'vintage', op: 'eq', value: 2031 }] });
  assert.deepEqual(a.groups, []);
  assert.match(a.aviso, /vintage/);
  assert.match(a.aviso, /2024/);
});

test('no aviso when the rows exist', () => {
  assert.equal(queryData(rows, { filters: [{ field: 'variety', op: 'eq', value: 'Durif' }] }).aviso, undefined);
  assert.equal(aggregateData(rows, { metric: 'count' }).aviso, undefined);
});

test('listFields sees a column that is empty in the first 200 rows', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ variety: 'Durif', anthocyanins: i < 220 ? null : 900 }));
  assert.ok(listFields(many).numeric.includes('anthocyanins'));
});

test('a non-count metric with no field says so', () => {
  assert.throws(() => aggregateData(rows, { metric: 'avg' }), /falta field/);
});

// xd-7ap.2: Mona added 14 group sums in her head and wrote 858.1 t for a
// true 859.12 t. A grouped aggregate now carries its own overall figure.
test('a grouped aggregate returns the overall value over all filtered rows', () => {
  const s = aggregateData(rows, { groupBy: 'variety', metric: 'sum', field: 'brix' });
  assert.deepEqual(s.overall, { value: 72, count: 3 });
  const a = aggregateData(rows, { groupBy: 'variety', metric: 'avg', field: 'brix' });
  assert.deepEqual(a.overall, { value: 24, count: 3 });
  const c = aggregateData(rows, { groupBy: 'variety', metric: 'count', filters: [{ field: 'vintage', op: 'eq', value: 2025 }] });
  assert.deepEqual(c.overall, { value: 2, count: 2 });
  assert.equal(aggregateData(rows, { metric: 'count' }).overall, undefined); // no groupBy: the one group is the total
});

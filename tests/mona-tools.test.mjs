// xd-7ap.2: the tool executors hand the model an error or a hint instead of a
// silent empty result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { DataStore } = await import('../js/dataLoader.js');
const { executeTool } = await import('../js/mona/tools.js');

DataStore.berryData = [
  { variety: 'Tempranillo', vintage: 2025, brix: 24, pH: 3.5, ta: 6, tANT: 500, berryFW: 1.2, _weight: 1 },
  { variety: 'Syrah', vintage: 2025, brix: 22, pH: 3.7, ta: 5, tANT: 600, berryFW: 1.4, _weight: 1 },
];

test('an unknown field comes back as an ERROR that lists the real fields', async () => {
  const r = await executeTool('aggregate_data', { dataset: 'berry', metric: 'avg', field: 'brix', filters: [{ field: 'variedad', op: 'eq', value: 'Syrah' }] });
  assert.match(r.content, /^ERROR ejecutando aggregate_data: .*campo desconocido "variedad".*variety/);
});

test('compute_kpis passes the aviso through when nothing matched', async () => {
  const r = JSON.parse((await executeTool('compute_kpis', { filters: [{ field: 'variety', op: 'eq', value: 'Tempranilo' }] })).content);
  assert.equal(r.muestras, 0);
  assert.match(r.aviso, /Tempranillo/);
});

test('compute_kpis matches a value regardless of case', async () => {
  const r = JSON.parse((await executeTool('compute_kpis', { filters: [{ field: 'variety', op: 'eq', value: 'tempranillo' }] })).content);
  assert.equal(r.muestras, 1);
  assert.equal(r.aviso, undefined);
});

// xd-1r3: em dashes leave the screen, but the empty-group key in Mona's
// aggregations must stay distinct from a real '-' value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateData } from '../js/mona/dataAccess.js';

test('xd-1r3: null and "-" stay separate groups', () => {
  const r = aggregateData([{ variety: null }, { variety: '-' }], { groupBy: 'variety', metric: 'count' });
  assert.equal(r.groups.length, 2);
  assert.ok(r.groups.every(g => g.count === 1));
});

test('xd-1r3: a Mona table shows the empty-group key as "-"', async () => {
  const { renderTable } = await import('../js/mona/chartSpec.js');
  const el = { innerHTML: '' };
  renderTable(el, { title: 'Conteo — variedad', columns: [{ key: 'k', label: 'Variedad' }], rows: [{ k: '—' }] });
  assert.ok(!el.innerHTML.includes('—'));
  assert.match(el.innerHTML, /<td>-<\/td>/);
});

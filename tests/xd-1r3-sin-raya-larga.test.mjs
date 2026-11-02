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
